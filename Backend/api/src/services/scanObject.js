// Statuses whose scan object carries a result. It is null while processing, and after a
// rejection or a failure, which have no recommendation to show.
const WITH_RESULT = new Set(['completed', 'abstained']);

// The scan object returned by every scan endpoint (see the spec's API specification). image is
// the scan's latest image and analysis that image's latest analysis.
export function toScanObject({ scan, image, imageUrl, analysis = null }) {
  return {
    scan_id: scan.id,
    species: scan.species,
    status: scan.status,
    image: image
      ? {
          id: image.id,
          url: imageUrl,
          quality: { passed: image.quality_passed, metrics: image.quality_metrics },
        }
      : null,
    result:
      analysis && WITH_RESULT.has(scan.status)
        ? {
            recommendation: analysis.recommendation,
            ndvi: analysis.ndvi,
            confidence: analysis.confidence,
            abstain_reason: analysis.abstain_reason,
            model_version: analysis.model_version,
            config_version: analysis.config_version,
          }
        : null,
    created_at: scan.created_at,
  };
}
