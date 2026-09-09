/* Shared helpers for Vercel-style handlers.
   All handlers export `default async function handler(req, res)` so the same
   module is usable in Vercel functions and the local dev Express shim. */

export function sendJSON(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function sendError(res, status, code, message) {
  sendJSON(res, status, { error: { code, message } });
}

export function onlyMethod(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    sendError(res, 405, 'method_not_allowed', `Only ${allowed.join(', ')} allowed`);
    return false;
  }
  return true;
}

export function getQueryInt(req, name, { min = 1, max = 1000, fallback = null } = {}) {
  const raw = req.query?.[name];
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < min || n > max) return fallback;
  return n;
}

export async function readBody(req, { limit = '64kb' } = {}) {
  /* In serverless (Vercel) `req` is the raw Node IncomingMessage and the
     handler must consume the body via 'data'/'end' events. In the local
     dev shim, Express's express.json() middleware has already parsed the
     body into req.body — so use it when present. */
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return {}; }
    }
    return req.body;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return {};
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const max = parseSize(limit);
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(new Error('payload_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function parseSize(s) {
  const m = String(s).match(/^(\d+)(kb|mb)?$/i);
  if (!m) return 64 * 1024;
  const n = parseInt(m[1], 10);
  return m[2] && m[2].toLowerCase() === 'mb' ? n * 1024 * 1024 : n * 1024;
}