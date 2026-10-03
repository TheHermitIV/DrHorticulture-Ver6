import { latestBy, unwrap } from './result.js';

export function scanImagesQueries(supabase) {
  return {
    async insert(row) {
      return unwrap(
        'insert into scan_images',
        await supabase.from('scan_images').insert(row).select().single(),
      );
    },

    // Map scan_id → that scan's most recent image, for scans that have one.
    async latestByScan(scanIds) {
      if (scanIds.length === 0) return new Map();
      const rows = unwrap(
        'select from scan_images',
        await supabase
          .from('scan_images')
          .select()
          .in('scan_id', scanIds)
          .order('created_at', { ascending: false }),
      );
      return latestBy(rows, 'scan_id');
    },

    async update(id, fields) {
      return unwrap(
        'update scan_images',
        await supabase.from('scan_images').update(fields).eq('id', id).select().single(),
      );
    },
  };
}
