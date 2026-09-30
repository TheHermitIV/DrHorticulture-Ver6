export const ERROR_STATUS = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IMAGE_REJECTED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  INFERENCE_UNAVAILABLE: 503,
});

export class AppError extends Error {
  constructor(code, message, { details = null, scanId = null, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
    this.scanId = scanId;
  }
}
