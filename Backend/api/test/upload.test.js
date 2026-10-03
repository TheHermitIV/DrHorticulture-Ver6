import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import { detectImageType, uploadImage } from '../src/middleware/upload.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const heif = (brand) =>
  Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from(`ftyp${brand}`, 'latin1')]);

function appWithUpload(maxUploadMb = 10) {
  const app = express();
  app.use(requestId);
  app.post('/upload', uploadImage({ maxUploadMb }), (req, res) => {
    res.json({
      mime: req.image.mime,
      ext: req.image.ext,
      size: req.image.buffer.length,
      body: req.body,
    });
  });
  app.use(errorHandler);
  return app;
}

describe('detectImageType', () => {
  it.each([
    ['a JPEG', JPEG, 'jpeg'],
    ['a PNG', PNG, 'png'],
    ['a HEIC', heif('heic'), 'heif'],
    ['a generic HEIF', heif('mif1'), 'heif'],
    ['a GIF', Buffer.from('GIF89a', 'latin1'), null],
    ['an MP4', heif('isom'), null],
    ['plain text', Buffer.from('hello world'), null],
    ['an empty file', Buffer.alloc(0), null],
  ])('identifies %s', (_name, buffer, expected) => {
    expect(detectImageType(buffer)).toBe(expected);
  });
});

describe('uploadImage', () => {
  it('accepts a JPEG and keeps the text fields', async () => {
    const res = await request(appWithUpload())
      .post('/upload')
      .field('species', 'Geranium')
      .attach('image', JPEG, 'photo.jpg');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
      size: JPEG.length,
      body: { species: 'Geranium' },
    });
  });

  it('types the file by its bytes, not its name', async () => {
    const res = await request(appWithUpload()).post('/upload').attach('image', PNG, 'photo.jpg');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mime: 'image/png', ext: 'png' });
  });

  it('rejects HEIC with 415 and asks for JPEG', async () => {
    const res = await request(appWithUpload())
      .post('/upload')
      .attach('image', heif('heic'), 'photo.jpg');
    expect(res.status).toBe(415);
    expect(res.body.error).toMatchObject({
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Send the photo as JPEG.',
    });
  });

  it('rejects a non-image with 415 even when it is named .jpg', async () => {
    const res = await request(appWithUpload())
      .post('/upload')
      .attach('image', Buffer.from('not really a photo'), 'photo.jpg');
    expect(res.status).toBe(415);
    expect(res.body.error.message).toBe('Send the photo as JPEG or PNG.');
  });

  it('rejects a file over MAX_UPLOAD_MB with 413', async () => {
    const tooBig = Buffer.concat([JPEG, Buffer.alloc(2048)]);
    const res = await request(appWithUpload(0.001))
      .post('/upload')
      .attach('image', tooBig, 'a.jpg');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects a request without a file', async () => {
    const res = await request(appWithUpload()).post('/upload').field('species', 'geranium');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Attach the photo in the "image" field.',
    });
  });

  it('rejects a request that is not multipart', async () => {
    const res = await request(appWithUpload()).post('/upload').send({ image: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['a second photo', (req) => req.attach('image', JPEG, 'a.jpg').attach('image', JPEG, 'b.jpg')],
    ['a photo in another field', (req) => req.attach('photo', JPEG, 'a.jpg')],
  ])('rejects %s', async (_name, build) => {
    const res = await build(request(appWithUpload()).post('/upload'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Send exactly one photo, in the "image" field.',
    });
  });

  it('rejects an oversized text field', async () => {
    const res = await request(appWithUpload())
      .post('/upload')
      .field('species', 'x'.repeat(2000))
      .attach('image', JPEG, 'a.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'limit_field_value' },
    });
  });

  it('rejects a truncated multipart body with 400, not 500', async () => {
    const res = await request(appWithUpload())
      .post('/upload')
      .set('content-type', 'multipart/form-data; boundary=xyz')
      .send('--xyz\r\ncontent-disposition: form-data; name="image"; filename="a.jpg"\r\n\r\nabc');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('The upload could not be read.');
  });
});
