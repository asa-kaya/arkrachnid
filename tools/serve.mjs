// Tiny static server for ArkRachnid.
// Usage: node tools/serve.mjs [port]     (default 5173)
//   /        -> web/index.html
//   /data/*  -> data/*   (built by tools/build-index.mjs)
//   /*       -> web/*

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.argv[2] || process.env.PORT || 5173);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
const gzCache = new Map(); // file -> {mtime, buf}

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  let base = WEB;
  if (p === '/' || p === '') p = '/index.html';
  if (p.startsWith('/data/')) { base = DATA; p = p.slice(5); }
  const full = path.resolve(base, '.' + p);
  if (full !== base && !full.startsWith(base + path.sep)) return null; // traversal guard
  return full;
}

const server = http.createServer((req, res) => {
  const file = resolve(req.url);
  if (!file) { res.writeHead(403).end('Forbidden'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(file.startsWith(DATA) ? 'Not found. Run: node tools/build-index.mjs' : 'Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Last-Modified': st.mtime.toUTCString(),
      'X-Raw-Length': String(st.size),
    };
    if (req.headers['if-modified-since'] && new Date(req.headers['if-modified-since']) >= new Date(st.mtime.toUTCString())) {
      res.writeHead(304, headers).end();
      return;
    }
    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wantsGzip && COMPRESS.has(ext)) {
      const hit = gzCache.get(file);
      const send = (buf) => {
        res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': buf.length });
        res.end(buf);
      };
      if (hit && hit.mtime === st.mtimeMs) return send(hit.buf);
      fs.readFile(file, (e, raw) => {
        if (e) { res.writeHead(500).end(); return; }
        zlib.gzip(raw, { level: 6 }, (e2, buf) => {
          if (e2) { res.writeHead(500).end(); return; }
          gzCache.set(file, { mtime: st.mtimeMs, buf });
          send(buf);
        });
      });
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ArkRachnid running at http://localhost:${PORT}/`);
  if (!fs.existsSync(path.join(DATA, 'meta.json'))) console.log('Warning: data/ missing. Run: node tools/build-index.mjs');
});
