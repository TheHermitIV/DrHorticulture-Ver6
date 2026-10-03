import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { makePhoto } from './images.js';
import { fakeDb, fakeStorage, silentLogger, testEnv } from './helpers.js';

function setup() {
  const db = fakeDb();
  const app = createApp({ env: testEnv(), logger: silentLogger, db, storage: fakeStorage() });
  return { app, db };
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
  const res = await req.attach('image', image, 'a.jpg');
  return { res, scanId: res.body.scan_id ?? res.body.error.scan_id };
}

const getScan = (app, id) => request(app).get(`/api/v1/scans/${id}`);
const listScans = (app, query = {}) => request(app).get('/api/v1/scans').query(query);

describe('GET /api/v1/scans/:id', () => {
  it('returns the scan object POST returned, with a fresh 1-hour image URL', async () => {
    const { app } = setup();
    const { res: posted, scanId } = await postScan(app);
    const res = await getScan(app, scanId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(posted.body);
    expect(res.body.image.url).toMatch(/\?purpose=client$/);
  });

  it('shows the result of an abstained scan', async () => {
    const { app } = setup();
    const { scanId } = await postScan(app, { scenario: 'low_confidence' });
    const res = await getScan(app, scanId);
    expect(res.body).toMatchObject({
      status: 'abstained',
      result: { recommendation: 'abstain', abstain_reason: 'low_confidence' },
    });
  });

  it.each([
    ['rejected by Tier A', { image: 'dark' }, 'rejected', false],
    ['rejected by Tier B', { scenario: 'no_plant' }, 'rejected', false],
    ['failed', { scenario: 'error' }, 'failed', true],
  ])('shows a scan %s with no result', async (_name, options, status, passed) => {
    const { app } = setup();
    const image = options.image === 'dark' ? darkPhoto : photo;
    const { scanId } = await postScan(app, { ...options, image });
    const res = await getScan(app, scanId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ scan_id: scanId, status, result: null });
    expect(res.body.image.quality.passed).toBe(passed);
  });

  it('shows the latest image and the latest analysis', async () => {
    const { app, db } = setup();
    const { scanId } = await postScan(app);
    // A later image with no analysis yet, as a retake in progress leaves it.
    const retake = { id: randomUUID(), scan_id: scanId, storage_path: `scans/${scanId}/r.jpg` };
    await db.scanImages.insert({ ...retake, quality_passed: true });
    await db.scans.setStatus(scanId, 'processing');

    const res = await getScan(app, scanId);
    expect(res.body).toMatchObject({
      status: 'processing',
      image: { id: retake.id },
      result: null,
    });
  });

  it.each([randomUUID(), 'not-a-uuid', "1' or '1'='1"])('returns 404 for %s', async (id) => {
    const { app } = setup();
    const res = await getScan(app, encodeURIComponent(id));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Scan not found.' });
  });
});

describe('GET /api/v1/scans', () => {
  it('returns an empty first page', async () => {
    const { app } = setup();
    const res = await listScans(app);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], next_cursor: null });
  });

  it('pages through every scan, newest first', async () => {
    const { app } = setup();
    const ids = [];
    for (const scenario of [null, 'low_confidence', 'no_plant', 'error', null]) {
      ids.push((await postScan(app, { scenario })).scanId);
    }

    const seen = [];
    let cursor;
    const pageSizes = [];
    do {
      const res = await listScans(app, { limit: 2, ...(cursor && { cursor }) });
      expect(res.status).toBe(200);
      pageSizes.push(res.body.items.length);
      seen.push(...res.body.items);
      cursor = res.body.next_cursor;
    } while (cursor);

    expect(pageSizes).toEqual([2, 2, 1]);
    expect(seen.map((scan) => scan.scan_id)).toEqual(ids.toReversed());
    expect(seen.map((scan) => scan.status)).toEqual([
      'completed',
      'failed',
      'rejected',
      'abstained',
      'completed',
    ]);
    expect(seen[0]).toEqual((await getScan(app, ids.at(-1))).body);
  });

  it('breaks created_at ties by id, so no scan is skipped or repeated', async () => {
    const { app, db } = setup();
    for (let i = 0; i < 4; i += 1) {
      await db.scans.insert({ id: randomUUID(), species: null, status: 'rejected' });
    }
    for (const scan of db.tables.scans) scan.created_at = '2026-10-01T12:00:00.123456+00:00';

    const seen = [];
    let cursor;
    do {
      const res = await listScans(app, { limit: 1, ...(cursor && { cursor }) });
      seen.push(...res.body.items.map((scan) => scan.scan_id));
      cursor = res.body.next_cursor;
    } while (cursor);
    expect(seen).toEqual(
      db.tables.scans
        .map((scan) => scan.id)
        .sort()
        .reverse(),
    );
  });

  it('defaults to 20 per page', async () => {
    const { app, db } = setup();
    for (let i = 0; i < 21; i += 1) {
      await db.scans.insert({ id: randomUUID(), species: null, status: 'rejected' });
    }
    const res = await listScans(app);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.items[0].image).toBeNull();
    expect(res.body.next_cursor).toEqual(expect.any(String));
  });

  const cursorOf = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

  it.each([
    ['limit', { limit: 0 }],
    ['limit', { limit: 51 }],
    ['limit', { limit: 2.5 }],
    ['limit', { limit: 'ten' }],
    ['cursor', { cursor: 'garbage' }],
    ['cursor', { cursor: cursorOf({ created_at: '2026-10-01T12:00:00Z' }) }],
    ['cursor', { cursor: cursorOf(['2026-10-01T12:00:00Z),id.gt.(0', randomUUID()]) }],
    ['cursor', { cursor: cursorOf(['2026-10-01T12:00:00Z', 'not-a-uuid']) }],
  ])('rejects a bad %s with 400: %j', async (field, query) => {
    const { app } = setup();
    const res = await listScans(app, query);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: `Invalid query parameter: ${field}.`,
    });
  });
});
