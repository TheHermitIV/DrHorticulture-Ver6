import express, { Router } from 'express';

import { AppError } from '../errors.js';

export function authRouter({ auth }) {
  const router = Router();

  // A malformed JSON body is the client's mistake, not a 500.
  const jsonBody = (req, res, next) =>
    express.json({ limit: '1kb' })(req, res, (err) => {
      if (err) return next(new AppError('VALIDATION_ERROR', 'Request body must be JSON.'));
      next();
    });

  router.post('/api/v1/auth/login', jsonBody, (req, res) => {
    res.json(auth.login(req.body, req.log));
  });

  return router;
}
