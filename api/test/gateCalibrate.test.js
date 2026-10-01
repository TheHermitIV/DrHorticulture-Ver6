import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { measureFolder, percentile, report, toCsv } from '../scripts/gate-calibrate.js';
import { SEED_CONFIG } from './helpers.js';
import { makePhoto } from './images.js';

const thresholds = SEED_CONFIG.quality;

describe('percentile', () => {
  it.each([
    [0, 1],
    [0.5, 2.5],
    [0.25, 1.75],
    [1, 4],
  ])('interpolates p=%s', (p, expected) => {
    expect(percentile([1, 2, 3, 4], p)).toBe(expected);
  });

  it('handles a single value', () => {
    expect(percentile([7], 0.9)).toBe(7);
  });
});

describe('gate-calibrate over a folder', () => {
  let folder;
  let measured;

  beforeAll(async () => {
    folder = await mkdtemp(path.join(tmpdir(), 'gate-calibrate-'));
    await mkdir(path.join(folder, 'plant-2'));
    await writeFile(path.join(folder, 'good.jpg'), await makePhoto());
    await writeFile(path.join(folder, 'plant-2', 'dark.JPG'), await makePhoto({ tone: [0.5, 0] }));
    await writeFile(path.join(folder, 'broken.png'), 'not a photo');
    await writeFile(path.join(folder, 'IMG_0001.HEIC'), 'heic bytes');
    measured = await measureFolder(folder);
  });

  afterAll(() => rm(folder, { recursive: true, force: true }));

  it('measures photos in subfolders, records unreadable ones, and skips other files', () => {
    const { results, skipped } = measured;
    expect(results.map((result) => result.file)).toEqual([
      'broken.png',
      'good.jpg',
      path.join('plant-2', 'dark.JPG'),
    ]);
    expect(results[0].error).toMatch('could not be read');
    expect(results[1].metrics).toMatchObject({ short_side_px: 1024 });
    expect(skipped).toEqual(['IMG_0001.HEIC']);
  });

  it('prints the distribution, each check, and the rejected and unreadable photos', () => {
    const text = report({ folder: 'lab', ...measured }, thresholds, 'decision_config v1');
    expect(text).toMatch('Tier A gate over 2 photos in lab (decision_config v1)');
    expect(text).toMatch(/^metric\s+min\s+p10\s+p25\s+median\s+p75\s+p90\s+max$/m);
    expect(text).toMatch(/^short_side_px(\s+1024){7}$/m);
    expect(text).toMatch(/^too_dark\s+mean_luminance < 60\s+1\s+50\.0%$/m);
    expect(text).toMatch(/^blurry\s+laplacian_var < 100\s+0\s+100\.0%$/m);
    expect(text).toMatch(/^all checks\s+1\s+50\.0%$/m);
    expect(text).toMatch(/Rejected photos:\n\s+plant-2.dark\.JPG\s+too_dark/);
    expect(text).toMatch(/Unreadable photos:\n\s+broken\.png\s+The photo could not be read/);
    expect(text).toMatch('Skipped 1 other files');
  });

  it('writes one CSV row per photo', () => {
    const lines = toCsv(measured.results, thresholds).trimEnd().split('\n');
    expect(lines[0]).toBe(
      'file,short_side_px,mean_luminance,clipped_pct,laplacian_var,passed,reasons,error',
    );
    expect(lines[1]).toBe('broken.png,,,,,,,The photo could not be read. Send it as JPEG.');
    expect(lines[2]).toMatch(/^good\.jpg,1024,[\d.]+,[\d.]+,[\d.]+,true,,$/);
    expect(lines[3]).toMatch(/dark\.JPG,1024,[\d.]+,[\d.]+,[\d.]+,false,too_dark,$/);
  });
});
