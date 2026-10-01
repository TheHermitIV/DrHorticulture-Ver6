// The scan object returned by every scan endpoint (see the spec's API specification).
// TODO: fill result from the latest analysis once analyses exist (task 3.5/3.6); until then a
// scan is at most 'uploaded' and result is always null.
export function toScanObject({ scan, image, imageUrl }) {
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
    result: null,
    created_at: scan.created_at,
  };
}
