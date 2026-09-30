import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requestId } from '../src/middleware/requestId.js';
import { silentLogger, testEnv } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function appThrowing(error) {
  const app = express();
  app.use(requestId);
  app.get('/boom', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('request id', () => {
  const app = createApp({ env: testEnv(), logger: silentLogger });

  it('generates a UUID and returns it in the x-request-id header', async () => {
    const res = await request(app).get('/nope');
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body.error.request_id).toBe(res.headers['x-request-id']);
  });

  it('reuses a safe incoming x-request-id', async () => {
    const res = await request(app).get('/nope').set('x-request-id', 'ios-abc.123_X');
    expect(res.headers['x-request-id']).toBe('ios-abc.123_X');
  });

  it.each([
    ['contains spaces', 'bad id "quoted"'],
    ['is too long', 'x'.repeat(129)],
  ])('replaces an incoming x-request-id that %s', async (_case, value) => {
    const res = await request(app).get('/nope').set('x-request-id', value);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('error shape', () => {
  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await request(createApp({ env: testEnv(), logger: silentLogger })).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        details: null,
        scan_id: null,
        request_id: expect.stringMatching(UUID),
      },
    });
  });

  it('maps an AppError to its status, details, and scan id', async () => {
    const error = new AppError('IMAGE_REJECTED', 'Photo is too dark.', {
      details: { reasons: ['too_dark'], hints: ['Move to bright, indirect light.'] },
      scanId: 'scan-1',
    });
    const res = await request(appThrowing(error)).get('/boom');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'IMAGE_REJECTED',
      message: 'Photo is too dark.',
      details: { reasons: ['too_dark'], hints: ['Move to bright, indirect light.'] },
      scan_id: 'scan-1',
    });
  });

  it('turns unexpected errors into a generic 500 without leaking the message', async () => {
    const res = await request(appThrowing(new Error('db password is hunter2'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('handles rejected promises from async handlers', async () => {
    const app = express();
    app.use(requestId);
    app.get('/boom', async () => {
      throw new AppError('INVALID_STATE', 'Scan is completed.');
    });
    app.use(errorHandler);
    const res = await request(app).get('/boom');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });
});
