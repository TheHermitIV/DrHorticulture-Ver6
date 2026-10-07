import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { InferenceError } from '../src/inference/errors.js';
import { createRemoteInference } from '../src/inference/remote.js';

const example = JSON.parse(
  await readFile(new URL('../../contracts/inference.v1.example.json', import.meta.url), 'utf8'),
);

const KEY = 'test-inference-key-0123';
const request = {
  image_url: 'https://storage.test/scans/s/i.jpg?token=abc',
  image_id: '0b6c1f0e-8f5d-4a59-9a43-5d3f3b8c2d10',
  species_hint: 'geranium',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const networkError = () =>
  Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
const timeoutError = () =>
  new DOMException('The operation was aborted due to timeout', 'TimeoutError');

// A fetch that plays its answers in order: a Response to return, or an Error to throw.
function scriptedFetch(...answers) {
  return vi.fn(async () => {
    const answer = answers.shift();
    if (!answer) throw new Error('fetch called more times than scripted');
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

function remote(fetch, overrides = {}) {
  return createRemoteInference({
    url: 'https://inference.test',
    apiKey: KEY,
    timeoutMs: 60_000,
    fetch,
    retryDelayMs: 0,
    ...overrides,
  });
}

const log = () => ({ warn: vi.fn() });

describe('remote inference', () => {
  it('posts the request to /v1/analyze with the shared key', async () => {
    const fetch = scriptedFetch(json(example));
    const result = await remote(fetch).analyze(request);

    expect(result).toEqual({ body: example, response: example });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://inference.test/v1/analyze');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-inference-key': KEY });
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['https://inference.test/', 'https://inference.test/v1/analyze'],
    ['https://host.test/team/inference', 'https://host.test/team/inference/v1/analyze'],
  ])('builds the endpoint from INFERENCE_URL %s', async (url, endpoint) => {
    const fetch = scriptedFetch(json(example));
    await remote(fetch, { url }).analyze(request);
    expect(fetch.mock.calls[0][0]).toBe(endpoint);
  });

  it('keeps unknown keys in body but not in response', async () => {
    const fetch = scriptedFetch(json({ ...example, debug: { ms: 12 } }));
    const { body, response } = await remote(fetch).analyze(request);
    expect(body.debug).toEqual({ ms: 12 });
    expect(response).not.toHaveProperty('debug');
  });

  describe('retries once', () => {
    it.each([
      ['a timeout', timeoutError()],
      ['a network error', networkError()],
      ['a 5xx', json({ error: { code: 'MODEL_ERROR', message: 'boom' } }, 502)],
    ])('after %s, then succeeds', async (_name, first) => {
      const fetch = scriptedFetch(first, json(example));
      const scanLog = log();
      const { response } = await remote(fetch).analyze(request, { log: scanLog });
      expect(response).toEqual(example);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(scanLog.warn).toHaveBeenCalledTimes(1);
    });

    it('waits retryDelayMs before the retry', async () => {
      vi.useFakeTimers();
      try {
        const fetch = scriptedFetch(networkError(), json(example));
        const call = remote(fetch, { retryDelayMs: 1000 }).analyze(request);
        await vi.advanceTimersByTimeAsync(999);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await call;
        expect(fetch).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('and fails with the last reason when the retry fails too', async () => {
      const fetch = scriptedFetch(networkError(), json({}, 503));
      const failure = remote(fetch).analyze(request);
      await expect(failure).rejects.toBeInstanceOf(InferenceError);
      await expect(failure).rejects.toMatchObject({
        code: 'INFERENCE_UNAVAILABLE',
        status: 503,
        reason: 'inference returned HTTP 503',
        body: {},
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  it('times out each attempt after timeoutMs', async () => {
    // Never answers; rejects only when the request's signal aborts.
    const fetch = vi.fn(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        }),
    );
    const failure = remote(fetch, { timeoutMs: 20 }).analyze(request);
    await expect(failure).rejects.toMatchObject({ reason: 'inference timed out after 20 ms' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('names the network error code', async () => {
    const fetch = scriptedFetch(networkError(), networkError());
    await expect(remote(fetch).analyze(request)).rejects.toMatchObject({
      reason: 'inference unreachable: fetch failed (ECONNREFUSED)',
    });
  });

  describe('does not retry', () => {
    it('a 4xx, and keeps its error code', async () => {
      const body = { error: { code: 'UNAUTHORIZED', message: 'bad key' } };
      const fetch = scriptedFetch(json(body, 401));
      await expect(remote(fetch).analyze(request)).rejects.toMatchObject({
        reason: 'inference returned HTTP 401 UNAUTHORIZED',
        body,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('a redirect, so the key is never sent to another URL', async () => {
      const redirect = new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.test/' },
      });
      const fetch = scriptedFetch(redirect);
      await expect(remote(fetch).analyze(request)).rejects.toMatchObject({
        reason: 'inference returned HTTP 302',
        body: null,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('a body that fails the v1 schema, and keeps the body', async () => {
      const bad = structuredClone(example);
      bad.estimate.confidence = 1.5;
      const fetch = scriptedFetch(json(bad));
      const failure = remote(fetch).analyze(request);
      await expect(failure).rejects.toMatchObject({ body: bad });
      await expect(failure).rejects.toHaveProperty(
        'reason',
        expect.stringMatching(/fails the v1 schema:[\s\S]*estimate\.confidence/),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('a 200 that is not JSON', async () => {
      const fetch = scriptedFetch(new Response('<html>ok</html>', { status: 200 }));
      await expect(remote(fetch).analyze(request)).rejects.toMatchObject({
        reason: 'inference returned a body that is not JSON',
        body: null,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('never puts the key or the signed URL in the error', async () => {
    const fetch = scriptedFetch(json({}, 500), json({}, 500));
    const err = await remote(fetch)
      .analyze(request)
      .catch((error) => error);
    const text = JSON.stringify({ message: err.message, reason: err.reason, body: err.body });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('token=abc');
  });

  it('ignores x-mock-scenario', () => {
    expect(remote(scriptedFetch()).parseScenario('error')).toBeNull();
  });
});
