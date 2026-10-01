import { createClient } from '@supabase/supabase-js';

import { decisionConfigQueries } from './decisionConfig.js';
import { scanImagesQueries } from './scanImages.js';
import { scansQueries } from './scans.js';

const PING_TIMEOUT_MS = 3000;

export function createDb(env) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    supabase,
    scans: scansQueries(supabase),
    scanImages: scanImagesQueries(supabase),
    decisionConfig: decisionConfigQueries(supabase),

    // Reads decision_config, so it also fails until the 0001 migration is applied.
    async ping() {
      try {
        const { error } = await supabase
          .from('decision_config')
          .select('version')
          .limit(1)
          .abortSignal(AbortSignal.timeout(PING_TIMEOUT_MS));
        return error ? { ok: false, error: error.message } : { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  };
}
