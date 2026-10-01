import { createMockInference } from './mock.js';
import { createRemoteInference } from './remote.js';

// The inference adapter for INFERENCE_MODE. Both adapters have the same shape:
//   mode                          'mock' | 'remote'
//   parseScenario(header)         x-mock-scenario → scenario name or null (400 if unknown)
//   analyze(request, { log, scenario })
//                                 request: { image_url, image_id, species_hint }
//                                 → { body, response } (body as sent, response schema-parsed),
//                                   or throws InferenceError (503)
export function createInference(env) {
  if (env.INFERENCE_MODE === 'remote') {
    return createRemoteInference({
      url: env.INFERENCE_URL,
      apiKey: env.INFERENCE_API_KEY,
      timeoutMs: env.INFERENCE_TIMEOUT_MS,
    });
  }
  // x-mock-scenario is a testing aid, so production ignores it.
  return createMockInference({ allowScenarios: env.NODE_ENV !== 'production' });
}
