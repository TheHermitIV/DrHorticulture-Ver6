import { latestBy, unwrap } from './result.js';

// Read legacy optional columns when present and the JSON snapshot on all schema versions.
// The presenter explicitly selects public fields and never returns raw_response.

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
          .select()
          .in('image_id', imageIds)
          .order('created_at', { ascending: false }),
      );
      return latestBy(rows, 'image_id');
    },
  };
}
