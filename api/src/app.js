import express from 'express';
import { pinoHttp } from 'pino-http';

import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';

function logLevelFor(_req, res, err) {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}

export function createApp({ logger }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, customLogLevel: logLevelFor }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
