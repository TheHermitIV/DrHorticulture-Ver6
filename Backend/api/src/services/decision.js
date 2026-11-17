// The decision policy from the spec's Pipeline behavior: every decision the api makes about an
// inference result. A pure function of the response and the active decision_config; inference
// itself never decides. The rules apply in order and the first match wins:
//   1-2. Tier B: no plant, then a bad angle → 'rejected' (the user should retake)
//   3-4. mask or model confidence under its minimum → 'abstained' (no recommendation)
//   5.   NDVI under the threshold → fertilize, else do not fertilize ('completed')
// A confidence exactly at its minimum passes, and an NDVI exactly at the threshold is
// do_not_fertilize: only a value under the line counts as under it.
// reason becomes analyses.abstain_reason for an abstention, and scan_images.rejection_reasons
// plus the 422 details for a rejection.

import { lightingRejection } from './qualityGate.js';
import { ndviErrorRadius } from './demoCalibration.js';

const reject = (reason) => ({ status: 'rejected', recommendation: null, reason });
const abstain = (reason) => ({ status: 'abstained', recommendation: 'abstain', reason });

export function demoNdviDistance(response, cfg) {
  if (
    cfg.quality.demo_ndvi_buffer == null ||
    cfg.quality.demo_mask_min == null ||
    response.model_version !== 'LeafSegmenter v1.1.0'
  ) {
    return null;
  }
  return Number(Math.abs(response.estimate.ndvi - cfg.ndvi_threshold).toFixed(6));
}

export function decide(response, cfg, imageMetrics) {
  const { segmentation: s, estimate: e, checks: c } = response;
  if (!s.plant_detected) return reject('no_plant_detected');
  if (!c.angle_ok) return reject('bad_angle');
  if (cfg.quality.lighting_scope === 'leaf') {
    const reason = lightingRejection(c.leaf_lighting ?? imageMetrics, cfg.quality);
    if (reason) return reject(reason);
  }
  const distance = demoNdviDistance(response, cfg);
  const maskMinimum = distance == null ? cfg.mask_min : cfg.quality.demo_mask_min;
  if (s.mask_confidence < maskMinimum) return abstain('low_mask_confidence');
  if (distance == null && e.confidence < cfg.confidence_min) return abstain('low_confidence');
  if (distance != null && distance <= Math.max(cfg.quality.demo_ndvi_buffer, ndviErrorRadius))
    return abstain('near_ndvi_cutoff');
  return {
    status: 'completed',
    recommendation: e.ndvi < cfg.ndvi_threshold ? 'fertilize' : 'do_not_fertilize',
    reason: null,
  };
}
