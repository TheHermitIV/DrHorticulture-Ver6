import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { createLogger } from './logger.js';

let env;
try {
  env = loadEnv(process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const logger = createLogger(env.LOG_LEVEL);
const app = createApp({ env, logger, db: createDb(env) });

// '::' accepts IPv4 and IPv6, which Railway's private network needs.
const server = app.listen(env.PORT, '::', (err) => {
  if (err) {
    logger.fatal({ err }, 'api failed to start');
    process.exit(1);
  }
  logger.info({ port: env.PORT, inferenceMode: env.INFERENCE_MODE }, 'api listening');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server');
  server.close(() => process.exit(0));
});
