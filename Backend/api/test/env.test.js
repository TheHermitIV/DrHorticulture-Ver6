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
      INFERENCE_TIMEOUT_MS: 60000,
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
    ['INFERENCE_API_KEY', 'too-short'],
  ])('rejects an invalid %s', (name, value) => {
    expect(() => loadEnv({ ...REQUIRED_ENV, [name]: value })).toThrow(name);
  });

  it('requires INFERENCE_URL and INFERENCE_API_KEY in remote mode', () => {
    const remote = {
      ...REQUIRED_ENV,
      INFERENCE_MODE: 'remote',
      INFERENCE_URL: 'https://inference.example.com',
      INFERENCE_API_KEY: 'test-inference-key-0123456789',
    };
    expect(loadEnv(remote)).toMatchObject({
      INFERENCE_URL: 'https://inference.example.com',
      INFERENCE_API_KEY: 'test-inference-key-0123456789',
    });

    for (const name of ['INFERENCE_URL', 'INFERENCE_API_KEY']) {
      const source = { ...remote };
      delete source[name];
      expect(() => loadEnv(source)).toThrow(`${name}: is required when INFERENCE_MODE=remote`);
    }
  });

  it('reports every variable missing in remote mode at once', () => {
    let message = '';
    try {
      loadEnv({ ...REQUIRED_ENV, INFERENCE_MODE: 'remote' });
    } catch (err) {
      message = err.message;
    }
    expect(message).toContain('INFERENCE_URL');
    expect(message).toContain('INFERENCE_API_KEY');
  });

  it('does not require the inference variables in mock mode', () => {
    const env = loadEnv(REQUIRED_ENV);
    expect(env.INFERENCE_URL).toBeUndefined();
    expect(env.INFERENCE_API_KEY).toBeUndefined();
  });

  it.each(['ADMIN_API_KEY', 'INFERENCE_API_KEY'])(
    'never includes the %s value in the error message',
    (name) => {
      const shortKey = 'tooshort-secret';
      let message = '';
      try {
        loadEnv({ ...REQUIRED_ENV, [name]: shortKey });
      } catch (err) {
        message = err.message;
      }
      expect(message).toContain(name);
      expect(message).not.toContain(shortKey);
    },
  );
});
