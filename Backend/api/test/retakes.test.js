import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { makePhoto } from './images.js';
import { fakeDb, fakeStorage, silentLogger, testEnv } from './helpers.js';

function setup() {
  const db = fakeDb();
  const storage = fakeStorage();
  const app = createApp({ env: testEnv(), logger: silentLogger, db, storage });
  return { app, db, storage };
}

let photo;
let darkPhoto;
beforeAll(async () => {
  photo = await makePhoto();
  darkPhoto = await makePhoto({ tone: [0.5, 0] });
});

// Posts a scan and returns its scan_id, whatever the outcome.
async function postScan(app, { scenario, image = photo } = {}) {
  const req = request(app).post('/api/v1/scans');
  if (scenario) req.set('x-mock-scenario', scenario);
  const res = await req.field('species', 'geranium').attach('image', image, 'a.jpg');
  return res.body.scan_id ?? res.body.error.scan_id;
}

function postRetake(app, scanId, { scenario, image = photo } = {}) {
  const req = request(app).post(`/api/v1/scans/${scanId}/images`);
  if (scenario) req.set('x-mock-scenario', scenario);
  return req.attach('image', image, 'b.jpg');
}

describe('POST /api/v1/scans/:id/images', () => {
  it.each([
    ['rejected', { dark: true }],
    ['abstained', { scenario: 'low_confidence' }],
    ['failed', { scenario: 'error' }],
  ])('adds a retake to a %s scan and returns 201 with its result', async (status, first) => {
    const { app, db, storage } = setup();
    // The photos are built in beforeAll, after it.each reads its table.
    const scanId = await postScan(app, {
      scenario: first.scenario,
      image: first.dark ? darkPhoto : photo,
    });
    expect(db.tables.scans[0].status).toBe(status);

    const res = await postRetake(app, scanId);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      scan_id: scanId,
      species: 'geranium',
      status: 'completed',
      result: { recommendation: 'do_not_fertilize', ndvi: 0.62, confidence: 0.78 },
    });
    const retakeId = res.body.image.id;
    expect(retakeId).not.toBe(db.tables.scan_images[0].id);
    expect(res.body.image.url).toBe(
      `https://storage.test/scans/${scanId}/${retakeId}.jpg?purpose=client`,
    );
    // Earlier images and analyses are kept.
    expect(db.tables.scan_images).toHaveLength(2);
    expect(storage.objects.size).toBe(2);
    expect(db.tables.scans).toEqual([expect.objectContaining({ id: scanId, status: 'completed' })]);

    const read = await request(app).get(`/api/v1/scans/${scanId}`);
    expect(read.body).toEqual(res.body);
  });

  it('keeps the scan species and ignores one sent with the retake', async () => {
    const { app, db } = setup();
    const scanId = await postScan(app, { image: darkPhoto });
    const res = await postRetake(app, scanId).field('species', 'rose');
    expect(res.status).toBe(201);
    expect(res.body.species).toBe('geranium');
    expect(db.tables.scans[0].species).toBe('geranium');
  });

  it.each(['completed', 'processing', 'uploaded'])(
    'returns 409 for a %s scan and stores nothing',
    async (status) => {
      const { app, db, storage } = setup();
      const scanId = await postScan(app);
      db.tables.scans[0].status = status;

      const res = await postRetake(app, scanId);

      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_STATE',
        message: 'A photo can only be added to a scan that is rejected, abstained, or failed.',
        details: { status },
      });
      expect(db.tables.scans[0].status).toBe(status);
      expect(db.tables.scan_images).toHaveLength(1);
      expect(storage.objects.size).toBe(1);
    },
  );

  it.each([
    ['an unknown', randomUUID()],
    ['a malformed', 'not-a-uuid'],
  ])('returns 404 for %s scan id', async (_label, scanId) => {
    const { app, storage } = setup();
    const res = await postRetake(app, scanId);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Scan not found.' });
    expect(storage.objects.size).toBe(0);
  });

  it('rejects a retake that fails Tier A with 422 and keeps it on the scan', async () => {
    const { app, db, storage } = setup();
    const scanId = await postScan(app, { scenario: 'low_confidence' });

    const res = await postRetake(app, scanId, { image: darkPhoto });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'IMAGE_REJECTED',
      details: { reasons: ['too_dark'] },
      scan_id: scanId,
    });
    expect(db.tables.scans[0].status).toBe('rejected');
    expect(db.tables.scan_images[1]).toMatchObject({
      quality_passed: false,
      rejection_reasons: ['too_dark'],
    });
    expect(storage.objects.size).toBe(2);
    expect(db.tables.analyses).toHaveLength(1); // only the first image's

    // The scan object now shows the rejected retake, with no result.
    const read = await request(app).get(`/api/v1/scans/${scanId}`);
    expect(read.body).toMatchObject({ status: 'rejected', result: null });
    expect(read.body.image.id).toBe(db.tables.scan_images[1].id);
  });

  it('rejects a retake inference finds no plant in (Tier B) with 422', async () => {
    const { app, db } = setup();
    const scanId = await postScan(app, { image: darkPhoto });
    const res = await postRetake(app, scanId, { scenario: 'no_plant' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'IMAGE_REJECTED',
      details: { reasons: ['no_plant_detected'] },
      scan_id: scanId,
    });
    expect(db.tables.scans[0].status).toBe('rejected');
  });

  it('marks the scan failed and returns 503 when inference fails on a retake', async () => {
    const { app, db } = setup();
    const scanId = await postScan(app, { image: darkPhoto });
    const res = await postRetake(app, scanId, { scenario: 'error' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'INFERENCE_UNAVAILABLE', scan_id: scanId });
    expect(db.tables.scans[0].status).toBe('failed');
    expect(db.tables.analyses).toEqual([
      expect.objectContaining({ image_id: db.tables.scan_images[1].id, recommendation: null }),
    ]);
  });

  it('returns 400 for an unknown mock scenario before storing anything', async () => {
    const { app, db, storage } = setup();
    const scanId = await postScan(app, { image: darkPhoto });
    const res = await postRetake(app, scanId, { scenario: 'sunny' });
    expect(res.status).toBe(400);
    expect(db.tables.scan_images).toHaveLength(1);
    expect(storage.objects.size).toBe(1);
  });

  it('returns 409 and removes the photo when another retake claimed the scan first', async () => {
    const { app, db, storage } = setup();
    const scanId = await postScan(app, { image: darkPhoto });
    // The scan was read as rejected, but another retake moved it on before this one claimed it.
    const { get } = db.scans;
    db.scans.get = async (id) => {
      const scan = await get(id);
      db.tables.scans[0].status = 'processing';
      return scan;
    };

    const res = await postRetake(app, scanId);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE',
      message: 'Another photo is already being added to this scan.',
    });
    expect(db.tables.scans[0].status).toBe('processing');
    expect(db.tables.scan_images).toHaveLength(1);
    expect(storage.objects.size).toBe(1);
  });

  it('removes the photo and restores the status when the image row fails to save', async () => {
    const { app, db, storage } = setup();
    const scanId = await postScan(app, { image: darkPhoto });
    db.scanImages.insert = async () => {
      throw new Error('Database scanImages.insert failed: connection reset');
    };

    const res = await postRetake(app, scanId);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('connection reset');
    expect(db.tables.scans[0].status).toBe('rejected');
    expect(storage.objects.size).toBe(1);
  });
});
