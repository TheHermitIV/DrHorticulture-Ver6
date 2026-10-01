import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { REJECTIONS } from '../src/services/qualityGate.js';
import { makeImage, makePhoto, PHONE_EXIF } from './images.js';
import { fakeDb, fakeStorage, SEED_CONFIG, silentLogger, testEnv } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup({ env = {}, db = fakeDb() } = {}) {
  const storage = fakeStorage();
  const app = createApp({ env: testEnv(env), logger: silentLogger, db, storage });
  return { app, db, storage };
}

const postScan = (app) => request(app).post('/api/v1/scans');

const metrics = {
  short_side_px: expect.any(Number),
  mean_luminance: expect.any(Number),
  clipped_pct: expect.any(Number),
  laplacian_var: expect.any(Number),
};

describe('POST /api/v1/scans', () => {
  it('stores the original and both rows, and returns 201 with status uploaded', async () => {
    const { app, db, storage } = setup();
    const photo = await makePhoto({ orientation: 6, exif: PHONE_EXIF });

    const res = await postScan(app)
      .field('species', ' Geranium ')
      .attach('image', photo, 'IMG_0001.jpg');

    expect(res.status).toBe(201);
    const { scan_id: scanId, image } = res.body;
    expect(scanId).toMatch(UUID);
    expect(image.id).toMatch(UUID);
    const path = `scans/${scanId}/${image.id}.jpg`;
    expect(res.body).toEqual({
      scan_id: scanId,
      species: 'geranium',
      status: 'uploaded',
      image: {
        id: image.id,
        url: `https://storage.test/${path}?purpose=client`,
        quality: { passed: true, metrics: { ...metrics, short_side_px: 1024 } },
      },
      result: null,
      created_at: expect.any(String),
    });

    expect(storage.objects.get(path).equals(photo)).toBe(true);
    expect(db.tables.scans).toEqual([
      expect.objectContaining({ id: scanId, species: 'geranium', status: 'uploaded' }),
    ]);
    expect(db.tables.scan_images).toEqual([
      expect.objectContaining({
        id: image.id,
        scan_id: scanId,
        storage_path: path,
        mime_type: 'image/jpeg',
        width: 1280,
        height: 1024,
        exif: expect.objectContaining({ Make: 'Apple', Model: 'iPhone 15' }),
        quality_passed: true,
        quality_metrics: image.quality.metrics,
        rejection_reasons: [],
      }),
    ]);
    expect(JSON.stringify(db.tables.scan_images)).not.toMatch(/GPS|latitude|longitude/i);
  });

  it('accepts a scan without species', async () => {
    const { app, db } = setup();
    const res = await postScan(app).attach('image', await makePhoto(), 'a.jpg');
    expect(res.status).toBe(201);
    expect(res.body.species).toBeNull();
    expect(db.tables.scans[0].species).toBeNull();
  });

  it('stores a PNG under .png whatever the filename says', async () => {
    const { app, db } = setup();
    const res = await postScan(app).attach('image', await makePhoto({ format: 'png' }), 'a.jpg');
    expect(res.status).toBe(201);
    expect(db.tables.scan_images[0]).toMatchObject({
      mime_type: 'image/png',
      storage_path: expect.stringMatching(/\.png$/),
    });
  });

  it('rejects a dark photo with 422 and keeps it on a rejected scan for a retake', async () => {
    const { app, db, storage } = setup();
    const res = await postScan(app).attach('image', await makePhoto({ tone: [0.5, 0] }), 'a.jpg');

    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: 'IMAGE_REJECTED',
      message: 'Photo is too dark.',
      details: { reasons: ['too_dark'], hints: [REJECTIONS.too_dark.hint] },
      scan_id: expect.stringMatching(UUID),
      request_id: expect.stringMatching(UUID),
    });

    const scanId = res.body.error.scan_id;
    expect(db.tables.scans).toEqual([expect.objectContaining({ id: scanId, status: 'rejected' })]);
    expect(db.tables.scan_images).toEqual([
      expect.objectContaining({
        scan_id: scanId,
        quality_passed: false,
        quality_metrics: metrics,
        rejection_reasons: ['too_dark'],
      }),
    ]);
    expect(storage.objects.size).toBe(1);
  });

  it('returns every failing reason at once', async () => {
    const { app, db } = setup();
    const res = await postScan(app).attach('image', await makeImage(), 'a.jpg');
    expect(res.status).toBe(422);
    expect(res.body.error.message).toBe('Photo failed 2 quality checks.');
    expect(res.body.error.details.reasons).toEqual(['resolution_too_low', 'blurry']);
    expect(db.tables.scan_images[0].rejection_reasons).toEqual(['resolution_too_low', 'blurry']);
  });

  it('judges the photo by the active decision_config, not by fixed numbers', async () => {
    const config = { ...SEED_CONFIG, quality: { ...SEED_CONFIG.quality, min_short_side_px: 2000 } };
    const { app } = setup({ db: fakeDb({ config }) });
    const res = await postScan(app).attach('image', await makePhoto(), 'a.jpg');
    expect(res.status).toBe(422);
    expect(res.body.error.details.reasons).toEqual(['resolution_too_low']);
  });

  it.each([
    [
      'a HEIC photo',
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      {},
      (req) => req.attach('image', Buffer.from('\0\0\0\x18ftypheic\0\0\0\0', 'latin1'), 'a.heic'),
    ],
    [
      'a truncated JPEG',
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      {},
      async (req) => req.attach('image', (await makePhoto()).subarray(0, 4000), 'a.jpg'),
    ],
    [
      'a photo over MAX_UPLOAD_MB',
      413,
      'PAYLOAD_TOO_LARGE',
      { MAX_UPLOAD_MB: '0.001' },
      async (req) =>
        req.attach('image', Buffer.concat([await makeImage(), Buffer.alloc(4096)]), 'a.jpg'),
    ],
    [
      'a species over 64 characters',
      400,
      'VALIDATION_ERROR',
      {},
      async (req) =>
        req.field('species', 'x'.repeat(65)).attach('image', await makeImage(), 'a.jpg'),
    ],
    ['a request without a photo', 400, 'VALIDATION_ERROR', {}, (req) => req.field('species', 'x')],
  ])('rejects %s and stores nothing', async (_name, status, code, env, build) => {
    const { app, db, storage } = setup({ env });
    const res = await build(postScan(app));
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(storage.objects.size).toBe(0);
    expect(db.tables.scans).toEqual([]);
    expect(db.tables.scan_images).toEqual([]);
  });

  it('returns 500 and stores nothing when no decision_config is active', async () => {
    const { app, db, storage } = setup({ db: fakeDb({ config: null }) });
    const res = await postScan(app).attach('image', await makePhoto(), 'a.jpg');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(storage.objects.size).toBe(0);
    expect(db.tables.scans).toEqual([]);
  });

  it.each(['scans.insert', 'scanImages.insert'])(
    'returns 500 and cleans up when %s fails',
    async (failOn) => {
      const { app, db, storage } = setup({ db: fakeDb({ failOn }) });
      const res = await postScan(app).attach('image', await makePhoto(), 'a.jpg');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('connection reset');
      expect(storage.objects.size).toBe(0);
      expect(db.tables.scans).toEqual([]);
    },
  );
});
