import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 3100);

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const rewrites = new Map([
  ['/', '/index.html'],
  ['/docs', '/docs.html'],
  ['/docs/', '/docs.html'],
  ['/HAILMARY', '/HAILMARY.html'],
  ['/HAILMARY/', '/HAILMARY.html'],
  ['/hailmary', '/HAILMARY.html'],
  ['/hailmary/', '/HAILMARY.html'],
  ['/HailMary', '/HAILMARY.html'],
  ['/HailMary/', '/HAILMARY.html'],
  ['/order-hail-mary', '/HAILMARY.html'],
  ['/order-hail-mary/', '/HAILMARY.html'],
  ['/landing', '/index.html'],
  ['/Landing.dc.html', '/index.html'],
  ['/Docs.dc.html', '/docs.html'],
]);

function resolvePath(urlPath) {
  const rewritten = rewrites.get(urlPath) ?? urlPath;
  const cleaned = normalize(rewritten).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(root, cleaned);
  if (!candidate.startsWith(root)) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  const withIndex = join(candidate, 'index.html');
  if (existsSync(withIndex) && statSync(withIndex).isFile()) {
    return withIndex;
  }
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const filePath = resolvePath(url.pathname);
  if (!filePath) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const type = types[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  createReadStream(filePath).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`@wetdrool/marketing listening on http://127.0.0.1:${port}`);
});
