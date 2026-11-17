// Development calibration for the bundled v1.1.0 estimator. See ML_TRAINING_HANDOFF.md.
const maskBands = [
  { minimum: 0.97, matches: 9, samples: 9 },
  { minimum: 0.95, matches: 2, samples: 4 },
  { minimum: 0, matches: 0, samples: 12 },
];
export const ndviErrorRadius = 0.11;

export function demoCalibration(response, cfg) {
  const score = response.segmentation.mask_confidence;
  const estimate = response.estimate.ndvi;
  const radius = Math.max(cfg.quality.demo_ndvi_buffer, ndviErrorRadius);
  const { matches, samples } = maskBands.find(({ minimum }) => score >= minimum);
  return {
    mask_matches: matches,
    mask_samples: samples,
    ndvi_low: Number(Math.max(-1, estimate - radius).toFixed(6)),
    ndvi_high: Number(Math.min(1, estimate + radius).toFixed(6)),
    ndvi_samples: 25,
  };
}
