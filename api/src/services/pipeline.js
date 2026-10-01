import { randomUUID } from 'node:crypto';

import { AppError } from '../errors.js';
import { intake } from './intake.js';
import { rejectionMessage, runQualityGate } from './qualityGate.js';
import { toScanObject } from './scanObject.js';

// Orchestrates a scan: intake → quality gate → store → (Phase 3: inference → decision).
export function createPipeline({ db, storage, config }) {
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

  return {
    // image: req.image from middleware/upload.js; fields: the multipart text fields.
    // A photo that fails Tier A is still stored, on a scan with status 'rejected', so the
    // client can add a retake to it; the request then fails with 422 IMAGE_REJECTED.
    async submitScan({ image, fields, log }) {
      const { species, image: described } = await intake({ image, fields });
      const { quality: thresholds } = await config.getActive();
      const gate = await runQualityGate(described.buffer, thresholds);
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
          status: gate.passed ? 'uploaded' : 'rejected',
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
        throw new AppError('IMAGE_REJECTED', rejectionMessage(gate.reasons), {
          details: { reasons: gate.reasons, hints: gate.hints },
          scanId,
        });
      }
      scanLog.info({ image_id: imageId, storage_path: path }, 'scan uploaded');

      const imageUrl = await storage.signedUrl(path, 'client');
      return toScanObject({ scan, image: imageRow, imageUrl });
    },
  };
}
