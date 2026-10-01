import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { makeImage, PHONE_EXIF } from './images.js';
import { fakeDb, fakeStorage, silentLogger, testEnv } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup({ env = {}, db = fakeDb() } = {}) {
  const storage = fakeStorage();
  const app = createApp({ env: testEnv(env), logger: silentLogger, db, storage });
  return { app, db, storage };
}

const postScan = (app) => request(app).post('/api/v1/scans');

describe('POST /api/v1/scans', () => {
  it('stores the original and both rows, and returns 201 with status uploaded', async () => {
    const { app, db, storage } = setup();
    const photo = await makeImage({ width: 40, height: 30, orientation: 6, exif: PHONE_EXIF });

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
        quality: { passed: null, metrics: {} },
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
        width: 30,
        height: 40,
        exif: expect.objectContaining({ Make: 'Apple', Model: 'iPhone 15' }),
      }),
    ]);
    expect(JSON.stringify(db.tables.scan_images)).not.toMatch(/GPS|latitude|longitude/i);
  });

  it('accepts a scan without species', async () => {
    const { app, db } = setup();
    const res = await postScan(app).attach('image', await makeImage(), 'a.jpg');
    expect(res.status).toBe(201);
    expect(res.body.species).toBeNull();
    expect(db.tables.scans[0].species).toBeNull();
  });

  it('stores a PNG under .png whatever the filename says', async () => {
    const { app, db } = setup();
    const res = await postScan(app).attach('image', await makeImage({ format: 'png' }), 'a.jpg');
    expect(res.status).toBe(201);
    expect(db.tables.scan_images[0]).toMatchObject({
      mime_type: 'image/png',
      storage_path: expect.stringMatching(/\.png$/),
    });
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

  it.each(['scans.insert', 'scanImages.insert'])(
    'returns 500 and cleans up when %s fails',
    async (failOn) => {
      const { app, db, storage } = setup({ db: fakeDb({ failOn }) });
      const res = await postScan(app).attach('image', await makeImage(), 'a.jpg');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('connection reset');
      expect(storage.objects.size).toBe(0);
      expect(db.tables.scans).toEqual([]);
    },
  );
});
