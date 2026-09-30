import { describe, expect, it } from 'vitest';

import { loadEnv } from '../src/config/env.js';
import { REQUIRED_ENV } from './helpers.js';

describe('loadEnv', () => {
  it('applies defaults when only the required variables are set', () => {
    const env = loadEnv(REQUIRED_ENV);
    expect(env).toMatchObject({
      PORT: 3000,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      SUPABASE_BUCKET: 'scan-images',
      INFERENCE_MODE: 'mock',
      INFERENCE_TIMEOUT_MS: 30000,
      MAX_UPLOAD_MB: 10,
      CORS_ORIGINS: [],
      RATE_LIMIT_PER_MIN: 30,
      AUTH_REQUIRED: false,
    });
  });

  it('coerces numbers and parses booleans and lists from strings', () => {
    const env = loadEnv({
      ...REQUIRED_ENV,
      PORT: '8080',
      AUTH_REQUIRED: 'true',
      CORS_ORIGINS: 'http://localhost:3000, https://app.example.com ,',
    });
    expect(env.PORT).toBe(8080);
    expect(env.AUTH_REQUIRED).toBe(true);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('treats AUTH_REQUIRED=false as false', () => {
    expect(loadEnv({ ...REQUIRED_ENV, AUTH_REQUIRED: 'false' }).AUTH_REQUIRED).toBe(false);
  });

  it('treats empty strings as unset', () => {
    const env = loadEnv({ ...REQUIRED_ENV, INFERENCE_URL: '', PORT: '' });
    expect(env.INFERENCE_URL).toBeUndefined();
    expect(env.PORT).toBe(3000);
  });

  it('drops variables it does not know about', () => {
    expect(loadEnv({ ...REQUIRED_ENV, PATH: '/usr/bin' })).not.toHaveProperty('PATH');
  });

  it.each(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_API_KEY'])(
    'rejects a missing %s',
    (name) => {
      const source = { ...REQUIRED_ENV };
      delete source[name];
      expect(() => loadEnv(source)).toThrow(name);
    },
  );

  it.each([
    ['INFERENCE_MODE', 'grpc'],
    ['SUPABASE_URL', 'not a url'],
    ['PORT', 'abc'],
    ['AUTH_REQUIRED', 'yes'],
    ['LOG_LEVEL', 'verbose'],
  ])('rejects an invalid %s', (name, value) => {
    expect(() => loadEnv({ ...REQUIRED_ENV, [name]: value })).toThrow(name);
  });

  it('requires INFERENCE_URL in remote mode', () => {
    expect(() => loadEnv({ ...REQUIRED_ENV, INFERENCE_MODE: 'remote' })).toThrow('INFERENCE_URL');
    const env = loadEnv({
      ...REQUIRED_ENV,
      INFERENCE_MODE: 'remote',
      INFERENCE_URL: 'http://inference.railway.internal:8000',
    });
    expect(env.INFERENCE_URL).toBe('http://inference.railway.internal:8000');
  });

  it('never includes secret values in the error message', () => {
    const shortKey = 'tooshort-secret';
    let message = '';
    try {
      loadEnv({ ...REQUIRED_ENV, ADMIN_API_KEY: shortKey });
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain('ADMIN_API_KEY');
    expect(message).not.toContain(shortKey);
  });
});
