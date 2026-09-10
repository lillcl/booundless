/* GET /api/health — liveness probe.
   Verifies the database connection. */
import { getDb } from '../_lib/db.js';
import { sendError, sendJSON, onlyMethod } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;

  try {
    const db = await getDb();
    const r = await db.query('SELECT NOW() AS now');
    sendJSON(res, 200, {
      ok: true,
      service: 'kc-carai',
      version: '0.1.0',
      time: new Date().toISOString(),
      db: { driver: 'pg', server_time: r.rows[0].now },
    });
  } catch (err) {
    sendError(res, 500, 'db_error', err.message);
  }
}
