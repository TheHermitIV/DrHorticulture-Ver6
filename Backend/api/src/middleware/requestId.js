import { randomUUID } from 'node:crypto';

const HEADER = 'x-request-id';
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

// Reuse the client's id (e.g. from the iOS app) so logs correlate across systems;
// anything unsafe to put in logs is replaced.
export function requestId(req, res, next) {
  const incoming = req.get(HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.set(HEADER, req.id);
  next();
}
