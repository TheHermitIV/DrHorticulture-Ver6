import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { fakeDb, silentLogger, testEnv } from './helpers.js';

const ACCOUNT = { LOGIN_USERNAME: 'admin', LOGIN_PASSWORD: 'test-password' };

function appWith(envOverrides = ACCOUNT) {
  return createApp({ env: testEnv(envOverrides), logger: silentLogger, db: fakeDb() });
}

function login(app, body) {
  return request(app).post('/api/v1/auth/login').send(body);
}

describe('POST /api/v1/auth/login', () => {
  it('accepts the configured username and password', async () => {
    const res = await login(appWith(), { username: 'admin', password: 'test-password' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ username: 'admin' });
  });

  it.each([
    ['a wrong password', { username: 'admin', password: 'nope' }],
    ['a wrong username', { username: 'root', password: 'test-password' }],
    ['a password that only differs in case', { username: 'admin', password: 'Test-Password' }],
  ])('refuses %s with 401 and the same message', async (_label, body) => {
    const res = await login(appWith(), body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Incorrect username or password.',
    });
    expect(res.body.error.request_id).toEqual(expect.any(String));
  });

  it('refuses every login when no account is configured', async () => {
    const res = await login(appWith({}), { username: 'admin', password: 'test-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['an empty body', {}],
    ['a missing password', { username: 'admin' }],
    ['a non-string password', { username: 'admin', password: 123 }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await login(appWith(), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(appWith())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"username":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
