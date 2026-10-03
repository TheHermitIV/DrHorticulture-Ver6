import { z } from 'zod';

// How long the active decision_config is reused before it is read again.
export const CONFIG_CACHE_MS = 60_000;

const threshold = z.number(); // zod 4 numbers already reject NaN and Infinity

// Product thresholds live only in the active decision_config row (see the spec's Data model).
// A row that does not match fails loudly, instead of the gate or decision running on undefined.
const configSchema = z.object({
  version: z.number().int(),
  ndvi_threshold: threshold,
  confidence_min: threshold,
  mask_min: threshold,
  quality: z.object({
    min_short_side_px: threshold,
    luminance_min: threshold,
    luminance_max: threshold,
    clipped_max_pct: threshold,
    blur_min: threshold,
  }),
});

function deepFreeze(object) {
  for (const value of Object.values(object)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(object);
}

export function createConfigService({ db, cacheMs = CONFIG_CACHE_MS, now = Date.now }) {
  let cached = null; // { config, expiresAt }
  let loading = null; // shared by concurrent callers while a read is in flight

  async function load() {
    const row = await db.decisionConfig.getActive();
    if (!row) {
      throw new Error('No active decision_config row. Apply supabase/migrations or activate one.');
    }
    const result = configSchema.safeParse(row);
    if (!result.success) {
      throw new Error(
        `The active decision_config (version ${row.version}) is invalid: ` +
          z.prettifyError(result.error),
      );
    }
    return deepFreeze(result.data);
  }

  return {
    // The active config: { version, ndvi_threshold, confidence_min, mask_min, quality }.
    // A failed read is not cached, so the next call tries again.
    async getActive() {
      if (cached && now() < cached.expiresAt) return cached.config;
      loading ??= load()
        .then((config) => {
          cached = { config, expiresAt: now() + cacheMs };
          return config;
        })
        .finally(() => {
          loading = null;
        });
      return loading;
    },
  };
}
