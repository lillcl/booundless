/* GET /api/vehicles/:id/status — full maintenance status for one vehicle.
   Returns each maintenance item with a 0–100 wear value (100 = due now)
   plus the last service interval and last-service mileage. */

import { getDb } from '../../_lib/db.js';
import { sendError, sendJSON, onlyMethod } from '../../_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;

  try {
    const url = req.url || '';
    const m = url.match(/^\/api\/vehicles\/([^/?#]+)\/status/);
    if (!m) return sendError(res, 400, 'bad_request', 'Missing vehicle id');
    const id = decodeURIComponent(m[1]);

    const db = await getDb();
    const v = await db.query('SELECT id, model FROM vehicles WHERE id = $1', [id]);
    if (v.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);

    const r = await db.query(
      `SELECT id, item, interval_km, interval_months, last_done_km,
              last_done_at, wear, display_order
       FROM vehicle_status
       WHERE vehicle_id = $1
       ORDER BY display_order ASC, id ASC`,
      [id],
    );

    const attention = r.rows.filter((i) => i.wear >= 80).map((i) => i.item);

    sendJSON(res, 200, {
      vehicle: { id: v.rows[0].id, model: v.rows[0].model },
      items: r.rows,
      attention_count: attention.length,
      attention,
    });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
