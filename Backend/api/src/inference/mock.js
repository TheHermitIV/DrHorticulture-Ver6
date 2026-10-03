import { AppError } from '../errors.js';
import { InferenceError } from './errors.js';
import { analyzeResponseSchema } from './schema.js';

export const MOCK_MODEL_VERSION = 'mock-0.1';

// A copy of contracts/inference.v1.example.json. Railway builds the api from api/ alone, so the
// contracts folder is not there at runtime; test/inferenceMock.test.js keeps the two equal.
const EXAMPLE = Object.freeze({
  model_version: 'stub-0.1',
  segmentation: { plant_detected: true, mask_confidence: 0.91, leaf_fraction: 0.42 },
  species: { top_label: 'geranium', top_prob: 0.83 },
  features: { vari: 0.12, exg: 0.31, gli: 0.18, ngrdi: 0.09 },
  estimate: { ndvi: 0.62, confidence: 0.78, ensemble_std: 0.04, ensemble_size: 5 },
  checks: { angle_ok: true },
});

export const mockExample = () => structuredClone(EXAMPLE);

// Forced through the x-mock-scenario header, outside production only. Without one, the mock
// returns the example, which the v1 placeholder thresholds turn into a recommendation.
export const MOCK_SCENARIOS = Object.freeze({
  low_confidence(body) {
    body.estimate.confidence = 0.2;
    body.estimate.ensemble_std = 0.3;
  },
  no_plant(body) {
    body.segmentation = { plant_detected: false, mask_confidence: 0, leaf_fraction: 0 };
  },
  error() {
    throw new InferenceError('mock scenario "error"');
  },
});

// INFERENCE_MODE=mock: answers every call with the example, so the api runs end to end with no
// inference service. allowScenarios is false in production, where the header is ignored.
export function createMockInference({ allowScenarios }) {
  return {
    mode: 'mock',

    // The scenario to force, from the x-mock-scenario header, or null. Called before anything is
    // stored, so an unknown name fails fast with 400.
    parseScenario(header) {
      if (!allowScenarios || !header) return null;
      if (!Object.hasOwn(MOCK_SCENARIOS, header)) {
        throw new AppError('VALIDATION_ERROR', `Unknown x-mock-scenario "${header}".`, {
          details: { allowed: Object.keys(MOCK_SCENARIOS) },
        });
      }
      return header;
    },

    // Same result shape as remote.js: body is what the service sent, response the parsed body.
    async analyze(_request, { scenario = null } = {}) {
      const body = mockExample();
      body.model_version = MOCK_MODEL_VERSION;
      if (scenario) MOCK_SCENARIOS[scenario](body);
      return { body, response: analyzeResponseSchema.parse(body) };
    },
  };
}
