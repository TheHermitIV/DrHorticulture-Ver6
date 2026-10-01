import { Router } from 'express';

import { uploadImage } from '../middleware/upload.js';

export function scansRouter({ env, pipeline }) {
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

  return router;
}
