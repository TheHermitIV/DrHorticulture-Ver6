import { fileURLToPath } from 'node:url';

import express from 'express';
import { pinoHttp } from 'pino-http';

import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { healthRouter } from './routes/health.js';
import { scansRouter } from './routes/scans.js';
import { createConfigService } from './services/configService.js';
import { createPipeline } from './services/pipeline.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

function logLevelFor(_req, res, err) {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}

export function createApp({ env, logger, db, storage }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, customLogLevel: logLevelFor }));

  const config = createConfigService({ db });

  app.use(healthRouter({ env, db }));
  app.use(scansRouter({ env, pipeline: createPipeline({ db, storage, config }) }));

  // public/test.html: a one-button upload page for local testing, never served in production.
  if (env.NODE_ENV !== 'production') {
    app.use(express.static(PUBLIC_DIR));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
