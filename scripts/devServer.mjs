// Minimal static dev server for the VoxNav frontend (no dependencies).
// Sends `Cache-Control: no-store` on every response: the app is plain ES modules, and without it
// browsers heuristically cache imported modules (e.g. browserDetector.js) and keep running stale
// code after an update even when index.html is fresh.
//
// Usage: node scripts/devServer.mjs [port]   (default 4173, binds localhost only)

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.yaml': 'text/yaml; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

// Never serve secrets or tooling directories
const BLOCKED = [/(^|[\\/])\.env/i, /(^|[\\/])\.git([\\/]|$)/i, /(^|[\\/])\.venv([\\/]|$)/i, /(^|[\\/])node_modules([\\/]|$)/i, /(^|[\\/])backend([\\/]|$)/i];

createServer((req, res) => {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT + sep) || BLOCKED.some(re => re.test(file.slice(ROOT.length)))) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat;
  try { stat = statSync(file); } catch { stat = null; }
  if (!stat || !stat.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store'
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`VoxNav frontend: http://localhost:${PORT}  (no-store, serving ${ROOT})`);
});
