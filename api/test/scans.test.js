import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { createMockInference, mockExample } from '../src/inference/mock.js';
import { REJECTIONS } from '../src/services/qualityGate.js';
import { makeImage, makePhoto, PHONE_EXIF } from './images.js';
import { fakeDb, fakeStorage, SEED_CONFIG, silentLogger, testEnv } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup({ env = {}, db = fakeDb(), inference } = {}) {
  const storage = fakeStorage();
  const app = createApp({ env: testEnv(env), logger: silentLogger, db, storage, inference });
  return { app, db, storage };
}

// An inference adapter that always answers with body.
const answering = (body) => ({
  mode: 'test',
  parseScenario: () => null,
  analyze: async () => ({ body, response: body }),
});

const postScan = (app, scenario) => {
  const req = request(app).post('/api/v1/scans');
  return scenario ? req.set('x-mock-scenario', scenario) : req;
};

const metrics = {
  short_side_px: expect.any(Number),
  mean_luminance: expect.any(Number),
  clipped_pct: expect.any(Number),
  laplacian_var: expect.any(Number),
};

const mockBody = { ...mockExample(), model_version: 'mock-0.1' };

describe('POST /api/v1/scans', () => {
  it('stores the photo, runs inference, and returns 201 with the recommendation', async () => {
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
      status: 'completed',
      image: {
        id: image.id,
        url: `https://storage.test/${path}?purpose=client`,
        quality: { passed: true, metrics: { ...metrics, short_side_px: 1024 } },
      },
      result: {
        recommendation: 'do_not_fertilize',
        ndvi: 0.62,
        confidence: 0.78,
        abstain_reason: null,
        model_version: 'mock-0.1',
        config_version: 1,
      },
      created_at: expect.any(String),
    });

    expect(storage.objects.get(path).equals(photo)).toBe(true);
    expect(db.tables.scans).toEqual([
      expect.objectContaining({ id: scanId, species: 'geranium', status: 'completed' }),
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
    expect(db.tables.analyses).toEqual([
      expect.objectContaining({
        scan_id: scanId,
        image_id: image.id,
        model_version: 'mock-0.1',
        config_version: 1,
        mask_confidence: 0.91,
        leaf_fraction: 0.42,
        features: mockBody.features,
        ndvi: 0.62,
        confidence: 0.78,
        recommendation: 'do_not_fertilize',
        abstain_reason: null,
        raw_response: mockBody,
        error: null,
        latency_ms: expect.any(Number),
      }),
    ]);
  });

  it('sends inference a 5-minute signed URL, the image id, and the species hint', async () => {
    const inference = createMockInference({ allowScenarios: true });
    const analyze = vi.spyOn(inference, 'analyze');
    const { app } = setup({ inference });

    const res = await postScan(app)
      .field('species', 'Basil')
      .attach('image', await makePhoto(), 'a.jpg');
    const { scan_id: scanId, image } = res.body;
    expect(analyze).toHaveBeenCalledWith(
      {
        image_url: `https://storage.test/scans/${scanId}/${image.id}.jpg?purpose=inference`,
        image_id: image.id,
        species_hint: 'basil',
      },
      expect.objectContaining({ scenario: null }),
    );

    await postScan(app).attach('image', await makePhoto(), 'a.jpg');
    expect(analyze.mock.calls[1][0].species_hint).toBeNull();
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

  it('decides with the active decision_config', async () => {
    const { app, db } = setup({
      db: fakeDb({ config: { ...SEED_CONFIG, version: 2, ndvi_threshold: 0.7 } }),
    });
    const res = await postScan(app).attach('image', await makePhoto(), 'a.jpg');
    expect(res.status).toBe(201);
    expect(res.body.result).toMatchObject({ recommendation: 'fertilize', config_version: 2 });
    expect(db.tables.analyses[0].config_version).toBe(2);
  });

  describe('mock scenarios', () => {
    it('low_confidence: 201 abstained, with abstain as the recommendation', async () => {
      const { app, db } = setup();
      const res = await postScan(app, 'low_confidence').attach('image', await makePhoto(), 'a.jpg');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('abstained');
      expect(res.body.result).toEqual({
        recommendation: 'abstain',
        ndvi: 0.62,
        confidence: 0.2,
        abstain_reason: 'low_confidence',
        model_version: 'mock-0.1',
        config_version: 1,
      });
      expect(db.tables.scans[0].status).toBe('abstained');
      expect(db.tables.analyses[0]).toMatchObject({
        recommendation: 'abstain',
        abstain_reason: 'low_confidence',
        error: null,
      });
    });

    it('no_plant: 422 rejected (Tier B), keeping the photo and the analysis', async () => {
      const { app, db, storage } = setup();
      const res = await postScan(app, 'no_plant').attach('image', await makePhoto(), 'a.jpg');

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: 'IMAGE_REJECTED',
        message: 'No plant was found in the photo.',
        details: {
          reasons: ['no_plant_detected'],
          hints: ['Center the plant and fill the frame.'],
        },
        scan_id: expect.stringMatching(UUID),
        request_id: expect.stringMatching(UUID),
      });
      const scanId = res.body.error.scan_id;
      expect(db.tables.scans).toEqual([
        expect.objectContaining({ id: scanId, status: 'rejected' }),
      ]);
      expect(db.tables.scan_images[0]).toMatchObject({
        quality_passed: false,
        quality_metrics: metrics,
        rejection_reasons: ['no_plant_detected'],
      });
      expect(db.tables.analyses).toEqual([
        expect.objectContaining({
          scan_id: scanId,
          recommendation: null,
          abstain_reason: null,
          raw_response: expect.objectContaining({
            segmentation: { plant_detected: false, mask_confidence: 0, leaf_fraction: 0 },
          }),
        }),
      ]);
      expect(storage.objects.size).toBe(1);
    });

    it('error: 503 failed, never abstained, with the error recorded', async () => {
      const { app, db, storage } = setup();
      const res = await postScan(app, 'error').attach('image', await makePhoto(), 'a.jpg');

      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({
        code: 'INFERENCE_UNAVAILABLE',
        message: 'Plant analysis is unavailable right now. Try again later.',
        details: null,
        scan_id: expect.stringMatching(UUID),
      });
      const scanId = res.body.error.scan_id;
      expect(db.tables.scans).toEqual([expect.objectContaining({ id: scanId, status: 'failed' })]);
      expect(db.tables.analyses).toEqual([
        expect.objectContaining({
          scan_id: scanId,
          image_id: db.tables.scan_images[0].id,
          config_version: 1,
          model_version: null,
          recommendation: null,
          abstain_reason: null,
          raw_response: null,
          error: 'mock scenario "error"',
          latency_ms: expect.any(Number),
        }),
      ]);
      expect(storage.objects.size).toBe(1);
    });

    it('rejects an unknown scenario with 400 and stores nothing', async () => {
      const { app, db, storage } = setup();
      const res = await postScan(app, 'low-confidence').attach('image', await makePhoto(), 'a.jpg');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { allowed: ['low_confidence', 'no_plant', 'error'] },
      });
      expect(storage.objects.size).toBe(0);
      expect(db.tables.scans).toEqual([]);
    });

    it('ignores x-mock-scenario in production', async () => {
      const { app } = setup({ env: { NODE_ENV: 'production' } });
      const res = await postScan(app, 'error').attach('image', await makePhoto(), 'a.jpg');
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('completed');
    });
  });

  it('rejects a bad angle (Tier B) with 422', async () => {
    const body = mockExample();
    body.checks.angle_ok = false;
    const { app, db } = setup({ inference: answering(body) });
    const res = await postScan(app).attach('image', await makePhoto(), 'a.jpg');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      message: REJECTIONS.bad_angle.message,
      details: { reasons: ['bad_angle'], hints: [REJECTIONS.bad_angle.hint] },
    });
    expect(db.tables.scans[0].status).toBe('rejected');
  });

  it('marks the scan failed and returns 500 with its id when a later step fails', async () => {
    const { app, db, storage } = setup({ db: fakeDb({ failOn: 'analyses.insert' }) });
    const res = await postScan(app).attach('image', await makePhoto(), 'a.jpg');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      scan_id: db.tables.scans[0].id,
    });
    expect(JSON.stringify(res.body)).not.toContain('connection reset');
    expect(db.tables.scans[0].status).toBe('failed');
    expect(storage.objects.size).toBe(1);
  });

  it('rejects a dark photo with 422 and keeps it on a rejected scan for a retake', async () => {
    const inference = createMockInference({ allowScenarios: true });
    const analyze = vi.spyOn(inference, 'analyze');
    const { app, db, storage } = setup({ inference });
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
    expect(analyze).not.toHaveBeenCalled();
    expect(db.tables.analyses).toEqual([]);
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
