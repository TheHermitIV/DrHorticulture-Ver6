import { describe, expect, it } from 'vitest';

import { AppError } from '../src/errors.js';
import { intake } from '../src/services/intake.js';
import { makeImage, PHONE_EXIF } from './images.js';

const jpeg = (buffer) => ({ buffer, mime: 'image/jpeg', ext: 'jpg' });

async function intakeError(args) {
  try {
    await intake(args);
  } catch (err) {
    return err;
  }
  throw new Error('expected intake to throw');
}

describe('intake: species', () => {
  const image = async () => jpeg(await makeImage());

  it.each([
    ['trims and lowercases it', '  Zonal Geranium ', 'zonal geranium'],
    ['accepts 64 characters', 'a'.repeat(64), 'a'.repeat(64)],
    ['treats empty as absent', '', null],
    ['treats whitespace as absent', '   ', null],
    ['treats a missing field as absent', undefined, null],
  ])('%s', async (_name, species, expected) => {
    const result = await intake({ image: await image(), fields: { species } });
    expect(result.species).toBe(expected);
  });

  it('accepts no fields at all', async () => {
    expect((await intake({ image: await image(), fields: undefined })).species).toBeNull();
  });

  it.each([
    ['is over 64 characters', 'a'.repeat(65)],
    ['is sent twice', ['geranium', 'begonia']],
  ])('rejects a species that %s', async (_name, species) => {
    const err = await intakeError({ image: await image(), fields: { species } });
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Invalid field: species.' });
    expect(err.details.issues[0].field).toBe('species');
  });

  it('ignores unknown fields', async () => {
    const result = await intake({ image: await image(), fields: { species: 'x', note: 'hi' } });
    expect(result).not.toHaveProperty('note');
  });
});

describe('intake: image', () => {
  it('keeps the buffer and type and reads the size', async () => {
    const buffer = await makeImage({ width: 40, height: 30 });
    const { image } = await intake({ image: jpeg(buffer), fields: {} });
    expect(image).toMatchObject({ buffer, mime: 'image/jpeg', ext: 'jpg', width: 40, height: 30 });
  });

  it('reports the size after applying the EXIF orientation', async () => {
    const buffer = await makeImage({ width: 40, height: 30, orientation: 6 });
    const { image } = await intake({ image: jpeg(buffer), fields: {} });
    expect(image).toMatchObject({ width: 30, height: 40 });
  });

  it('never modifies the uploaded bytes', async () => {
    const buffer = await makeImage({ orientation: 6, exif: PHONE_EXIF });
    const copy = Buffer.from(buffer);
    const { image } = await intake({ image: jpeg(buffer), fields: {} });
    expect(image.buffer.equals(copy)).toBe(true);
  });

  it('rejects a file with image magic bytes that cannot be decoded', async () => {
    const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
    const err = await intakeError({ image: jpeg(corrupt), fields: {} });
    expect(err).toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 });
  });
});

describe('intake: EXIF', () => {
  it('keeps only the allowlisted tags and never GPS', async () => {
    const buffer = await makeImage({ exif: PHONE_EXIF });
    const { image } = await intake({ image: jpeg(buffer), fields: {} });
    expect(image.exif).toEqual({
      Make: 'Apple',
      Model: 'iPhone 15',
      ISO: 100,
      ExposureTime: 0.008,
      FNumber: 1.8,
      FocalLength: 6.1,
      DateTimeOriginal: '2026:10:01 12:34:56',
      WhiteBalance: 0,
    });
    expect(JSON.stringify(image.exif)).not.toMatch(/GPS|latitude|longitude/i);
  });

  it('returns an empty object when there is no EXIF', async () => {
    const png = await makeImage({ format: 'png' });
    const { image } = await intake({
      image: { buffer: png, mime: 'image/png', ext: 'png' },
      fields: {},
    });
    expect(image.exif).toEqual({});
  });

  it('strips NUL padding from text tags', async () => {
    const buffer = await makeImage({ exif: { IFD0: { Make: 'Canon\0\0\0', Model: ' EOS ' } } });
    const { image } = await intake({ image: jpeg(buffer), fields: {} });
    expect(image.exif).toMatchObject({ Make: 'Canon', Model: 'EOS' });
  });
});
