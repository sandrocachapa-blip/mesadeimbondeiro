'use strict';
const { Pool } = require('pg');
const { handle } = require('../lib/core');

let pool;
function db() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000 });
  const q = async (t, p) => (await pool.query(t, p)).rows;
  const tx = async (fn) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(async (t, p) => (await c.query(t, p)).rows);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { c.release(); }
  };
  return { q, tx };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.searchParams.get('__p') ? '/api/' + url.searchParams.get('__p') : url.pathname;
  const query = Object.fromEntries(url.searchParams);
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const r = await handle(db(), process.env, { method: req.method, path, query, body, token });
  res.statusCode = r.status;
  res.setHeader('Cache-Control', 'no-store');
  if (r.bin) { res.setHeader('Content-Type', r.mime); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); return res.end(r.bin); }
  if (r.svg) { res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.end(r.svg); }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(r.json));
};
