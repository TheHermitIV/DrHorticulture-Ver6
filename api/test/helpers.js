import { randomUUID } from 'node:crypto';

import pino from 'pino';

import { loadEnv } from '../src/config/env.js';
import { objectPath } from '../src/services/storage.js';

export const silentLogger = pino({ level: 'silent' });

export const REQUIRED_ENV = Object.freeze({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ADMIN_API_KEY: 'test-admin-key-0123456789',
});

export function testEnv(overrides = {}) {
  return loadEnv({ ...REQUIRED_ENV, ...overrides });
}

// The v1 seed row from supabase/migrations/0001_init.sql, as the config service returns it.
export const SEED_CONFIG = Object.freeze({
  version: 1,
  ndvi_threshold: 0.5,
  confidence_min: 0.7,
  mask_min: 0.8,
  quality: Object.freeze({
    min_short_side_px: 1024,
    luminance_min: 60,
    luminance_max: 200,
    clipped_max_pct: 5,
    blur_min: 100,
  }),
});

// In-memory stand-in for src/db/client.js. failOn: a query to fail, such as 'scans.insert',
// 'scanImages.update', or 'analyses.insert'. config: the active decision_config row (null for
// none).
export function fakeDb({ failOn, config = SEED_CONFIG } = {}) {
  const tables = { scans: [], scan_images: [], analyses: [] };
  // Strictly increasing, like rows written by separate requests to Postgres.
  let clock = 0;
  const now = () => {
    clock = Math.max(Date.now(), clock + 1);
    return new Date(clock).toISOString();
  };
  // Map key → newest row per value; rows are appended, so the last one written wins.
  const latestBy = (rows, key, values) => {
    const latest = new Map();
    for (const row of rows.toReversed()) {
      if (values.includes(row[key]) && !latest.has(row[key])) latest.set(row[key], { ...row });
    }
    return latest;
  };
  // created_at desc, then id desc, as db/scans.js orders them.
  const newerFirst = (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
  const olderThan = (row, before) =>
    row.created_at < before.created_at ||
    (row.created_at === before.created_at && row.id < before.id);
  const maybeFail = (query) => {
    if (failOn === query) throw new Error(`Database ${query} failed: connection reset`);
  };
  const updateRow = (table, id, fields) => {
    const row = tables[table].find((candidate) => candidate.id === id);
    if (!row) throw new Error(`Database update ${table} failed: no row ${id}`);
    return Object.assign(row, fields);
  };
  return {
    tables,
    ping: async () => ({ ok: true }),
    scans: {
      async insert(row) {
        maybeFail('scans.insert');
        const saved = {
          user_id: null,
          source: 'app',
          created_at: now(),
          updated_at: now(),
          ...row,
        };
        tables.scans.push(saved);
        return { ...saved };
      },
      async get(id) {
        const scan = tables.scans.find((row) => row.id === id);
        return scan ? { ...scan } : null;
      },
      async list({ limit, before = null }) {
        return tables.scans
          .filter((row) => !before || olderThan(row, before))
          .sort(newerFirst)
          .slice(0, limit)
          .map((row) => ({ ...row }));
      },
      async setStatus(id, status, { from } = {}) {
        maybeFail('scans.setStatus');
        if (from && !from.includes(tables.scans.find((row) => row.id === id)?.status)) {
          return null;
        }
        return { ...updateRow('scans', id, { status, updated_at: now() }) };
      },
      async remove(id) {
        tables.scans = tables.scans.filter((scan) => scan.id !== id);
        tables.scan_images = tables.scan_images.filter((image) => image.scan_id !== id);
        tables.analyses = tables.analyses.filter((analysis) => analysis.scan_id !== id);
      },
    },
    scanImages: {
      async insert(row) {
        maybeFail('scanImages.insert');
        const saved = {
          quality_passed: null,
          quality_metrics: {},
          rejection_reasons: [],
          created_at: now(),
          ...row,
        };
        tables.scan_images.push(saved);
        return { ...saved };
      },
      async latestByScan(scanIds) {
        return latestBy(tables.scan_images, 'scan_id', scanIds);
      },
      async update(id, fields) {
        maybeFail('scanImages.update');
        return { ...updateRow('scan_images', id, fields) };
      },
    },
    analyses: {
      async insert(row) {
        maybeFail('analyses.insert');
        const saved = {
          id: randomUUID(),
          model_version: null,
          mask_confidence: null,
          leaf_fraction: null,
          features: {},
          ndvi: null,
          confidence: null,
          recommendation: null,
          abstain_reason: null,
          raw_response: null,
          error: null,
          latency_ms: null,
          created_at: now(),
          ...row,
        };
        tables.analyses.push(saved);
        return { ...saved };
      },
      async latestByImage(imageIds) {
        return latestBy(tables.analyses, 'image_id', imageIds);
      },
    },
    decisionConfig: {
      getActive: async () => (config ? structuredClone(config) : null),
    },
  };
}

// In-memory stand-in for src/services/storage.js.
export function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    async uploadOriginal({ scanId, imageId, image }) {
      const path = objectPath({ scanId, imageId, ext: image.ext });
      if (objects.has(path)) throw new Error('Storage upload failed: The resource already exists');
      objects.set(path, Buffer.from(image.buffer));
      return path;
    },
    async signedUrl(path, purpose) {
      return `https://storage.test/${path}?purpose=${purpose}`;
    },
    async signedUrls(paths, purpose) {
      return new Map(
        paths.map((path) => [path, `https://storage.test/${path}?purpose=${purpose}`]),
      );
    },
    async remove(path) {
      objects.delete(path);
    },
  };
}
