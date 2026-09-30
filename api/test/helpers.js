import pino from 'pino';

import { loadEnv } from '../src/config/env.js';

export const silentLogger = pino({ level: 'silent' });

export const REQUIRED_ENV = Object.freeze({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  ADMIN_API_KEY: 'test-admin-key-0123456789',
});

export function testEnv(overrides = {}) {
  return loadEnv({ ...REQUIRED_ENV, ...overrides });
}
