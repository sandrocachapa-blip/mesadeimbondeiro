'use strict';
// Servidor local de desenvolvimento: base de dados em memória (PGlite), sem Neon.
const http = require('http'), fs = require('fs'), path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { handle } = require('./lib/core');
const pg = new PGlite();
const db = {
  q: async (t, p) => (await pg.query(t, p)).rows,
  tx: (fn) => pg.transaction((tx) => fn(async (t, p) => (await tx.query(t, p)).rows)),
};
const env = { AUTH_SECRET: 'dev-secret', ADMIN_PASSWORD: 'imbondeiro' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    const r = await handle(db, env, { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: raw ? JSON.parse(raw) : {}, token: (req.headers.authorization || '').replace(/^Bearer\s+/i, '') });
    res.statusCode = r.status;
    if (r.svg) { res.setHeader('Content-Type', 'image/svg+xml'); return res.end(r.svg); }
    res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(r.json));
  }
  let f = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!f.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('404'); }
  res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
  res.end(fs.readFileSync(f));
});
const port = process.env.PORT || 3000;
server.listen(port, () => console.log('Mesa de Imbondeiro em http://localhost:' + port + '  (admin / imbondeiro)'));
module.exports = { db, env };
