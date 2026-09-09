/* Local dev server — Express shim that mounts the same Vercel-style handlers
   from api/*.js. In production, Vercel/Netlify run these files directly as
   serverless functions; in dev, this shim keeps the code path identical. */

import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import healthHandler from '../api/health.js';
import vehiclesHandler from '../api/vehicles.js';
import historyHandler from '../api/history.js';
import remindersHandler from '../api/reminders.js';
import { closeDb } from '../api/_lib/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const port = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '64kb' }));

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
app.get('/api/history', adapt(historyHandler));
app.get('/api/history/recent', adapt(historyHandler));
app.get('/api/reminders', adapt(remindersHandler));
app.get('/api/reminders/:id', adapt(remindersHandler));

/* Static assets — serve the repo at root. */
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