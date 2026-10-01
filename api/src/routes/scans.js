import { Router } from 'express';

import { uploadImage } from '../middleware/upload.js';

export function scansRouter({ env, pipeline, reader }) {
  const router = Router();
  const upload = uploadImage({ maxUploadMb: env.MAX_UPLOAD_MB });

  router.post('/api/v1/scans', upload, async (req, res) => {
    const scan = await pipeline.submitScan({
      image: req.image,
      fields: req.body,
      scenario: req.get('x-mock-scenario'),
      log: req.log,
    });
    res.status(201).json(scan);
  });

  router.get('/api/v1/scans', async (req, res) => {
    res.json(await reader.list(req.query));
  });

  router.get('/api/v1/scans/:id', async (req, res) => {
    res.json(await reader.get(req.params.id));
  });

  return router;
}
