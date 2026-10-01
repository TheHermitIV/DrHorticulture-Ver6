import multer from 'multer';

import { AppError } from '../errors.js';

const IMAGE_TYPES = Object.freeze({
  jpeg: Object.freeze({ mime: 'image/jpeg', ext: 'jpg' }),
  png: Object.freeze({ mime: 'image/png', ext: 'png' }),
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// ISO-BMFF major brands of HEIC/HEIF photos (the iPhone camera's default format).
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

// Identifies an image by its leading bytes; the client's filename and Content-Type are ignored.
export function detectImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 4, 8) === 'ftyp' &&
    HEIF_BRANDS.has(buffer.toString('latin1', 8, 12))
  ) {
    return 'heif';
  }
  return null;
}

function toAppError(err, maxUploadMb) {
  if (!(err instanceof multer.MulterError)) {
    // busboy parse errors, such as a truncated multipart body, are client errors too.
    return new AppError('VALIDATION_ERROR', 'The upload could not be read.', { cause: err });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError('PAYLOAD_TOO_LARGE', `The photo must be ${maxUploadMb} MB or smaller.`);
  }
  const details = { reason: err.code.toLowerCase() };
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError('VALIDATION_ERROR', 'Send exactly one photo, in the "image" field.', {
      details,
    });
  }
  return new AppError('VALIDATION_ERROR', 'The form fields are not valid.', { details });
}

// Accepts one JPEG or PNG in the multipart field "image", held in memory, and sets
// req.image = { buffer, mime, ext }. Text fields land in req.body.
export function uploadImage({ maxUploadMb }) {
  const parse = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: Math.floor(maxUploadMb * 1024 * 1024),
      files: 1,
      fields: 10,
      fieldSize: 1024,
    },
  }).single('image');

  return function upload(req, res, next) {
    parse(req, res, (err) => {
      if (err) {
        return next(toAppError(err, maxUploadMb));
      }
      if (!req.file) {
        return next(new AppError('VALIDATION_ERROR', 'Attach the photo in the "image" field.'));
      }
      const type = detectImageType(req.file.buffer);
      if (type === 'heif') {
        return next(new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the photo as JPEG.'));
      }
      if (!type) {
        return next(new AppError('UNSUPPORTED_MEDIA_TYPE', 'Send the photo as JPEG or PNG.'));
      }
      req.image = { buffer: req.file.buffer, ...IMAGE_TYPES[type] };
      next();
    });
  };
}
