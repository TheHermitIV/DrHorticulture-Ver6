import { AppError } from '../errors.js';

// A failed inference call: a timeout, a network error, a non-200 response, or a body that fails
// the v1 schema. Clients get a generic 503; reason says what went wrong, for logs and
// analyses.error, and body is the response body when one was received, for analyses.raw_response.
// The scan becomes 'failed', never 'abstained'.
export class InferenceError extends AppError {
  constructor(reason, { body = null, cause } = {}) {
    super('INFERENCE_UNAVAILABLE', 'Plant analysis is unavailable right now. Try again later.', {
      cause,
    });
    this.name = 'InferenceError';
    this.reason = reason;
    this.body = body;
  }
}
