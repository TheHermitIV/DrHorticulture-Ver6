import { describe, expect, it, vi } from 'vitest';

import { CONFIG_CACHE_MS, createConfigService } from '../src/services/configService.js';
import { SEED_CONFIG } from './helpers.js';

function setup(getActive = async () => structuredClone(SEED_CONFIG)) {
  let time = 1_000_000;
  const db = { decisionConfig: { getActive: vi.fn(getActive) } };
  const config = createConfigService({ db, now: () => time });
  return { config, db, advance: (ms) => (time += ms) };
}

describe('createConfigService', () => {
  it('returns the active decision_config row', async () => {
    const { config } = setup();
    expect(await config.getActive()).toEqual(SEED_CONFIG);
  });

  it('reuses the row for 60 s, then reads it again', async () => {
    const { config, db, advance } = setup();
    await config.getActive();
    advance(CONFIG_CACHE_MS - 1);
    await config.getActive();
    expect(db.decisionConfig.getActive).toHaveBeenCalledTimes(1);

    advance(1);
    await config.getActive();
    expect(db.decisionConfig.getActive).toHaveBeenCalledTimes(2);
  });

  it('makes one read for concurrent callers', async () => {
    const { config, db } = setup();
    const results = await Promise.all([config.getActive(), config.getActive()]);
    expect(results[0]).toBe(results[1]);
    expect(db.decisionConfig.getActive).toHaveBeenCalledTimes(1);
  });

  it('returns a frozen config, so a caller cannot change the cached thresholds', async () => {
    const { config } = setup();
    const active = await config.getActive();
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.quality)).toBe(true);
  });

  it('throws when no row is active, and does not cache the failure', async () => {
    const rows = [null, structuredClone(SEED_CONFIG)];
    const { config } = setup(async () => rows.shift());
    await expect(config.getActive()).rejects.toThrow('No active decision_config row');
    expect(await config.getActive()).toEqual(SEED_CONFIG);
  });

  it('throws when the database read fails', async () => {
    const { config } = setup(async () => {
      throw new Error('Database select from decision_config failed: timeout');
    });
    await expect(config.getActive()).rejects.toThrow('timeout');
  });

  it.each([
    ['a missing Tier A threshold', { quality: { ...SEED_CONFIG.quality, blur_min: undefined } }],
    ['a threshold stored as text', { mask_min: '0.8' }],
  ])('rejects a row with %s', async (_name, change) => {
    const { config } = setup(async () => ({ ...structuredClone(SEED_CONFIG), ...change }));
    await expect(config.getActive()).rejects.toThrow(
      'The active decision_config (version 1) is invalid',
    );
  });
});
