/* Origin / Referer allowlist for mutating methods.
   Same-site cookies (`SameSite=Strict`) already block cross-site form
   submissions, but the SPA can be embedded in unexpected contexts (Vercel
   preview URLs, local dev tunnels), so we belt-and-braces with an explicit
   Origin check on every non-GET/HEAD request.

   Allowlist precedence:
     1. KC_ALLOWED_ORIGINS env var (set in production per environment)
     2. process.env.ORIGIN (already used by marketing handler)
     3. host header (only when KC_TRUST_HOST=1 — opt-in for dev)
   Requests without Origin and without Referer are rejected unless the env
   var KC_ALLOW_NO_ORIGIN=1 is set (used by curl / server-to-server tools). */

import { sendError } from './http.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function loadAllowlist() {
  const list = [];
  const envList = String(process.env.KC_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  list.push(...envList);
  if (process.env.ORIGIN) list.push(process.env.ORIGIN);
  return list;
}

function matchOrigin(allow, origin) {
  /* Allowlist entries support a single `*` wildcard (any chars, no slashes
     expected) so preview URLs like https://*.vercel.app match every
     `*.vercel.app` deployment without enumerating hashes. */
  for (const pattern of allow) {
    if (pattern === origin) return true;
    if (!pattern.includes('*')) continue;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^./]*');
    if (new RegExp(`^${escaped}$`).test(origin)) return true;
  }
  return false;
}

function requestOrigin(req) {
  const origin = req.headers['origin'];
  if (typeof origin === 'string' && origin) return origin;
  const referer = req.headers['referer'];
  if (typeof referer === 'string' && referer) {
    try { return new URL(referer).origin; } catch { /* ignore */ }
  }
  if (process.env.KC_TRUST_HOST === '1') {
    const host = req.headers['x-forwarded-host'] || req.headers['host'];
    const proto = req.headers['x-forwarded-proto'] || 'https';
    if (host) return `${proto}://${host}`;
  }
  return null;
}

export function originCheck(_req, _res, next) {
  return (req, res) => {
    if (!MUTATING.has(req.method || 'GET')) return next ? next() : true;
    const allow = loadAllowlist();
    const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    if (allow.length === 0) {
      if (!isProd) return next ? next() : true;
      sendError(res, 403, 'forbidden', 'Origin not allowed.');
      return false;
    }
    const origin = requestOrigin(req);
    if (!origin) {
      if (process.env.KC_ALLOW_NO_ORIGIN === '1' && !isProd) return next ? next() : true;
      sendError(res, 403, 'forbidden', 'Missing Origin header.');
      return false;
    }
    if (!matchOrigin(allow, origin)) {
      sendError(res, 403, 'forbidden', 'Origin not allowed.');
      return false;
    }
    return next ? next() : true;
  };
}

export function originCheckWrap(handler) {
  return async (req, res) => {
    if (!MUTATING.has(req.method || 'GET')) return handler(req, res);
    const allow = loadAllowlist();
    const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    if (allow.length === 0) {
      // Dev convenience: when no allowlist is configured AND we are not in
      // production, allow the request through so curl / scripts still work.
      // In production we MUST have an allowlist — fail closed.
      if (!isProd) return handler(req, res);
      return sendError(res, 403, 'forbidden', 'Origin not allowed.');
    }
    const origin = requestOrigin(req);
    if (!origin) {
      if (process.env.KC_ALLOW_NO_ORIGIN === '1' && !isProd) return handler(req, res);
      return sendError(res, 403, 'forbidden', 'Missing Origin header.');
    }
    if (!matchOrigin(allow, origin)) {
      return sendError(res, 403, 'forbidden', 'Origin not allowed.');
    }
    return handler(req, res);
  };
}