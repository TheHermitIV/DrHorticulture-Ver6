import { describe, expect, it } from 'vitest';

import { mockExample } from '../src/inference/mock.js';
import { decide } from '../src/services/decision.js';
import { SEED_CONFIG } from './helpers.js';

const cfg = SEED_CONFIG; // ndvi_threshold 0.5, confidence_min 0.7, mask_min 0.8

// A response that passes every rule, with each field overridable.
function response({
  plant = true,
  angle = true,
  mask = 0.91,
  confidence = 0.78,
  ndvi = 0.62,
} = {}) {
  const body = mockExample();
  body.segmentation.plant_detected = plant;
  body.segmentation.mask_confidence = mask;
  body.checks.angle_ok = angle;
  body.estimate.confidence = confidence;
  body.estimate.ndvi = ndvi;
  return body;
}

const completed = (recommendation) => ({ status: 'completed', recommendation, reason: null });
const rejected = (reason) => ({ status: 'rejected', recommendation: null, reason });
const abstained = (reason) => ({ status: 'abstained', recommendation: 'abstain', reason });

describe('decide', () => {
  it('turns the contract example into do_not_fertilize at the v1 thresholds', () => {
    expect(decide(mockExample(), cfg)).toEqual(completed('do_not_fertilize'));
  });

  describe('rule 1: no plant detected (Tier B)', () => {
    it('rejects', () => {
      expect(decide(response({ plant: false }), cfg)).toEqual(rejected('no_plant_detected'));
    });

    it('wins over every later rule', () => {
      const worst = response({ plant: false, angle: false, mask: 0, confidence: 0, ndvi: 0 });
      expect(decide(worst, cfg)).toEqual(rejected('no_plant_detected'));
    });
  });

  describe('rule 2: bad angle (Tier B)', () => {
    it('rejects', () => {
      expect(decide(response({ angle: false }), cfg)).toEqual(rejected('bad_angle'));
    });

    it('wins over low confidence', () => {
      expect(decide(response({ angle: false, mask: 0, confidence: 0 }), cfg)).toEqual(
        rejected('bad_angle'),
      );
    });
  });

  describe('rule 3: mask confidence under mask_min', () => {
    it('abstains just under the minimum', () => {
      expect(decide(response({ mask: 0.7999 }), cfg)).toEqual(abstained('low_mask_confidence'));
    });

    it('passes exactly at the minimum', () => {
      expect(decide(response({ mask: 0.8 }), cfg).status).toBe('completed');
    });

    it('wins over low model confidence', () => {
      expect(decide(response({ mask: 0.5, confidence: 0.1 }), cfg)).toEqual(
        abstained('low_mask_confidence'),
      );
    });
  });

  describe('rule 4: model confidence under confidence_min', () => {
    it('abstains just under the minimum', () => {
      expect(decide(response({ confidence: 0.6999 }), cfg)).toEqual(abstained('low_confidence'));
    });

    it('passes exactly at the minimum', () => {
      expect(decide(response({ confidence: 0.7 }), cfg).status).toBe('completed');
    });
  });

  describe('rule 5: NDVI against ndvi_threshold', () => {
    it.each([
      [0.4999, 'fertilize'],
      [0.5, 'do_not_fertilize'],
      [-1, 'fertilize'],
      [1, 'do_not_fertilize'],
    ])('ndvi %s → %s', (ndvi, recommendation) => {
      expect(decide(response({ ndvi }), cfg)).toEqual(completed(recommendation));
    });
  });

  it('uses the thresholds it is given', () => {
    const strict = { ...cfg, ndvi_threshold: 0.9, confidence_min: 0.5, mask_min: 0.95 };
    expect(decide(response(), strict)).toEqual(abstained('low_mask_confidence'));
    expect(decide(response({ mask: 0.96 }), strict)).toEqual(completed('fertilize'));
  });
});
