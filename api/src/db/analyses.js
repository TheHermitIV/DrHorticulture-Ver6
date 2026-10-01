import { unwrap } from './result.js';

export function analysesQueries(supabase) {
  return {
    async insert(row) {
      return unwrap(
        'insert into analyses',
        await supabase.from('analyses').insert(row).select().single(),
      );
    },
  };
}
