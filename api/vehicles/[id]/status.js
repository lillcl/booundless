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

    const db = getDb();
    const vehicle = db.prepare('SELECT id, model FROM vehicles WHERE id = ?').get(m[1]);
    if (!vehicle) return sendError(res, 404, 'not_found', `Vehicle ${m[1]} not found`);

    const items = db
      .prepare(`
        SELECT id, item, interval_km, interval_months, last_done_km,
               last_done_at, wear, display_order
        FROM vehicle_status
        WHERE vehicle_id = ?
        ORDER BY display_order ASC, id ASC
      `)
      .all(m[1]);

    const attention = items.filter((i) => i.wear >= 80).map((i) => i.item);

    sendJSON(res, 200, {
      vehicle: { id: vehicle.id, model: vehicle.model },
      items,
      attention_count: attention.length,
      attention,
    });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}