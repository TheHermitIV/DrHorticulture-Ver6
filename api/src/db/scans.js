import { unwrap } from './result.js';

export function scansQueries(supabase) {
  return {
    async insert(row) {
      return unwrap(
        'insert into scans',
        await supabase.from('scans').insert(row).select().single(),
      );
    },

    // The scan, or null.
    async get(id) {
      return unwrap(
        'select from scans',
        await supabase.from('scans').select().eq('id', id).maybeSingle(),
      );
    },

    // Newest first, by created_at then id. before = { created_at, id } of the last scan on the
    // previous page; created_at is passed back exactly as read, microseconds included.
    async list({ limit, before = null }) {
      let query = supabase
        .from('scans')
        .select()
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);
      if (before) {
        const at = JSON.stringify(before.created_at); // quoted: the timestamp holds . and :
        query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${before.id})`);
      }
      return unwrap('select from scans', await query);
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
