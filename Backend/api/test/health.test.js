import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { silentLogger, testEnv } from './helpers.js';

function appWithDb(pingResult, envOverrides) {
  return createApp({
    env: testEnv(envOverrides),
    logger: silentLogger,
    db: { ping: async () => pingResult },
  });
}

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const res = await request(appWithDb({ ok: true })).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', inference_mode: 'mock' });
  });

  it('stays 200 but reports degraded when the database fails, without exposing the error', async () => {
    const res = await request(
      appWithDb({ ok: false, error: 'relation "decision_config" does not exist' }),
    ).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'degraded', db: 'error', inference_mode: 'mock' });
  });

  it('reports the configured inference mode', async () => {
    const res = await request(
      appWithDb(
        { ok: true },
        {
          INFERENCE_MODE: 'remote',
          INFERENCE_URL: 'https://inference.example.com',
          INFERENCE_API_KEY: 'test-inference-key-0123456789',
        },
      ),
    ).get('/health');
    expect(res.body.inference_mode).toBe('remote');
  });
});
