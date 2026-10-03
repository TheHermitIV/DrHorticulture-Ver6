import { setTimeout as sleep } from 'node:timers/promises';

import { InferenceError } from './errors.js';
import { parseAnalyzeResponse } from './schema.js';

// Wait before the one retry.
export const RETRY_DELAY_MS = 1000;

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// undici reports "fetch failed" and puts the useful part (ECONNREFUSED, ENOTFOUND) in cause.
function describeNetworkError(err) {
  const code = err.cause?.code;
  return code ? `${err.message} (${code})` : err.message;
}

// INFERENCE_MODE=remote: POST {INFERENCE_URL}/v1/analyze with the shared key. Each attempt gets
// timeoutMs. A network error, timeout, or 5xx is retried once after retryDelayMs; a 4xx or a
// body that fails the v1 schema is not. Any failure throws InferenceError (503).
export function createRemoteInference({
  url,
  apiKey,
  timeoutMs,
  fetch: fetchFn = globalThis.fetch,
  retryDelayMs = RETRY_DELAY_MS,
}) {
  const endpoint = new URL('v1/analyze', url.endsWith('/') ? url : `${url}/`).href;

  // { ok: true, body, response } or { ok: false, retryable, reason, body?, cause? }.
  async function attempt(request) {
    let res;
    let text;
    try {
      res = await fetchFn(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-inference-key': apiKey },
        body: JSON.stringify(request),
        redirect: 'manual', // a redirect would carry the key to another URL
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const reason =
        err.name === 'TimeoutError'
          ? `timed out after ${timeoutMs} ms`
          : `unreachable: ${describeNetworkError(err)}`;
      return { ok: false, retryable: true, reason, cause: err };
    }

    const body = parseJson(text);
    if (res.status !== 200) {
      const code = typeof body?.error?.code === 'string' ? ` ${body.error.code}` : '';
      return {
        ok: false,
        retryable: res.status >= 500,
        reason: `returned HTTP ${res.status}${code}`,
        body: body ?? null,
      };
    }
    if (body === undefined) {
      return { ok: false, retryable: false, reason: 'returned a body that is not JSON' };
    }
    const parsed = parseAnalyzeResponse(body);
    if (!parsed.success) {
      return {
        ok: false,
        retryable: false,
        reason: `returned a response that fails the v1 schema:\n${parsed.error}`,
        body,
      };
    }
    return { ok: true, body, response: parsed.data };
  }

  return {
    mode: 'remote',

    // x-mock-scenario only applies to the mock.
    parseScenario: () => null,

    // request: { image_url, image_id, species_hint }. log: the scan's logger, for the retry.
    async analyze(request, { log } = {}) {
      let result = await attempt(request);
      if (!result.ok && result.retryable) {
        log?.warn({ reason: result.reason }, 'inference call failed, retrying once');
        await sleep(retryDelayMs);
        result = await attempt(request);
      }
      if (!result.ok) {
        throw new InferenceError(`inference ${result.reason}`, {
          body: result.body,
          cause: result.cause,
        });
      }
      return { body: result.body, response: result.response };
    },
  };
}
