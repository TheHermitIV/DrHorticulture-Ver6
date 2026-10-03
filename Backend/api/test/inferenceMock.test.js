import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { InferenceError } from '../src/inference/errors.js';
import {
  createMockInference,
  MOCK_MODEL_VERSION,
  MOCK_SCENARIOS,
  mockExample,
} from '../src/inference/mock.js';

const example = JSON.parse(
  await readFile(new URL('../../contracts/inference.v1.example.json', import.meta.url), 'utf8'),
);

const request = { image_url: 'https://storage.test/x.jpg', image_id: 'id', species_hint: null };

describe('mock inference', () => {
  const mock = createMockInference({ allowScenarios: true });

  // The mock keeps its own copy because Railway builds the api without the contracts folder.
  it('keeps an exact copy of contracts/inference.v1.example.json', () => {
    expect(mockExample()).toEqual(example);
  });

  it('returns the example with model_version mock-0.1', async () => {
    const { body, response } = await mock.analyze(request);
    expect(body).toEqual({ ...example, model_version: MOCK_MODEL_VERSION });
    expect(response).toEqual(body);
  });

  it('returns a fresh copy each call', async () => {
    const first = await mock.analyze(request);
    first.body.estimate.ndvi = 0;
    const second = await mock.analyze(request);
    expect(second.body.estimate.ndvi).toBe(example.estimate.ndvi);
  });

  it('forces low confidence', async () => {
    const { response } = await mock.analyze(request, { scenario: 'low_confidence' });
    expect(response.estimate.confidence).toBe(0.2);
    expect(response.segmentation.plant_detected).toBe(true);
  });

  it('forces no plant, with every required field still filled in', async () => {
    const { response } = await mock.analyze(request, { scenario: 'no_plant' });
    expect(response.segmentation).toEqual({
      plant_detected: false,
      mask_confidence: 0,
      leaf_fraction: 0,
    });
  });

  it('forces an inference failure (503)', async () => {
    const failure = mock.analyze(request, { scenario: 'error' });
    await expect(failure).rejects.toBeInstanceOf(InferenceError);
    await expect(failure).rejects.toMatchObject({
      code: 'INFERENCE_UNAVAILABLE',
      status: 503,
      reason: 'mock scenario "error"',
    });
  });

  describe('parseScenario', () => {
    it.each(Object.keys(MOCK_SCENARIOS))('accepts %s', (name) => {
      expect(mock.parseScenario(name)).toBe(name);
    });

    it.each([undefined, ''])('returns null without a header (%j)', (header) => {
      expect(mock.parseScenario(header)).toBeNull();
    });

    it.each(['low-confidence', 'toString', '__proto__'])('rejects %s with 400', (header) => {
      expect(() => mock.parseScenario(header)).toThrow(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: { allowed: ['low_confidence', 'no_plant', 'error'] },
        }),
      );
    });

    it('ignores the header in production', () => {
      const production = createMockInference({ allowScenarios: false });
      expect(production.parseScenario('error')).toBeNull();
      expect(production.parseScenario('nonsense')).toBeNull();
    });
  });
});
