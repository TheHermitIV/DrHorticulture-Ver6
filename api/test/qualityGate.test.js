import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  judgeQuality,
  measureQuality,
  REJECTIONS,
  rejectionMessage,
  runQualityGate,
} from '../src/services/qualityGate.js';
import { SEED_CONFIG } from './helpers.js';

const thresholds = SEED_CONFIG.quality;

const solid = (width, height, background, format = 'jpeg') =>
  sharp({ create: { width, height, channels: background.alpha ? 4 : 3, background } })
    .toFormat(format)
    .toBuffer();

// Left half black, right half white: one sharp vertical edge.
async function splitImage(width, height, format = 'png') {
  const white = await solid(width / 2, height, '#ffffff', 'png');
  return sharp({ create: { width, height, channels: 3, background: '#000000' } })
    .composite([{ input: white, left: width / 2, top: 0 }])
    .toFormat(format)
    .toBuffer();
}

// Metrics that pass every v1 placeholder threshold.
const goodMetrics = {
  short_side_px: 3024,
  mean_luminance: 120,
  clipped_pct: 1,
  laplacian_var: 500,
};

describe('measureQuality', () => {
  it('measures a flat mid-gray photo', async () => {
    expect(await measureQuality(await solid(2000, 1500, '#808080'))).toEqual({
      short_side_px: 1500,
      mean_luminance: 128,
      clipped_pct: 0,
      laplacian_var: 0,
    });
  });

  it('counts pixels at 250 or above as clipped', async () => {
    const metrics = await measureQuality(await solid(1200, 1200, '#ffffff'));
    expect(metrics).toMatchObject({ mean_luminance: 255, clipped_pct: 100 });
  });

  it('measures half-clipped photos and finds the edge', async () => {
    const metrics = await measureQuality(await splitImage(1600, 1200));
    expect(metrics.clipped_pct).toBeCloseTo(50, 0);
    expect(metrics.mean_luminance).toBeCloseTo(127.5, 0);
    expect(metrics.laplacian_var).toBeGreaterThan(0);
  });

  it('takes the short side from the original, not the 1024 px metric copy', async () => {
    const metrics = await measureQuality(await solid(4032, 3024, '#808080'));
    expect(metrics.short_side_px).toBe(3024);
  });

  it('reads a PNG with transparency', async () => {
    const metrics = await measureQuality(
      await solid(1200, 1200, { r: 128, g: 128, b: 128, alpha: 0.5 }, 'png'),
    );
    expect(metrics.short_side_px).toBe(1200);
    expect(metrics.mean_luminance).toBeGreaterThan(0);
  });

  it.each([
    ['bytes that are not an image', async () => Buffer.from('not a photo')],
    ['a truncated JPEG', async () => (await splitImage(1600, 1200, 'jpeg')).subarray(0, 600)],
  ])('rejects %s with 415', async (_name, build) => {
    await expect(measureQuality(await build())).rejects.toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      status: 415,
    });
  });
});

describe('judgeQuality', () => {
  it('passes metrics within every threshold', () => {
    expect(judgeQuality(goodMetrics, thresholds)).toEqual({ passed: true, reasons: [], hints: [] });
  });

  // Each threshold is inclusive: a metric exactly at the limit passes, just past it fails.
  it.each([
    ['resolution_too_low', 'short_side_px', 1024, 1023],
    ['too_dark', 'mean_luminance', 60, 59.99],
    ['too_bright', 'mean_luminance', 200, 200.01],
    ['overexposed', 'clipped_pct', 5, 5.01],
    ['blurry', 'laplacian_var', 100, 99.99],
  ])('%s: passes at %s = the limit, fails just past it', (reason, metric, atLimit, past) => {
    expect(judgeQuality({ ...goodMetrics, [metric]: atLimit }, thresholds).passed).toBe(true);
    expect(judgeQuality({ ...goodMetrics, [metric]: past }, thresholds)).toEqual({
      passed: false,
      reasons: [reason],
      hints: [REJECTIONS[reason].hint],
    });
  });

  it('returns every failing reason at once, in a fixed order', () => {
    const bad = { short_side_px: 640, mean_luminance: 30, clipped_pct: 0, laplacian_var: 5 };
    expect(judgeQuality(bad, thresholds)).toEqual({
      passed: false,
      reasons: ['resolution_too_low', 'too_dark', 'blurry'],
      hints: [
        "Use the main camera and don't crop.",
        'Move to bright, indirect light.',
        'Hold still and tap to focus on the leaves.',
      ],
    });
  });

  it('uses the thresholds it is given', () => {
    const strict = { ...thresholds, blur_min: 1000 };
    expect(judgeQuality(goodMetrics, strict).reasons).toEqual(['blurry']);
  });
});

describe('runQualityGate', () => {
  it('returns passed, metrics, reasons, and hints', async () => {
    const result = await runQualityGate(await solid(1200, 1200, '#808080'), thresholds);
    expect(result).toEqual({
      passed: false,
      metrics: { short_side_px: 1200, mean_luminance: 128, clipped_pct: 0, laplacian_var: 0 },
      reasons: ['blurry'],
      hints: [REJECTIONS.blurry.hint],
    });
  });
});

describe('rejectionMessage', () => {
  it('names the problem when there is one reason', () => {
    expect(rejectionMessage(['too_dark'])).toBe('Photo is too dark.');
  });

  it('counts the problems when there are several', () => {
    expect(rejectionMessage(['too_dark', 'blurry'])).toBe('Photo failed 2 quality checks.');
  });
});
