import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { silentLogger, testEnv } from './helpers.js';

const appFor = (NODE_ENV) => createApp({ env: testEnv({ NODE_ENV }), logger: silentLogger });

describe('GET /test.html', () => {
  it.each(['development', 'test'])('serves the upload page when NODE_ENV=%s', async (nodeEnv) => {
    const res = await request(appFor(nodeEnv)).get('/test.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/api/v1/scans');
  });

  it('is not served in production', async () => {
    const res = await request(appFor('production')).get('/test.html');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
