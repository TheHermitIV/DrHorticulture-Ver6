import { unwrap } from './result.js';

export function scanImagesQueries(supabase) {
  return {
    async insert(row) {
      return unwrap(
        'insert into scan_images',
        await supabase.from('scan_images').insert(row).select().single(),
      );
    },

    async update(id, fields) {
      return unwrap(
        'update scan_images',
        await supabase.from('scan_images').update(fields).eq('id', id).select().single(),
      );
    },
  };
}
