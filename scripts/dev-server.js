/* Local dev server — Express shim that mounts the same Vercel-style handlers
   from api/*.js. In production, Vercel/Netlify run these files directly as
   serverless functions; in dev, this shim keeps the code path identical. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();

import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import healthHandler from '../api/_handlers/health.js';
import vehiclesHandler from '../api/_handlers/vehicles.js';
import historyHandler from '../api/_handlers/history.js';
import remindersHandler from '../api/_handlers/reminders.js';
import authHandler from '../api/_handlers/auth.js';
import usersHandler from '../api/_handlers/users.js';
import assetsHandler from '../api/_handlers/assets.js';
import auditHandler from '../api/_handlers/audit.js';
import tripsHandler from '../api/_handlers/trips.js';
import videosHandler from '../api/_handlers/videos.js';
import profileHandler from '../api/_handlers/profile.js';
import aiHandler from '../api/ai.js';
import agentHandler from '../api/agent.js';
import dealersHandler from '../api/_handlers/dealers.js';
import marketingHandler, { publicPage } from '../api/_handlers/marketing.js';
import requestsHandler from '../api/_handlers/requests.js';
import shopHandler from '../api/_handlers/shop.js';
import trackingHandler from '../api/_handlers/tracking.js';
import meHandler from '../api/_handlers/me.js';
import bookingSlotsHandler from '../api/_handlers/booking-slots.js';
import inspectionsHandler from '../api/_handlers/inspections.js';
import serviceChangesHandler from '../api/_handlers/service-changes.js';
import serviceAttachmentsHandler, { internalEvidenceRoute } from '../api/_handlers/service-attachments.js';
import serviceOperationsHandler from '../api/_handlers/service-operations.js';
import cspReportHandler from '../api/_handlers/csp-report.js';
import adminCspReportsHandler from '../api/_handlers/admin-csp-reports.js';
import serviceOffersHandler from '../api/_handlers/service-offers.js';
import { closeDb } from '../api/_lib/db.js';
import { applySecurityHeaders } from '../api/_lib/security-headers.js';
import { originCheckWrap } from '../api/_lib/origin-check.js';
import { rateLimit } from '../api/_lib/rate-limit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const port = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');

/* Vehicle photos are sent as compressed data URLs for the vision endpoint.
   Keep this aligned with api/ai.js's 8 MB body limit; 64 KB silently rejects
   ordinary phone photos before the handler can process them. */
app.use(express.json({ limit: '8mb' }));

/* Cross-cutting security: HSTS / CSP / X-Frame-Options / Referrer-Policy. */
app.use((_req, res, next) => { applySecurityHeaders(res); next(); });

/* Rate limiters, applied per-route so /api/auth and /api/me can stay tight. */
const testLimit = process.env.NODE_ENV === 'test' ? 1000 : null;
const apiLimiter = rateLimit({ capacity: testLimit || 120, refillTokens: testLimit || 120, refillMs: 60_000 });
const authLimiter = rateLimit({ capacity: testLimit || 15, refillTokens: testLimit || 15, refillMs: 60_000 });
const mutatingLimiter = rateLimit({ capacity: testLimit || 60, refillTokens: testLimit || 60, refillMs: 60_000 });
function withLimit(limiter, handler) {
  return async (req, res) => {
    if (!(await limiter(req, res, null))) return;
    return handler(req, res);
  };
}
function isMutating(req) { return ['POST','PUT','PATCH','DELETE'].includes(req.method); }

/* Express → Vercel req shim: provide a parsed `query` and `url` path. */
function adapt(handler) {
  return (req, res, next) => {
    req.url = req.originalUrl || req.url;
    handler(req, res).catch(next);
  };
}

/* Dev-only: strict limiter + origin check for auth + me routes.
   In production api/index.js wraps every handler, but the dev shim mounts
   handlers directly — apply the same guards here so behaviour matches. */
function protect(limiter, handler) {
  const wrapped = originCheckWrap(adapt(handler));
  return (req, res, next) => {
    limiter(req, res, null).then((allowed) => {
      if (res.writableEnded || !allowed) return;
      wrapped(req, res).catch(next);
    }).catch(next);
  };
}

