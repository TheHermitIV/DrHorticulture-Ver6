import { latestBy, unwrap } from './result.js';

// What the scan object's result needs; raw_response stays in the table.
const RESULT_COLUMNS =
  'id, image_id, model_version, config_version, ndvi, confidence, recommendation, abstain_reason, created_at';

export function analysesQueries(supabase) {
  return {
    async insert(row) {
      return unwrap(
        'insert into analyses',
        await supabase.from('analyses').insert(row).select().single(),
      );
    },

    // Map image_id → that image's most recent analysis, for images that have one.
    async latestByImage(imageIds) {
      if (imageIds.length === 0) return new Map();
      const rows = unwrap(
        'select from analyses',
        await supabase
          .from('analyses')
          .select(RESULT_COLUMNS)
          .in('image_id', imageIds)
          .order('created_at', { ascending: false }),
      );
      return latestBy(rows, 'image_id');
    },
  };
}
