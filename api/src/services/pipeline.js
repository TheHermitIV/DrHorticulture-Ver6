import { randomUUID } from 'node:crypto';

import { AppError } from '../errors.js';
import { InferenceError } from '../inference/errors.js';
import { decide } from './decision.js';
import { intake } from './intake.js';
import { REJECTIONS, rejectionMessage, runQualityGate } from './qualityGate.js';
import { toScanObject } from './scanObject.js';

// The 422 for a Tier A or Tier B rejection. The photo stays stored on the rejected scan, so the
// client can add a retake to it.
function rejection(reasons, scanId) {
  return new AppError('IMAGE_REJECTED', rejectionMessage(reasons), {
    details: { reasons, hints: reasons.map((reason) => REJECTIONS[reason].hint) },
    scanId,
  });
}

// A system failure after the scan was stored: 503 when inference failed, 500 otherwise. Both
// carry the scan id, since a failed scan can take a retake.
function failure(err, scanId) {
  if (err instanceof InferenceError) {
    return new AppError('INFERENCE_UNAVAILABLE', err.message, { scanId, cause: err });
  }
  return new AppError('INTERNAL_ERROR', 'Something went wrong. Try again later.', {
    scanId,
    cause: err,
  });
}

// Orchestrates a scan: intake → Tier A gate → store → inference → decide() → analysis.
export function createPipeline({ db, storage, config, inference }) {
  // Undo a half-finished upload so no scan is left without its image or vice versa.
  // Best effort: a cleanup failure is logged, and the original error is what the client sees.
  async function cleanUp(log, { scanId, path, scanInserted }) {
    const steps = [() => storage.remove(path)];
    if (scanInserted) steps.push(() => db.scans.remove(scanId));
    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        log.error({ err, storage_path: path }, 'cleanup after a failed upload failed');
      }
    }
  }

  // Records a run that failed: an analyses row holding the error, and status 'failed', never
  // 'abstained'. Best effort, like cleanUp.
  async function markFailed(log, { base, err, latencyMs }) {
    const inferenceFailed = err instanceof InferenceError;
    const reason = inferenceFailed ? err.reason : err.message;
    log.error({ image_id: base.image_id, reason, latency_ms: latencyMs }, 'scan failed');
    const steps = [
      () =>
        db.analyses.insert({
          ...base,
          raw_response: inferenceFailed ? err.body : null,
          error: reason,
          latency_ms: latencyMs,
        }),
      () => db.scans.setStatus(base.scan_id, 'failed'),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (stepErr) {
        log.error({ err: stepErr }, 'recording the failed scan failed');
      }
    }
  }

  // Sends a stored image that passed Tier A to inference, applies decide(), and records the
  // analysis and the scan's new status: { scan, image, analysis, decision }. A failure marks the
  // scan 'failed' and throws 503 or 500.
  async function analyzeImage({ scan, image, cfg, scenario, log }) {
    const base = { scan_id: scan.id, image_id: image.id, config_version: cfg.version };
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    let latencyMs = null;
    try {
      const imageUrl = await storage.signedUrl(image.storage_path, 'inference');
      const { body, response } = await inference.analyze(
        { image_url: imageUrl, image_id: image.id, species_hint: scan.species },
        { log, scenario },
      );
      latencyMs = elapsed();
      const decision = decide(response, cfg);
      const analysis = await db.analyses.insert({
        ...base,
        model_version: response.model_version,
        mask_confidence: response.segmentation.mask_confidence,
        leaf_fraction: response.segmentation.leaf_fraction,
        features: response.features,
        ndvi: response.estimate.ndvi,
        confidence: response.estimate.confidence,
        recommendation: decision.recommendation,
        abstain_reason: decision.status === 'abstained' ? decision.reason : null,
        raw_response: body,
        latency_ms: latencyMs,
      });
      // A Tier B rejection fails the image's quality gate like a Tier A one.
      const imageRow =
        decision.status === 'rejected'
          ? await db.scanImages.update(image.id, {
              quality_passed: false,
              rejection_reasons: [decision.reason],
            })
          : image;
      const updated = await db.scans.setStatus(scan.id, decision.status);
      log.info(
        {
          image_id: image.id,
          status: decision.status,
          recommendation: decision.recommendation,
          reason: decision.reason,
          model_version: response.model_version,
          latency_ms: latencyMs,
        },
        'scan analyzed',
      );
      return { scan: updated, image: imageRow, analysis, decision };
    } catch (err) {
      await markFailed(log, { base, err, latencyMs: latencyMs ?? elapsed() });
      throw failure(err, scan.id);
    }
  }

  // The scan object for an analyzed image, or the 422 when decide() rejected it (Tier B).
  async function respond({ scan, image, analysis, decision }) {
    if (decision.status === 'rejected') throw rejection([decision.reason], scan.id);
    const imageUrl = await storage.signedUrl(image.storage_path, 'client');
    return toScanObject({ scan, image, imageUrl, analysis });
  }

  return {
    // image: req.image from middleware/upload.js; fields: the multipart text fields;
    // scenario: the x-mock-scenario header. A photo that fails Tier A is still stored, on a scan
    // with status 'rejected', so the client can add a retake to it; the request then fails with
    // 422 IMAGE_REJECTED. One that passes is stored as 'processing' and analyzed.
    async submitScan({ image, fields, scenario: scenarioHeader, log }) {
      const scenario = inference.parseScenario(scenarioHeader);
      const { species, image: described } = await intake({ image, fields });
      const cfg = await config.getActive();
      const gate = await runQualityGate(described.buffer, cfg.quality);
      const scanId = randomUUID();
      const imageId = randomUUID();
      const scanLog = log.child({ scan_id: scanId });

      const path = await storage.uploadOriginal({ scanId, imageId, image: described });
      let scan;
      let imageRow;
      try {
        scan = await db.scans.insert({
          id: scanId,
          species,
          status: gate.passed ? 'processing' : 'rejected',
        });
        imageRow = await db.scanImages.insert({
          id: imageId,
          scan_id: scanId,
          storage_path: path,
          mime_type: described.mime,
          width: described.width,
          height: described.height,
          exif: described.exif,
          quality_passed: gate.passed,
          quality_metrics: gate.metrics,
          rejection_reasons: gate.reasons,
        });
      } catch (err) {
        await cleanUp(scanLog, { scanId, path, scanInserted: Boolean(scan) });
        throw err;
      }

      if (!gate.passed) {
        scanLog.info(
          { image_id: imageId, reasons: gate.reasons, metrics: gate.metrics },
          'scan rejected by quality gate',
        );
        throw rejection(gate.reasons, scanId);
      }
      scanLog.info({ image_id: imageId, storage_path: path }, 'scan stored, running inference');
      return respond(await analyzeImage({ scan, image: imageRow, cfg, scenario, log: scanLog }));
    },
  };
}