app.get('/api/health', adapt(healthHandler));
app.get('/api/vehicles', adapt(vehiclesHandler));
app.get('/api/vehicles/:id', adapt(vehiclesHandler));
app.patch('/api/vehicles/:id', adapt(vehiclesHandler));
app.get('/api/vehicles/:id/status', adapt(vehiclesHandler));
app.get('/api/vehicles/:id/history', adapt(vehiclesHandler));
app.post('/api/vehicles/:id/history', adapt(vehiclesHandler));
app.patch('/api/vehicles/:id/history/:recordId', adapt(vehiclesHandler));
app.get('/api/vehicles/:id/dealer-access', adapt(vehiclesHandler));
app.post('/api/vehicles/:id/dealer-access', adapt(vehiclesHandler));
app.delete('/api/vehicles/:id/dealer-access/:grantId', adapt(vehiclesHandler));
app.post('/api/vehicles', adapt(vehiclesHandler));
app.post('/api/vehicles/:id/scope/generate', adapt(vehiclesHandler));
app.post('/api/vehicles/:id/onboarding', adapt(vehiclesHandler));
app.get('/api/history', adapt(historyHandler));
app.get('/api/history/recent', adapt(historyHandler));
app.get('/api/reminders', adapt(remindersHandler));
app.get('/api/reminders/:id', adapt(remindersHandler));
app.get('/api/auth/me', protect(authLimiter, authHandler));
app.post('/api/auth/login', protect(authLimiter, authHandler));
app.post('/api/auth/register', protect(authLimiter, authHandler));
app.post('/api/auth/logout', protect(authLimiter, authHandler));
app.get('/api/me', protect(authLimiter, meHandler));
app.get('/api/me/export', protect(authLimiter, meHandler));
app.delete('/api/me', protect(authLimiter, meHandler));
app.get('/api/users', adapt(usersHandler));
app.post('/api/users', adapt(usersHandler));
app.patch('/api/users/:id', adapt(usersHandler));
app.delete('/api/users/:id', adapt(usersHandler));
app.get('/api/assets', adapt(assetsHandler));
app.get('/api/audit', adapt(auditHandler));
app.get('/api/trips', adapt(tripsHandler));
app.post('/api/trips', adapt(tripsHandler));
app.delete('/api/trips/:id', adapt(tripsHandler));
app.get('/api/videos', adapt(videosHandler));
app.get('/api/profile/notifications', adapt(profileHandler));
app.patch('/api/profile/notifications', adapt(profileHandler));
app.get('/api/profile/teams', adapt(profileHandler));
app.post('/api/profile/support', adapt(profileHandler));
app.post('/api/ai', adapt(aiHandler));
app.post('/api/agent', adapt(agentHandler));
app.get('/api/admin/dealers', adapt(dealersHandler));
app.get('/api/service-item-types', adapt(dealersHandler));
app.get('/api/dealers', adapt(dealersHandler));
app.post('/api/admin/dealers', adapt(dealersHandler));
app.get('/api/admin/dealers/:id', adapt(dealersHandler));
app.patch('/api/admin/dealers/:id', adapt(dealersHandler));
app.get('/api/admin/dealers/:id/branches', adapt(dealersHandler));
app.post('/api/admin/dealers/:id/branches', adapt(dealersHandler));
app.post('/api/admin/dealers/:id/members', adapt(dealersHandler));
app.delete('/api/admin/dealers/:id/members/:userId', adapt(dealersHandler));
app.get('/api/dealer/me', adapt(dealersHandler));
app.get('/api/dealer/vehicles', adapt(dealersHandler));
app.get('/api/service-history', adapt(historyHandler));
app.get('/api/dealer/vehicles/:id', adapt(dealersHandler));
app.post('/api/dealer/vehicles/:id/history', adapt(dealersHandler));
app.patch('/api/dealer/vehicles/:id/history/:recordId', adapt(dealersHandler));
app.get('/api/dealer/branches', adapt(dealersHandler));
app.put('/api/dealer/branches/:id/services', adapt(dealersHandler));
app.get('/api/dealer/services', adapt(dealersHandler));
app.post('/api/dealer/services', adapt(dealersHandler));
app.get('/api/dealer/services/:id', adapt(dealersHandler));
app.patch('/api/dealer/services/:id', adapt(dealersHandler));
app.get('/api/dealer/fitments', adapt(dealersHandler));
app.post('/api/dealer/fitments', adapt(dealersHandler));
app.get('/api/dealer/fitments/:id', adapt(dealersHandler));
app.patch('/api/dealer/fitments/:id', adapt(dealersHandler));
app.get('/api/dealer/service-requests', adapt(dealersHandler));
app.patch('/api/dealer/service-requests', adapt(dealersHandler));
app.patch('/api/dealer/service-requests/:id', adapt(dealersHandler));
app.get('/api/vehicles/:id/dealer-matches', adapt(dealersHandler));
app.get('/api/vehicles/:id/needs',adapt(dealersHandler));
app.post('/api/vehicles/:id/needs',adapt(dealersHandler));
app.post('/api/vehicles/:id/service-requests', adapt(dealersHandler));

