import { z } from 'zod';

import { AppError } from '../errors.js';
import { toScanObject } from './scanObject.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// created_at as Postgres returns it, such as 2026-10-01T15:04:05.123456+00:00.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

const listQuerySchema = z.object({
  // TODO(decision): the default page size; the spec only caps limit at 50.
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

const notFound = () => new AppError('NOT_FOUND', 'Scan not found.');
const invalid = (field, details = null) =>
  new AppError('VALIDATION_ERROR', `Invalid query parameter: ${field}.`, { details });

// The cursor names the last scan on a page; it is opaque to clients.
const encodeCursor = (scan) =>
  Buffer.from(JSON.stringify([scan.created_at, scan.id])).toString('base64url');

function decodeCursor(cursor) {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (TIMESTAMP.test(createdAt) && UUID.test(id)) return { created_at: createdAt, id };
  } catch {
    // falls through to the 400
  }
  throw invalid('cursor');
}

function parseListQuery(query) {
  const result = listQuerySchema.safeParse(query ?? {});
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw invalid(issues[0].field, { issues });
  }
  const { limit, cursor } = result.data;
  return { limit, before: cursor === undefined ? null : decodeCursor(cursor) };
}

// GET /scans/:id and GET /scans. A scan's object shows its latest image and that image's latest
// analysis, so it always reflects the most recent photo.
// Phase 6 (AUTH_REQUIRED) scopes both to the scan's owner; until then every scan is visible.
export function createScanReader({ db, storage }) {
  async function toObjects(scans) {
    if (scans.length === 0) return [];
    const images = await db.scanImages.latestByScan(scans.map((scan) => scan.id));
    const latestImages = [...images.values()];
    const [analyses, urls] = await Promise.all([
      db.analyses.latestByImage(latestImages.map((image) => image.id)),
      storage.signedUrls(
        latestImages.map((image) => image.storage_path),
        'client',
      ),
    ]);
    return scans.map((scan) => {
      const image = images.get(scan.id) ?? null;
      return toScanObject({
        scan,
        image,
        imageUrl: image ? (urls.get(image.storage_path) ?? null) : null,
        analysis: image ? (analyses.get(image.id) ?? null) : null,
      });
    });
  }

  return {
    async get(id) {
      const scan = UUID.test(id) ? await db.scans.get(id) : null;
      if (!scan) throw notFound();
      const [object] = await toObjects([scan]);
      return object;
    },

    // query: req.query. → { items, next_cursor }, newest first; next_cursor is null on the
    // last page.
    async list(query) {
      const { limit, before } = parseListQuery(query);
      const rows = await db.scans.list({ limit: limit + 1, before });
      const page = rows.slice(0, limit);
      return {
        items: await toObjects(page),
        next_cursor: rows.length > limit ? encodeCursor(page.at(-1)) : null,
      };
    },
  };
}
