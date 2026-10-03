import { unwrap } from './result.js';

export function decisionConfigQueries(supabase) {
  return {
    // The active row (at most one, by the decision_config_one_active index), or null.
    async getActive() {
      return unwrap(
        'select from decision_config',
        await supabase
          .from('decision_config')
          .select('version, ndvi_threshold, confidence_min, mask_min, quality')
          .eq('active', true)
          .maybeSingle(),
      );
    },
  };
}
