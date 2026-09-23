/* One deployment entry point for the application API. AI endpoints retain
   separate functions and timeouts. Existing public URLs remain unchanged. */
import assets from './_handlers/assets.js';
import adminCspReports from './_handlers/admin-csp-reports.js';
import audit from './_handlers/audit.js';
import auth from './_handlers/auth.js';
import bookingSlots from './_handlers/booking-slots.js';
import cspReport from './_handlers/csp-report.js';
import dealers from './_handlers/dealers.js';
import inspections from './_handlers/inspections.js';
import marketing, { publicPage } from './_handlers/marketing.js';
import me from './_handlers/me.js';
import requests from './_handlers/requests.js';
import serviceAttachments from './_handlers/service-attachments.js';
import serviceChanges from './_handlers/service-changes.js';
import serviceOffers from './_handlers/service-offers.js';
import serviceOperations from './_handlers/service-operations.js';
import shop from './_handlers/shop.js';
import tracking from './_handlers/tracking.js';
import health from './_handlers/health.js';
import history from './_handlers/history.js';
import profile from './_handlers/profile.js';
import reminders from './_handlers/reminders.js';
import trips from './_handlers/trips.js';
import users from './_handlers/users.js';
import vehicles from './_handlers/vehicles.js';
import videos from './_handlers/videos.js';
import { sendError } from './_lib/http.js';
import { applySecurityHeaders } from './_lib/security-headers.js';
import { originCheckWrap } from './_lib/origin-check.js';
import { rateLimit } from './_lib/rate-limit.js';

const handlers = { assets, audit, auth, cspReport, health, history, me, profile, reminders, trips, users, vehicles, videos };
const apiLimiter = rateLimit({ capacity: 120, refillTokens: 120, refillMs: 60_000 });
const authLimiter = rateLimit({ capacity: 15, refillTokens: 15, refillMs: 60_000 });
const mutatingLimiter = rateLimit({ capacity: 60, refillTokens: 60, refillMs: 60_000 });

const wrapped = new WeakMap();
function withGuards(target, opts = {}) {
  if (wrapped.has(target)) return wrapped.get(target);
  const limiter = opts.strict ? authLimiter : opts.mutating ? mutatingLimiter : apiLimiter;
  const guarded = originCheckWrap(async (req, res) => {
    const user = (typeof opts.resolveUser === 'function') ? await opts.resolveUser(req).catch(() => null) : null;
    if (!(await limiter(req, res, user))) return;
    return target(req, res);
  });
  wrapped.set(target, guarded);
  return guarded;
}

export function resolveHandler(path) {
  // exposed for tests; same as the internal resolve
  if (/^\/api\/(?:admin\/)?shop(?:\/|$)/.test(path)) return shop;
  if(path==='/api/admin/marketing/tracking'||/^\/api\/marketing\/(config|conversions)$/.test(path))return tracking;
  if (/^\/api\/service-requests\/[^/]+\/(?:inspection|inspection\/publish|follow-up|changes(?:\/[^/]+\/decision)?|attachments(?:\/[^/]+(?:\/(?:upload|finalize))?)?|cases)\/?$/.test(path)) {
    if (/\/inspection\//.test(path)) return inspections;
    if (/\/inspection$/.test(path)) return inspections;
    if (/\/follow-up$/.test(path)) return inspections;
    if (/\/changes/.test(path)) return serviceChanges;
    if (/\/attachments/.test(path)) return serviceAttachments;
    if (/\/cases/.test(path)) return serviceOperations;
  }
  if (/^\/api\/dealer\/booking-slots(?:\/[^/]+)?\/?$/.test(path)) return bookingSlots;
  if (/^\/api\/dealer\/cases\/[^/]+\/?$/.test(path)) return serviceOperations;
  if (/^\/api\/dealer\/service-orders\/[^/]+\/payment\/?$/.test(path)) return serviceOperations;
  if (/^\/api\/admin\/service-orders\/?$/.test(path) || /^\/api\/admin\/service-orders\/[^/]+\/refund\/?$/.test(path)) return serviceOperations;
  if (/^\/api\/admin\/commissions\/?$/.test(path)) return serviceOperations;
  if (/^\/api\/notifications(?:\/[^/]+\/read)?\/?$/.test(path)) return serviceOperations;
  if (path === '/api/csp-report') return cspReport;
  if (/^\/api\/admin\/csp-reports(\/summary)?\/?$/.test(path)) return adminCspReports;
  if (/^\/api\/service-offers(?:\/[^/]+)?\/?$/.test(path) && path !== '/api/service-offers') return serviceOffers;
  // /api/service-offers/:id/slots is owned by booking-slots above.
  if (/^\/api\/dealer\/offers(?:\/[^/]+)?\/?$/.test(path)) return serviceOffers;
  if (path === '/api/history/recent' || path.startsWith('/api/service-history')) return history;
  if (/^\/api\/service-offers\/[^/]+\/slots\/?$/.test(path)) return bookingSlots;
  if (/^\/api\/service-requests(?:\/|$)/.test(path)) return requests;
  if (/^\/api\/me(?:\/|$)/.test(path)) return me;
  if (path === '/api/admin/marketing/pages') return marketing;
  if (path === '/api/service-item-types' || path === '/api/dealers') return dealers;
  if (/^\/api\/(?:admin\/dealers|dealer)(?:\/|$)/.test(path)
      || /^\/api\/vehicles\/[^/]+\/(?:dealer-matches|service-requests|needs)$/.test(path)) return dealers;
  const match = path.match(/^\/api\/([^/]+)(?:\/|$)/);
  return match && Object.hasOwn(handlers, match[1]) ? handlers[match[1]] : null;
}

export default async function handler(req, res) {
  applySecurityHeaders(res);
  const url = new URL(req.url || '/', 'http://localhost');
  if (['/', '/demo','/sitemap.xml'].includes(url.pathname)||url.pathname.startsWith('/campaigns/')) return publicPage(req,res);
  const target = resolveHandler(url.pathname.replace(/\/+$/, ''));
  if (!target) return sendError(res, 404, 'not_found', 'API endpoint not found');
  // Preserve original path for nested handler routing and query filters.
  if (!req.query) req.query = Object.fromEntries(url.searchParams);
  // Auth and me are stricter; everything else is the generic budget.
  const isStrict = url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/api/me');
  const isMutating = ['POST','PUT','PATCH','DELETE'].includes(req.method || 'GET');
  return withGuards(target, { strict: isStrict, mutating: isMutating })(req, res);
}
