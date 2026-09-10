/* One deployment entry point for the application API. AI endpoints retain
   separate functions and timeouts. Existing public URLs remain unchanged. */
import assets from './_handlers/assets.js';
import audit from './_handlers/audit.js';
import auth from './_handlers/auth.js';
import dealers from './_handlers/dealers.js';
import health from './_handlers/health.js';
import history from './_handlers/history.js';
import profile from './_handlers/profile.js';
import reminders from './_handlers/reminders.js';
import trips from './_handlers/trips.js';
import users from './_handlers/users.js';
import vehicles from './_handlers/vehicles.js';
import videos from './_handlers/videos.js';
import { sendError } from './_lib/http.js';

const handlers = { assets, audit, auth, health, history, profile, reminders, trips, users, vehicles, videos };

export function resolveHandler(path) {
  if (/^\/api\/(?:admin\/dealers|dealer)(?:\/|$)/.test(path)
      || /^\/api\/vehicles\/[^/]+\/(?:dealer-matches|service-requests)$/.test(path)) return dealers;
  const match = path.match(/^\/api\/([^/]+)(?:\/|$)/);
  return match && Object.hasOwn(handlers, match[1]) ? handlers[match[1]] : null;
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const target = resolveHandler(url.pathname.replace(/\/+$/, ''));
  if (!target) return sendError(res, 404, 'not_found', 'API endpoint not found');
  // Preserve original path for nested handler routing and query filters.
  if (!req.query) req.query = Object.fromEntries(url.searchParams);
  return target(req, res);
}
