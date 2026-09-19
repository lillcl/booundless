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
import { closeDb } from '../api/_lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const port = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');

/* Vehicle photos are sent as compressed data URLs for the vision endpoint.
   Keep this aligned with api/ai.js's 8 MB body limit; 64 KB silently rejects
   ordinary phone photos before the handler can process them. */
app.use(express.json({ limit: '8mb' }));

/* Express → Vercel req shim: provide a parsed `query` and `url` path. */
function adapt(handler) {
  return (req, res, next) => {
    req.url = req.originalUrl || req.url;
    handler(req, res).catch(next);
  };
}

app.get('/api/health', adapt(healthHandler));
app.get('/api/vehicles', adapt(vehiclesHandler));
app.get('/api/vehicles/:id', adapt(vehiclesHandler));
app.get('/api/vehicles/:id/status', adapt(vehiclesHandler));
app.get('/api/vehicles/:id/history', adapt(vehiclesHandler));
app.post('/api/vehicles', adapt(vehiclesHandler));
app.post('/api/vehicles/:id/scope/generate', adapt(vehiclesHandler));
app.get('/api/history', adapt(historyHandler));
app.get('/api/history/recent', adapt(historyHandler));
app.get('/api/reminders', adapt(remindersHandler));
app.get('/api/reminders/:id', adapt(remindersHandler));
app.get('/api/auth/me', adapt(authHandler));
app.post('/api/auth/login', adapt(authHandler));
app.post('/api/auth/register', adapt(authHandler));
app.post('/api/auth/logout', adapt(authHandler));
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
app.post('/api/admin/dealers', adapt(dealersHandler));
app.get('/api/admin/dealers/:id', adapt(dealersHandler));
app.patch('/api/admin/dealers/:id', adapt(dealersHandler));
app.get('/api/admin/dealers/:id/branches', adapt(dealersHandler));
app.post('/api/admin/dealers/:id/branches', adapt(dealersHandler));
app.post('/api/admin/dealers/:id/invites', adapt(dealersHandler));
app.get('/api/dealer/me', adapt(dealersHandler));
app.get('/api/dealer/branches', adapt(dealersHandler));
app.put('/api/dealer/branches/:id/services', adapt(dealersHandler));
app.post('/api/dealer/invites/accept', adapt(dealersHandler));
app.post('/api/dealer/invites/register', adapt(dealersHandler));
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
  res.status(404).sendFile(join(root, '404.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[dev-server] unhandled error:', err);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: { code: 'internal_error', message: err.message } }));
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
