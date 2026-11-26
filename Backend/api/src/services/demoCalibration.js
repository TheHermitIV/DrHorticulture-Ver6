// Confidence metadata belongs to the model that produced it. Legacy models have none.
export function isCalibratedModelVersion(version) {
  return version === 'LeafSegmenter v1.2.0' || version === 'LeafSegmenter v1.3.0';
}

export function hasDemoCalibration(response) {
  return (
    isCalibratedModelVersion(response.model_version) &&
    response.calibration?.method === 'provisional-v2'
  );
}

export function demoCalibration(response, cfg) {
  if (!hasDemoCalibration(response)) return null;
  const c = response.calibration;
  const estimate = response.estimate.ndvi;
  const radius = Math.max(cfg.quality.demo_ndvi_buffer ?? 0, c.ndvi_radius);
  return {
    method: c.method,
    mask_samples: c.mask_samples,
    mask_confidence: response.segmentation.mask_confidence,
    mask_overlap_target: c.mask_overlap_target,
    ndvi_radius: radius,
    ndvi_low: Number(Math.max(-1, estimate - radius).toFixed(6)),
    ndvi_high: Number(Math.min(1, estimate + radius).toFixed(6)),
    ndvi_samples: c.ndvi_samples,
    ndvi_nominal_coverage: c.ndvi_nominal_coverage,
    ndvi_tolerance: c.ndvi_tolerance,
    ndvi_confidence: response.estimate.confidence,
  };
}
