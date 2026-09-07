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