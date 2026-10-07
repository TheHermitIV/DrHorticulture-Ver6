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

const reject = (reason) => ({ status: 'rejected', recommendation: null, reason });
const abstain = (reason) => ({ status: 'abstained', recommendation: 'abstain', reason });

export function decide({ segmentation: s, estimate: e, checks: c }, cfg) {
  if (!s.plant_detected) return reject('no_plant_detected');
  if (!c.angle_ok) return reject('bad_angle');
  if (s.mask_confidence < cfg.mask_min) return abstain('low_mask_confidence');
  if (e.confidence < cfg.confidence_min) return abstain('low_confidence');
  return {
    status: 'completed',
    recommendation: e.ndvi < cfg.ndvi_threshold ? 'fertilize' : 'do_not_fertilize',
    reason: null,
  };
}
