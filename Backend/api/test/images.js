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

function encode(image, { format, exif, orientation }) {
  if (exif) image = image.withExif(exif);
  if (orientation) image = image.withMetadata({ orientation });
  return format === 'png' ? image.png().toBuffer() : image.jpeg().toBuffer();
}

// A small solid-color image. It fails the Tier A gate (too small, no detail).
export async function makeImage({
  format = 'jpeg',
  width = 40,
  height = 30,
  exif,
  orientation,
} = {}) {
  const image = sharp({ create: { width, height, channels: 3, background: '#3a7d44' } });
  return encode(image, { format, exif, orientation });
}

const GREENS = ['#2f6b2a', '#3f8a35', '#5aa14a', '#7cbc5e', '#295c24'];

// Outlined leaves scattered over soil, from a fixed seed, so every run draws the same scene.
// glare: the fraction of the height, from the top, painted pure white.
function leavesSvg(width, height, glare) {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const leaves = [];
  for (let i = 0; i < 420; i++) {
    const [cx, cy] = [random() * width, random() * height];
    const [rx, ry, angle] = [14 + random() * 40, 6 + random() * 18, random() * 180];
    leaves.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${GREENS[i % GREENS.length]}"` +
        ` transform="rotate(${angle} ${cx} ${cy})" stroke="#10240d" stroke-width="2.5"/>`,
    );
  }
  const glareRect = glare ? `<rect width="${width}" height="${height * glare}" fill="#fff"/>` : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<rect width="100%" height="100%" fill="#7a6648"/>${leaves.join('')}${glareRect}</svg>`,
  );
}

// A photo-like plant scene that passes the Tier A gate at the v1 thresholds by default.
// tone: [a, b] maps each pixel to a*value + b (darken or brighten); blur: Gaussian sigma.
export async function makePhoto({
  format = 'jpeg',
  width = 1024,
  height = 1280,
  tone,
  blur,
  glare = 0,
  exif,
  orientation,
} = {}) {
  let image = sharp(leavesSvg(width, height, glare));
  if (tone) image = image.linear(...tone);
  if (blur) image = image.blur(blur);
  return encode(image, { format, exif, orientation });
}
