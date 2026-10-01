import { unwrap } from './result.js';

export function scansQueries(supabase) {
  return {
    async insert(row) {
      return unwrap(
        'insert into scans',
        await supabase.from('scans').insert(row).select().single(),
      );
    },

    // Every status change also sets updated_at; there is no trigger for it.
    async setStatus(id, status) {
      return unwrap(
        'update scans',
        await supabase
          .from('scans')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single(),
      );
    },

    // Cascades to the scan's images and analyses.
    async remove(id) {
      unwrap('delete from scans', await supabase.from('scans').delete().eq('id', id));
    },
  };
}
