#!/usr/bin/env node
/**
 * Local no-JS onion gateway for development (also works behind Tor).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3080);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function securityHeaders(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self' data:; style-src 'self'; script-src 'none'; connect-src 'none'; object-src 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/healthz' || url.pathname === '/api/health') {
    const { default: health } = await import('../api/health.js');
    return health(req, res);
  }

  if (url.pathname === '/room' || url.pathname === '/room/' || url.pathname === '/api/room') {
    const { default: room } = await import('../api/room.js');
    // shim Vercel-like req
    const body = req.method === 'POST' ? await readBody(req) : null;
    if (body) {
      req[Symbol.asyncIterator] = async function* () {
        yield body;
      };
    }
    return room(req, res);
  }

  let filePath = path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(publicDir)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`WetDrool onion gateway (no JS) http://127.0.0.1:${port}`);
});
