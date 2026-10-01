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

// In-memory stand-in for src/db/client.js. failOn: 'scans.insert' | 'scanImages.insert'.
export function fakeDb({ failOn } = {}) {
  const tables = { scans: [], scan_images: [] };
  const now = () => new Date().toISOString();
  const maybeFail = (query) => {
    if (failOn === query) throw new Error(`Database ${query} failed: connection reset`);
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
        return saved;
      },
      async remove(id) {
        tables.scans = tables.scans.filter((scan) => scan.id !== id);
        tables.scan_images = tables.scan_images.filter((image) => image.scan_id !== id);
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
        return saved;
      },
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
    async remove(path) {
      objects.delete(path);
    },
  };
}
