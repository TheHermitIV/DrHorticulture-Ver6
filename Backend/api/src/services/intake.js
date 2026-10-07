import exifr from 'exifr';
import sharp from 'sharp';
import { z } from 'zod';

import { AppError } from '../errors.js';

// The only EXIF tags ever stored. GPS and every other tag are dropped.
export const EXIF_FIELDS = Object.freeze([
  'Make',
  'Model',
  'ISO',
  'ExposureTime',
  'FNumber',
  'FocalLength',
  'DateTimeOriginal',
  'WhiteBalance',
]);

const fieldsSchema = z.object({
  // Optional: absent, empty, or whitespace-only all mean "not given".
  species: z
    .string()
    .trim()
    .toLowerCase()
    .max(64)
    .optional()
    .transform((value) => value || null),
});

function parseFields(fields) {
  const result = fieldsSchema.safeParse(fields ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new AppError('VALIDATION_ERROR', `Invalid field: ${issues[0].field}.`, {
      details: { issues },
    });
  }
  return result.data;
}

// Width and height as displayed, after applying the EXIF orientation. The pixels themselves
// are only rotated (sharp().rotate()) where metrics are computed; the stored file is untouched.
async function readDimensions(buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata.autoOrient ?? metadata;
    return { width, height };
  } catch (err) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'The photo could not be read. Send it as JPEG.', {
      cause: err,
    });
  }
}

function cleanValue(value) {
  // Postgres jsonb rejects NUL characters, which some cameras pad strings with.
  return typeof value === 'string' ? value.replaceAll('\0', '').trim() : value;
}

async function readExif(buffer) {
  let tags;
  try {
    tags = await exifr.parse(buffer, {
      pick: [...EXIF_FIELDS],
      reviveValues: false,
      translateValues: false,
    });
  } catch {
    return {}; // Unreadable EXIF is not a reason to reject the photo.
  }
  const exif = {};
  for (const field of EXIF_FIELDS) {
    if (tags?.[field] !== undefined) {
      exif[field] = cleanValue(tags[field]);
    }
  }
  return exif;
}

// Validates the form fields and describes the uploaded image (from middleware/upload.js).
export async function intake({ image, fields }) {
  const { species } = parseFields(fields);
  const { width, height } = await readDimensions(image.buffer);
  const exif = await readExif(image.buffer);
  return { species, image: { ...image, width, height, exif } };
}
