import pino from 'pino';

export function createLogger(level) {
  return pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers["x-admin-key"]', 'req.headers.cookie'],
      censor: '[redacted]',
    },
  });
}
