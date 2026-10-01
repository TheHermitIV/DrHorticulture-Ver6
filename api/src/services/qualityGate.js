import sharp from 'sharp';

import { AppError } from '../errors.js';

// Tier A quality gate (see the spec's Pipeline behavior). Thresholds come from the active
// decision_config's `quality`; nothing here decides what a good photo is.

// Metrics are computed on a grayscale copy, auto-oriented and downscaled to this width, so
// values are comparable across phones.
const METRIC_WIDTH = 1024;
const CLIPPED_LEVEL = 250;
// sharp clamps convolution output to 0-255; the offset keeps negative responses in range.
const LAPLACIAN = {
  width: 3,
  height: 3,
  kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
  scale: 1,
  offset: 128,
};

// Every rejection reason the api can return, with the message and hint shown to the user.
export const REJECTIONS = Object.freeze({
  resolution_too_low: {
    message: 'Photo resolution is too low.',
    hint: "Use the main camera and don't crop.",
  },
  too_dark: { message: 'Photo is too dark.', hint: 'Move to bright, indirect light.' },
  too_bright: { message: 'Photo is too bright.', hint: 'Avoid direct sun or flash glare.' },
  overexposed: { message: 'Photo is overexposed.', hint: 'Avoid direct sun on the leaves.' },
  blurry: { message: 'Photo is blurry.', hint: 'Hold still and tap to focus on the leaves.' },
});

// Tier A checks in the order their reasons are reported. Every check runs; all failures return.
const CHECKS = [
  ['resolution_too_low', (m, q) => m.short_side_px < q.min_short_side_px],
  ['too_dark', (m, q) => m.mean_luminance < q.luminance_min],
  ['too_bright', (m, q) => m.mean_luminance > q.luminance_max],
  ['overexposed', (m, q) => m.clipped_pct > q.clipped_max_pct],
  ['blurry', (m, q) => m.laplacian_var < q.blur_min],
];

const round2 = (value) => Math.round(value * 100) / 100;

function meanAndVariance(pixels) {
  let sum = 0;
  let sumOfSquares = 0;
  for (const value of pixels) {
    sum += value;
    sumOfSquares += value * value;
  }
  const mean = sum / pixels.length;
  return { mean, variance: sumOfSquares / pixels.length - mean * mean };
}

async function grayscaleCopy(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: METRIC_WIDTH, withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { pixels: data, width: info.width, height: info.height };
}

async function laplacian({ pixels, width, height }) {
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .convolve(LAPLACIAN)
    .toColourspace('b-w')
    .raw()
    .toBuffer();
}

// The four Tier A metrics, independent of any threshold:
// short_side_px (of the original), mean_luminance (0-255), clipped_pct (% of pixels >= 250),
// and laplacian_var (blur; higher is sharper).
export async function measureQuality(buffer) {
  let metadata;
  let gray;
  let edges;
  try {
    metadata = await sharp(buffer).metadata();
    gray = await grayscaleCopy(buffer);
    edges = await laplacian(gray);
  } catch (err) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'The photo could not be read. Send it as JPEG.', {
      cause: err,
    });
  }

  const { mean } = meanAndVariance(gray.pixels);
  const clipped = gray.pixels.reduce((count, value) => count + (value >= CLIPPED_LEVEL), 0);
  return {
    short_side_px: Math.min(metadata.width, metadata.height),
    mean_luminance: round2(mean),
    clipped_pct: round2((100 * clipped) / gray.pixels.length),
    laplacian_var: round2(meanAndVariance(edges).variance),
  };
}

// Applies decision_config.quality to measured metrics.
export function judgeQuality(metrics, thresholds) {
  const failed = CHECKS.filter(([, fails]) => fails(metrics, thresholds));
  const reasons = failed.map(([reason]) => reason);
  return {
    passed: reasons.length === 0,
    reasons,
    hints: reasons.map((reason) => REJECTIONS[reason].hint),
  };
}

// Runs the Tier A gate on an uploaded photo: { passed, metrics, reasons, hints }.
export async function runQualityGate(buffer, thresholds) {
  const metrics = await measureQuality(buffer);
  const { passed, reasons, hints } = judgeQuality(metrics, thresholds);
  return { passed, metrics, reasons, hints };
}

// The 422 message for a set of rejection reasons; details carry each reason's hint.
export function rejectionMessage(reasons) {
  return reasons.length === 1
    ? REJECTIONS[reasons[0]].message
    : `Photo failed ${reasons.length} quality checks.`;
}
