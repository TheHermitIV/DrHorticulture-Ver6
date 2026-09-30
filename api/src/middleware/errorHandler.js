import { AppError } from '../errors.js';

export function notFoundHandler(_req, _res, next) {
  next(new AppError('NOT_FOUND', 'Route not found.'));
}

export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }
  const appError =
    err instanceof AppError
      ? err
      : new AppError('INTERNAL_ERROR', 'Something went wrong. Try again later.', { cause: err });

  // pino-http logs res.err (with stack) on its request-completed line.
  if (appError.status >= 500) {
    res.err = err;
  }

  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details,
      scan_id: appError.scanId,
      request_id: req.id ?? null,
    },
  });
}
