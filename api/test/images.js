import sharp from 'sharp';

// In-memory test images, so no binary fixtures are needed for intake and storage tests.
export const PHONE_EXIF = Object.freeze({
  IFD0: { Make: 'Apple', Model: 'iPhone 15' },
  IFD2: {
    ISOSpeedRatings: '100',
    ExposureTime: '1/125',
    FNumber: '1.8',
    FocalLength: '6.1',
    DateTimeOriginal: '2026:10:01 12:34:56',
    WhiteBalance: '0',
    Flash: '16',
  },
  IFD3: {
    GPSLatitudeRef: 'N',
    GPSLatitude: '40/1 26/1 0/1',
    GPSLongitudeRef: 'W',
    GPSLongitude: '79/1 58/1 0/1',
  },
});

export async function makeImage({
  format = 'jpeg',
  width = 40,
  height = 30,
  exif,
  orientation,
} = {}) {
  let image = sharp({ create: { width, height, channels: 3, background: '#3a7d44' } });
  if (exif) image = image.withExif(exif);
  if (orientation) image = image.withMetadata({ orientation });
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
}
