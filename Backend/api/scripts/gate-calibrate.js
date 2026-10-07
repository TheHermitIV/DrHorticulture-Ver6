// Runs the Tier A quality gate over a folder of photos and prints each metric's distribution and
// each check's pass rate, so decision_config.quality can be tuned on real lab photos.
//
//   npm run gate:calibrate -- <folder> [--quality '{"blur_min":50}'] [--csv metrics.csv]
//
// Thresholds come from the active decision_config, read with the Supabase settings in api/.env.
// --quality overrides some of them to try candidate values; with all five given, no database is
// needed. --csv writes every photo's metrics and reasons for a spreadsheet. Folders are searched
// recursively for .jpg, .jpeg, and .png files.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { loadEnv } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';
import { createConfigService } from '../src/services/configService.js';
import { judgeQuality, measureQuality, TIER_A_CHECKS } from '../src/services/qualityGate.js';

const PHOTO = /\.(jpe?g|png)$/i;
const METRICS = ['short_side_px', 'mean_luminance', 'clipped_pct', 'laplacian_var'];
const THRESHOLD_KEYS = TIER_A_CHECKS.map((check) => check.below ?? check.above);
const PERCENTILES = [
  ['min', 0],
  ['p10', 0.1],
  ['p25', 0.25],
  ['median', 0.5],
  ['p75', 0.75],
  ['p90', 0.9],
  ['max', 1],
];

// Measures every photo under folder: [{ file, metrics } | { file, error }], plus skipped files.
export async function measureFolder(folder) {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(folder, path.join(entry.parentPath, entry.name)))
    .sort();
  const results = [];
  for (const file of files.filter((name) => PHOTO.test(name))) {
    try {
      results.push({
        file,
        metrics: await measureQuality(await readFile(path.join(folder, file))),
      });
    } catch (err) {
      results.push({ file, error: err.message });
    }
  }
  return { results, skipped: files.filter((name) => !PHOTO.test(name)) };
}

// Linear interpolation between the closest ranks, like numpy's default.
export function percentile(sorted, p) {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.min(lower + 1, sorted.length - 1);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

const formatNumber = (value) => String(Math.round(value * 100) / 100);
const formatPct = (count, total) => `${((100 * count) / total).toFixed(1)}%`;

// Pads columns. align has one letter per column: l (left) or r (right).
function table(rows, align) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          align[column] === 'r' ? cell.padStart(widths[column]) : cell.padEnd(widths[column]),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

// The printed report for measured photos judged against thresholds.
export function report({ folder, results, skipped }, thresholds, source) {
  const measured = results.filter((result) => result.metrics);
  const unreadable = results.filter((result) => result.error);
  const lines = [`Tier A gate over ${measured.length} photos in ${folder} (${source})`, ''];
  if (measured.length === 0) {
    lines.push('No readable .jpg, .jpeg, or .png photos found.');
  } else {
    const judged = measured.map((result) => ({
      ...result,
      ...judgeQuality(result.metrics, thresholds),
    }));

    const distribution = [['metric', ...PERCENTILES.map(([label]) => label)]];
    for (const metric of METRICS) {
      const sorted = measured.map((result) => result.metrics[metric]).sort((a, b) => a - b);
      distribution.push([
        metric,
        ...PERCENTILES.map(([, p]) => formatNumber(percentile(sorted, p))),
      ]);
    }

    const checks = [['check', 'fails when', 'failed', 'pass rate']];
    for (const { reason, metric, below, above } of TIER_A_CHECKS) {
      const failed = judged.filter((result) => result.reasons.includes(reason)).length;
      const rule = below ? `${metric} < ${thresholds[below]}` : `${metric} > ${thresholds[above]}`;
      checks.push([
        reason,
        rule,
        String(failed),
        formatPct(measured.length - failed, measured.length),
      ]);
    }
    const passed = judged.filter((result) => result.passed).length;
    checks.push([
      'all checks',
      '',
      String(measured.length - passed),
      formatPct(passed, measured.length),
    ]);

    lines.push(table(distribution, 'lrrrrrrr'), '', table(checks, 'llrr'));
    const failing = judged.filter((result) => !result.passed);
    if (failing.length > 0) {
      const rows = failing.map((result) => [`  ${result.file}`, result.reasons.join(', ')]);
      lines.push('', 'Rejected photos:', table(rows, 'll'));
    }
  }
  if (unreadable.length > 0) {
    const rows = unreadable.map((result) => [`  ${result.file}`, result.error]);
    lines.push('', 'Unreadable photos:', table(rows, 'll'));
  }
  if (skipped.length > 0) {
    const heic = skipped.some((file) => /\.hei[cf]$/i.test(file));
    lines.push(
      '',
      `Skipped ${skipped.length} files that are not .jpg, .jpeg, or .png.` +
        (heic ? ' Convert HEIC photos to JPEG first.' : ''),
    );
  }
  return lines.join('\n');
}

const csvCell = (value) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

export function toCsv(results, thresholds) {
  const rows = [['file', ...METRICS, 'passed', 'reasons', 'error']];
  for (const { file, metrics, error } of results) {
    if (error) {
      rows.push([file, ...METRICS.map(() => ''), '', '', error]);
      continue;
    }
    const { passed, reasons } = judgeQuality(metrics, thresholds);
    rows.push([file, ...METRICS.map((metric) => metrics[metric]), passed, reasons.join(';'), '']);
  }
  return `${rows.map((row) => row.map((value) => csvCell(String(value))).join(',')).join('\n')}\n`;
}

function parseOverrides(json) {
  if (!json) return {};
  const overrides = JSON.parse(json);
  for (const [key, value] of Object.entries(overrides)) {
    if (!THRESHOLD_KEYS.includes(key)) {
      throw new Error(`Unknown threshold "${key}". Use: ${THRESHOLD_KEYS.join(', ')}.`);
    }
    if (typeof value !== 'number') throw new Error(`Threshold "${key}" must be a number.`);
  }
  return overrides;
}

async function loadThresholds(overrides) {
  if (THRESHOLD_KEYS.every((key) => key in overrides)) {
    return { thresholds: overrides, source: 'thresholds from --quality' };
  }
  let env;
  try {
    env = loadEnv(process.env);
  } catch (err) {
    throw new Error(
      `${err.message}\nSet up api/.env, or give all five thresholds with --quality.`,
      {
        cause: err,
      },
    );
  }
  const config = await createConfigService({ db: createDb(env) }).getActive();
  const changed = Object.keys(overrides).length > 0;
  return {
    thresholds: { ...config.quality, ...overrides },
    source: `decision_config v${config.version}${changed ? ` with --quality ${JSON.stringify(overrides)}` : ''}`,
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { quality: { type: 'string' }, csv: { type: 'string' } },
  });
  if (positionals.length !== 1) {
    console.error("Usage: npm run gate:calibrate -- <folder> [--quality '{...}'] [--csv out.csv]");
    process.exit(1);
  }
  // npm run changes into api/; resolve paths against the folder the command was typed in.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const folder = path.resolve(cwd, positionals[0]);

  const { thresholds, source } = await loadThresholds(parseOverrides(values.quality));
  const { results, skipped } = await measureFolder(folder);
  console.log(report({ folder: positionals[0], results, skipped }, thresholds, source));
  if (values.csv) {
    await writeFile(path.resolve(cwd, values.csv), toCsv(results, thresholds));
    console.log(`\nWrote ${results.length} rows to ${values.csv}`);
  }
}

// Run only from the command line, not when tests import this file.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