/* Service MVP v2 routes (T3–T6) */
app.all('/api/internal/evidence/:objectKey', adapt(internalEvidenceRoute));
app.all('/api/service-requests/:id/inspection', adapt(inspectionsHandler));
app.all('/api/service-requests/:id/inspection/publish', adapt(inspectionsHandler));
app.all('/api/service-requests/:id/follow-up', adapt(inspectionsHandler));
app.all('/api/service-requests/:id/changes', adapt(serviceChangesHandler));
app.all('/api/service-requests/:id/changes/:changeId/decision', adapt(serviceChangesHandler));
app.all('/api/service-requests/:id/attachments/upload', adapt(serviceAttachmentsHandler));
app.all('/api/service-requests/:id/attachments/:id/finalize', adapt(serviceAttachmentsHandler));
app.all('/api/service-requests/:id/attachments/:id', adapt(serviceAttachmentsHandler));
app.all('/api/service-requests/:id/cases', adapt(serviceOperationsHandler));
app.all('/api/dealer/booking-slots', adapt(bookingSlotsHandler));
app.all('/api/dealer/booking-slots/:id', adapt(bookingSlotsHandler));
app.all('/api/dealer/cases/:id', adapt(serviceOperationsHandler));
app.all('/api/admin/cases', adapt(serviceOperationsHandler));
app.all('/api/admin/cases/:id', adapt(serviceOperationsHandler));
app.all('/api/dealer/service-orders/:id/payment', adapt(serviceOperationsHandler));
app.all('/api/admin/service-orders', adapt(serviceOperationsHandler));
app.all('/api/admin/service-orders/:id/refund', adapt(serviceOperationsHandler));
app.all('/api/admin/commissions', adapt(serviceOperationsHandler));
app.all('/api/admin/commissions/settle', adapt(serviceOperationsHandler));
app.all('/api/notifications', adapt(serviceOperationsHandler));
app.all('/api/notifications/:id/read', adapt(serviceOperationsHandler));
app.all('/api/csp-report', adapt(cspReportHandler));
app.all('/api/admin/csp-reports', adapt(adminCspReportsHandler));
app.all('/api/admin/csp-reports/summary', adapt(adminCspReportsHandler));
app.all('/api/service-offers', adapt(serviceOffersHandler));
app.all('/api/service-offers/:id', adapt(serviceOffersHandler));
app.all('/api/dealer/offers', adapt(serviceOffersHandler));
app.all('/api/dealer/offers/:id', adapt(serviceOffersHandler));
app.all('/api/service-offers/:id/slots', adapt(bookingSlotsHandler));

/* Static assets — serve the repo at root. */
app.all('/api/admin/marketing/pages', adapt(marketingHandler));
app.all('/api/admin/marketing/tracking',adapt(trackingHandler));
app.all('/api/marketing/config',adapt(trackingHandler));
app.all('/api/marketing/conversions',adapt(trackingHandler));
app.all('/api/service-requests',adapt(requestsHandler));
app.all('/api/service-requests/:id',adapt(requestsHandler));
app.all('/api/shop/*',adapt(shopHandler));
app.all('/api/admin/shop/*',adapt(shopHandler));
app.get(['/', '/demo'], adapt(publicPage));
app.get('/campaigns/:slug',adapt(publicPage));
app.get('/sitemap.xml',adapt(publicPage));
app.use(express.static(root, {
  extensions: ['html'],
  index: 'index.html',
}));

/* 404 for unknown /api/* */
app.use('/api', (_req, res) => {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: { code: 'not_found', message: 'API endpoint not found' } }));
});

app.use((_req, res) => {
  res.status(404).sendFile(join(root, 'error.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[dev-server] unhandled error:', err);
  if (res.headersSent) return;
  if (String(req.path || '').startsWith('/api/')) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code: 'internal_error', message: err.message } }));
    return;
  }
  res.status(500).sendFile(join(root, 'error.html'));
});

const server = createServer(app);

server.listen(port, () => {
  console.log(`[dev-server] 康程 CarAI listening on http://127.0.0.1:${port}`);
  console.log(`[dev-server]   Home   -> http://127.0.0.1:${port}/`);
  console.log(`[dev-server]   Health -> http://127.0.0.1:${port}/api/health`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[dev-server] ${sig} received, closing…`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  });
}
