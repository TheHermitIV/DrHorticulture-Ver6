import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createInference } from '../src/inference/index.js';
import { testEnv } from './helpers.js';

const example = JSON.parse(
  await readFile(new URL('../../contracts/inference.v1.example.json', import.meta.url), 'utf8'),
);

const request = { image_url: 'https://storage.test/x.jpg', image_id: 'id', species_hint: null };

describe('createInference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the mock by default, with x-mock-scenario honored', async () => {
    const inference = createInference(testEnv());
    expect(inference.mode).toBe('mock');
    expect(inference.parseScenario('no_plant')).toBe('no_plant');
    const { response } = await inference.analyze(request);
    expect(response.model_version).toBe('mock-0.1');
  });

  it('ignores x-mock-scenario in production', () => {
    const inference = createInference(testEnv({ NODE_ENV: 'production' }));
    expect(inference.mode).toBe('mock');
    expect(inference.parseScenario('error')).toBeNull();
  });

  it('calls INFERENCE_URL with INFERENCE_API_KEY in remote mode', async () => {
    const fetch = vi.fn(async () => Response.json(example));
    vi.stubGlobal('fetch', fetch);
    const inference = createInference(
      testEnv({
        INFERENCE_MODE: 'remote',
        INFERENCE_URL: 'https://inference.test',
        INFERENCE_API_KEY: 'remote-key-0123456789',
      }),
    );

    expect(inference.mode).toBe('remote');
    const { response } = await inference.analyze(request);
    expect(response).toEqual(example);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://inference.test/v1/analyze');
    expect(init.headers['x-inference-key']).toBe('remote-key-0123456789');
  });
});
