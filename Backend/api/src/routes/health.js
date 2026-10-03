import { Router } from 'express';

export function healthRouter({ env, db }) {
  const router = Router();

  // TODO(decision): should a database outage make /health return 503? It stays 200 for now so
  // Railway's healthcheck only tracks whether the process is up.
  router.get('/health', async (req, res) => {
    const dbStatus = await db.ping();
    if (!dbStatus.ok) {
      req.log.warn({ dbError: dbStatus.error }, 'database health check failed');
    }
    res.json({
      status: dbStatus.ok ? 'ok' : 'degraded',
      db: dbStatus.ok ? 'ok' : 'error',
      inference_mode: env.INFERENCE_MODE,
    });
  });

  return router;
}
