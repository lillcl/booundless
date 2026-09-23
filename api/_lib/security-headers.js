/* HTTP security headers.
   Vercel strips `x-powered-by` and sets HSTS at the edge, but every response
   served from /api/index.js still needs CSP / X-Frame-Options / Referrer-Policy
   because the SPA + dynamic pages render HTML from that function.

   The defaults here are conservative for a JSON-first API + same-origin SPA.
   Override KC_CSP_ALLOWED_SOURCES (comma-separated) when adding new CDNs.
   Override KC_HSTS_MAX_AGE (seconds, default 1 year) at the edge instead. */

const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://*.supabase.co",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://api.minimax.cn https://api.minimax.io",
  "media-src 'self' https: blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
];

function buildCsp(extra) {
  const sources = String(extra || process.env.KC_CSP_ALLOWED_SOURCES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (sources.length === 0) return DEFAULT_CSP.join('; ');
  const override = DEFAULT_CSP.map(directive => {
    if (directive.startsWith('connect-src')) {
      return `connect-src 'self' ${sources.join(' ')}`;
    }
    return directive;
  });
  return override.join('; ');
}

export function applySecurityHeaders(res, { isHtml = true } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=()');
  if (isHtml) {
    res.setHeader('Content-Security-Policy', buildCsp());
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }
  // HSTS is set by Vercel edge in production; duplicate here for the dev shim.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    const maxAge = Number(process.env.KC_HSTS_MAX_AGE || 31536000);
    res.setHeader('Strict-Transport-Security', `max-age=${maxAge}; includeSubDomains`);
  }
}

export function securityHeadersMiddleware(_req, res, next) {
  applySecurityHeaders(res);
  next();
}

/* Vercel-style adapter — wrap our handler to set headers before it writes. */
export function withSecurityHeaders(handler) {
  return async (req, res) => {
    applySecurityHeaders(res);
    return handler(req, res);
  };
}