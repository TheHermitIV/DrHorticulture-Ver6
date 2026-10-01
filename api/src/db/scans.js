import { unwrap } from './result.js';

export function scansQueries(supabase) {
  return {
    async insert(row) {
      return unwrap(
        'insert into scans',
        await supabase.from('scans').insert(row).select().single(),
      );
    },

    // Cascades to the scan's images and analyses.
    async remove(id) {
      unwrap('delete from scans', await supabase.from('scans').delete().eq('id', id));
    },
  };
}
