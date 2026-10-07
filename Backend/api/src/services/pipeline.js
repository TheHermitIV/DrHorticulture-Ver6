import { randomUUID } from 'node:crypto';

import { AppError } from '../errors.js';
import { InferenceError } from '../inference/errors.js';
import { decide } from './decision.js';
import { isUuid } from './ids.js';
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

// Statuses a retake can be added to; processing and completed scans take none.
export const RETAKE_FROM = Object.freeze(['rejected', 'abstained', 'failed']);

const notFound = () => new AppError('NOT_FOUND', 'Scan not found.');
const notRetakeable = (status) =>
  new AppError(
    'INVALID_STATE',
    'A photo can only be added to a scan that is rejected, abstained, or failed.',
    { details: { status } },
  );
const busy = () =>
  new AppError('INVALID_STATE', 'Another photo is already being added to this scan.');

// The scan_images row for a stored photo and its Tier A result.
const toImageRow = ({ imageId, scanId, path, described, gate }) => ({
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

// Runs each step even when one fails. A failure is logged; the error the client sees is the
// one that led here.
async function bestEffort(log, message, steps) {
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      log.error({ err }, message);
    }
  }
}

// Orchestrates a scan: intake → Tier A gate → store → inference → decide() → analysis.
export function createPipeline({ db, storage, config, inference }) {
  // Records a run that failed: an analyses row holding the error, and status 'failed', never
  // 'abstained'.
  async function markFailed(log, { base, err, latencyMs }) {
    const inferenceFailed = err instanceof InferenceError;
    const reason = inferenceFailed ? err.reason : err.message;
    log.error({ image_id: base.image_id, reason, latency_ms: latencyMs }, 'scan failed');
    await bestEffort(log, 'recording the failed scan failed', [
      () =>
        db.analyses.insert({
          ...base,
          raw_response: inferenceFailed ? err.body : null,
          error: reason,
          latency_ms: latencyMs,
        }),
      () => db.scans.setStatus(base.scan_id, 'failed'),
    ]);
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
      const analyzed =
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
      return { scan: updated, image: analyzed, analysis, decision };
    } catch (err) {
      await markFailed(log, { base, err, latencyMs: latencyMs ?? elapsed() });
      throw failure(err, scan.id);
    }
  }

  // After the photo is stored and its rows written: the 422 when it failed Tier A, else its
  // analysis.
  async function finish({ scan, image, gate, cfg, scenario, log }) {
    if (!gate.passed) {
      log.info(
        { image_id: image.id, reasons: gate.reasons, metrics: gate.metrics },
        'scan rejected by quality gate',
      );
      throw rejection(gate.reasons, scan.id);
    }
    log.info(
      { image_id: image.id, storage_path: image.storage_path },
      'image stored, running inference',
    );
    return respond(await analyzeImage({ scan, image, cfg, scenario, log }));
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
      let scan = null;
      let stored;
      try {
        scan = await db.scans.insert({
          id: scanId,
          species,
          status: gate.passed ? 'processing' : 'rejected',
        });
        stored = await db.scanImages.insert(toImageRow({ imageId, scanId, path, described, gate }));
      } catch (err) {
        // No scan is left without its image or vice versa.
        await bestEffort(scanLog, 'cleanup after a failed upload failed', [
          () => storage.remove(path),
          ...(scan ? [() => db.scans.remove(scanId)] : []),
        ]);
        throw err;
      }
      return finish({ scan, image: stored, gate, cfg, scenario, log: scanLog });
    },

    // POST /scans/:id/images: a retake, run through the same pipeline as a new scan. The scan
    // keeps its species and earlier images; its status and result follow the new image.
    async addImage({ scanId, image, scenario: scenarioHeader, log }) {
      const scenario = inference.parseScenario(scenarioHeader);
      const scan = isUuid(scanId) ? await db.scans.get(scanId) : null;
      if (!scan) throw notFound();
      if (!RETAKE_FROM.includes(scan.status)) throw notRetakeable(scan.status);
      const { image: described } = await intake({ image, fields: {} });
      const cfg = await config.getActive();
      const gate = await runQualityGate(described.buffer, cfg.quality);
      const imageId = randomUUID();
      const scanLog = log.child({ scan_id: scanId });

      const path = await storage.uploadOriginal({ scanId, imageId, image: described });
      let claimed = null;
      let stored;
      try {
        // Moves the scan on only if it still takes a retake, so two retakes at once can't both
        // run.
        claimed = await db.scans.setStatus(scanId, gate.passed ? 'processing' : 'rejected', {
          from: RETAKE_FROM,
        });
        if (!claimed) throw busy();
        stored = await db.scanImages.insert(toImageRow({ imageId, scanId, path, described, gate }));
      } catch (err) {
        await bestEffort(scanLog, 'cleanup after a failed retake failed', [
          () => storage.remove(path),
          ...(claimed ? [() => db.scans.setStatus(scanId, scan.status)] : []),
        ]);
        throw err;
      }
      return finish({ scan: claimed, image: stored, gate, cfg, scenario, log: scanLog });
    },
  };
}
