/* GET /api/history/recent — most recent service history across all vehicles.
   Used by the Home page "最近" list. */
import { getDb } from '../_lib/db.js';
import { sendError, sendJSON, onlyMethod } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;

  try {
    const url = req.url || '';
    const m = url.match(/[?&]limit=(\d+)/);
    const limit = m ? Math.min(20, Math.max(1, parseInt(m[1], 10))) : 5;

    const db = await getDb();
    const r = await db.query(
      `SELECT h.id, h.vehicle_id, h.performed_at, h.kind, h.title, h.notes, h.cost, h.mileage_km,
              v.model AS vehicle_model, v.plate AS vehicle_plate
       FROM service_history h
       LEFT JOIN vehicles v ON v.id = h.vehicle_id
       ORDER BY h.performed_at DESC
       LIMIT $1`,
      [limit],
    );
    sendJSON(res, 200, { data: r.rows, count: r.rowCount });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
