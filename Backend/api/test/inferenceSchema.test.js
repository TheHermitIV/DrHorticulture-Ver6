import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { analyzeResponseSchema, parseAnalyzeResponse } from '../src/inference/schema.js';

const readContract = async (name) =>
  JSON.parse(await readFile(new URL(`../../contracts/${name}`, import.meta.url), 'utf8'));

const contractSchema = await readContract('inference.v1.schema.json');
const example = await readContract('inference.v1.example.json');

// Drops what only one side writes: descriptions, zod's $schema and propertyNames, and the
// safe-integer maximum zod adds to every integer. required is a set, so its order is ignored.
function normalize(schema) {
  if (Array.isArray(schema)) return schema.map(normalize);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (['description', '$schema', 'propertyNames'].includes(key)) continue;
    if (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) continue;
    out[key] = key === 'required' ? [...value].sort() : normalize(value);
  }
  return out;
}

const valid = () => structuredClone(example);

describe('analyzeResponseSchema', () => {
  // Equal schemas mean that anything the zod schema accepts, the contract's JSON Schema accepts
  // too, so the example passing zod also proves it passes inference.v1.schema.json.
  it('matches AnalyzeResponse in contracts/inference.v1.schema.json', () => {
    expect(normalize(z.toJSONSchema(analyzeResponseSchema, { io: 'input' }))).toEqual(
      normalize(contractSchema.$defs.AnalyzeResponse),
    );
  });

  it('accepts contracts/inference.v1.example.json unchanged', () => {
    expect(analyzeResponseSchema.parse(example)).toEqual(example);
  });

  it('accepts empty features, a calibration_card, and unknown keys', () => {
    const body = { ...valid(), features: {}, extra: 1 };
    body.checks.calibration_card = false;
    const result = parseAnalyzeResponse(body);
    expect(result.success).toBe(true);
    expect(result.data.checks.calibration_card).toBe(false);
    expect(result.data).not.toHaveProperty('extra');
  });

  it('accepts negative color features and the ends of every range', () => {
    const body = valid();
    body.features = { vari: -0.4, exg: -1.7 };
    body.segmentation = { plant_detected: true, mask_confidence: 0, leaf_fraction: 1 };
    body.estimate = { ndvi: -1, confidence: 1, ensemble_std: 0, ensemble_size: 1 };
    expect(parseAnalyzeResponse(body).success).toBe(true);
  });

  it.each([
    ['model_version', ''],
    ['segmentation.plant_detected', 'yes'],
    ['segmentation.mask_confidence', 1.01],
    ['segmentation.leaf_fraction', -0.01],
    ['species.top_label', ''],
    ['species.top_prob', 2],
    ['features.vari', '0.12'],
    ['estimate.ndvi', 1.2],
    ['estimate.ndvi', -1.01],
    ['estimate.confidence', -0.1],
    ['estimate.ensemble_std', -0.01],
    ['estimate.ensemble_size', 0],
    ['estimate.ensemble_size', 2.5],
    ['checks.angle_ok', null],
    ['checks.calibration_card', 'no'],
  ])('rejects %s = %j and names the field', (field, value) => {
    const body = valid();
    const [section, key] = field.split('.');
    if (key) body[section][key] = value;
    else body[section] = value;
    const result = parseAnalyzeResponse(body);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(field);
  });

  it.each([
    'model_version',
    'segmentation',
    'species',
    'features',
    'estimate',
    'checks',
    'segmentation.mask_confidence',
    'estimate.ensemble_size',
    'checks.angle_ok',
  ])('rejects a body without %s', (field) => {
    const body = valid();
    const [section, key] = field.split('.');
    if (key) delete body[section][key];
    else delete body[section];
    const result = parseAnalyzeResponse(body);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(field);
  });

  it.each([null, 'ok', [], 42])('rejects a body that is not an object: %j', (body) => {
    expect(parseAnalyzeResponse(body).success).toBe(false);
  });
});
