// Serves the test pages in public/ on localhost and forwards their /api/* and /health requests to a
// deployed api, so the browser sees one origin and needs no CORS (spec task 6.1 adds that to the
// api). The deployed api runs the whole pipeline: every upload is a real scan in its Supabase
// project. The mask editor processes files locally in the browser.
//
//   npm run test-page                                  # http://localhost:3000 -> production api
//   npm run test-page -- --api http://localhost:4000 --port 3001
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The iOS app's default base URL (Front-End/DrHorticulture/Services/APIAnalysisService.swift).
const PRODUCTION_API = 'https://drhorticulture-ver6-production.up.railway.app';
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

function isForwarded(pathname) {
  return pathname.startsWith('/api/') || pathname === '/health';
}

function sendError(res, status, code, message) {
  if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

// Streams the request to the api and its reply back unchanged; only Host is rewritten.
function forward(api, req, res) {
  const target = new URL(req.url, api);
  const client = target.protocol === 'https:' ? https : http;
  const upstream = client.request(
    target,
    { method: req.method, headers: { ...req.headers, host: target.host } },
    (reply) => {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    },
  );
  upstream.on('error', (err) => sendError(res, 502, 'PROXY_ERROR', err.message));
  req.pipe(upstream);
}

async function serveFile(pathname, res) {
  const file = path.resolve(PUBLIC_DIR, `.${pathname === '/' ? '/test.html' : pathname}`);
  const type = TYPES[path.extname(file)];
  if (!type || !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendError(res, 404, 'NOT_FOUND', `No page at ${pathname}.`);
  }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    return sendError(res, 404, 'NOT_FOUND', `No page at ${pathname}.`);
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: PRODUCTION_API },
    port: { type: 'string', default: '3000' },
  },
});
const api = new URL(values.api);

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return sendError(res, 400, 'BAD_REQUEST', 'Malformed URL.');
  }
  if (isForwarded(pathname)) return forward(api, req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', `${req.method} ${pathname}`);
  }
  serveFile(pathname, res).catch((err) => sendError(res, 500, 'INTERNAL', err.message));
});

server.listen(Number(values.port), 'localhost', () => {
  const base = `http://localhost:${values.port}`;
  console.log(`Forwarding /api/* and /health to ${api.origin}`);
  console.log(`  Upload:     ${base}/test.html`);
  console.log(`  Image data: ${base}/ImageData.html`);
  console.log(`  Mask editor: ${base}/leaf-mask.html`);
});
