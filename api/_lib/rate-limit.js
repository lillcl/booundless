/* In-memory token-bucket rate limiter.

   Vercel functions are short-lived — each cold start gets a fresh process, so
   a `Map` here only protects one instance at a time. For multi-instance
   enforcement, swap `store` for Upstash Redis or Vercel KV. The shape of
   `consume()` is kept stable so the call sites do not change.

   Buckets are keyed by:
     - `user:<id>`  when req.user is set (preferred — survives NAT/CGNAT)
     - `ip:<addr>` otherwise
   Each bucket holds (refillRate tokens per refillMs, capacity tokens). When
   the bucket is empty, `consume()` returns `{ ok: false, retryAfterMs }`. */

import { sendError } from './http.js';

const DEFAULTS = {
  // 100 requests / minute per bucket — covers ordinary SPA bursts.
  capacity: 100,
  refillTokens: 100,
  refillMs: 60_000,
};

const buckets = new Map();
let limiterId = 0;

function getClientKey(req, user) {
  if (user && user.id) return { kind: 'user', value: `user:${user.id}` };
  const xff = req.headers['x-forwarded-for'];
  const ip = (typeof xff === 'string' ? xff.split(',')[0].trim() : null)
    || req.socket?.remoteAddress
    || 'unknown';
  return { kind: 'ip', value: `ip:${ip}` };
}

function take(key, opts) {
  const now = Date.now();
  const cap = opts.capacity ?? DEFAULTS.capacity;
  const refill = opts.refillTokens ?? DEFAULTS.refillTokens;
  const window = opts.refillMs ?? DEFAULTS.refillMs;
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: cap, updatedAt: now };
    buckets.set(key, b);
  }
  const elapsed = now - b.updatedAt;
  if (elapsed > 0) {
    b.tokens = Math.min(cap, b.tokens + (elapsed / window) * refill);
    b.updatedAt = now;
  }
  if (b.tokens < 1) {
    const retryAfterMs = Math.max(250, Math.ceil(((1 - b.tokens) / refill) * window));
    return { ok: false, retryAfterMs };
  }
  b.tokens -= 1;
  return { ok: true };
}

/* Cap the map size so a flood of unique keys cannot leak memory. Prune oldest
   10% of entries once we cross 10_000 keys. */
function pruneIfNeeded() {
  if (buckets.size <= 10_000) return;
  const dropCount = Math.ceil(buckets.size * 0.1);
  let dropped = 0;
  for (const key of buckets.keys()) {
    if (dropped >= dropCount) break;
    buckets.delete(key);
    dropped += 1;
  }
}

export function rateLimit(opts = {}) {
  const config = { ...DEFAULTS, ...opts };
  const namespace = ++limiterId;
  return async function rateLimitMiddleware(req, res, user) {
    const key = `${namespace}:${getClientKey(req, user).value}`;
    const result = take(key, config);
    if (!result.ok) {
      res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      sendError(res, 429, 'rate_limited', 'Too many requests, slow down.');
      return false;
    }
    pruneIfNeeded();
    return true;
  };
}

export function rateLimitWrap(handler, opts = {}) {
  const limiter = rateLimit(opts);
  return async (req, res) => {
    const user = req.user || null; // requireUser normally pre-fills locals; here best-effort.
    const ok = await limiter(req, res, user);
    if (!ok) return;
    return handler(req, res);
  };
}

/* Test-only: reset state between cases. */
export function _resetRateLimitState() {
  buckets.clear();
}
