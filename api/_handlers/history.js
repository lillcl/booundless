/* GET /api/history/recent — most recent service history across all vehicles.
   Used by the Home page "最近" list.
   GET /api/service-history?vehicle_id=... — owner-scoped per-vehicle history
   (used by the "history unknown" passport CTA). */
import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, onlyMethod } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const url = req.url || '';
    if (url.startsWith('/api/service-history')) {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const vehicleId = params.get('vehicle_id');
      if (!vehicleId) return sendError(res, 422, 'unprocessable', 'vehicle_id required');
      const db = await getDb();
      const owner = await db.query(
        'SELECT 1 FROM vehicles WHERE id=$1 AND created_by_user_id=$2 AND archived_at IS NULL',
        [vehicleId, user.id]);
      if (!owner.rowCount) return sendError(res, 403, 'forbidden', 'Vehicle does not belong to you');
      const r = await db.query(
        `SELECT id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km
           FROM service_history
          WHERE vehicle_id=$1 AND voided_at IS NULL
          ORDER BY performed_at DESC LIMIT 50`, [vehicleId]);
      return sendJSON(res, 200, { data: r.rows, count: r.rowCount });
    }

    const m = url.match(/[?&]limit=(\d+)/);
    const limit = m ? Math.min(20, Math.max(1, parseInt(m[1], 10))) : 5;

    const db = await getDb();
    const r = await db.query(
      `SELECT h.id, h.vehicle_id, h.performed_at, h.kind, h.title, h.notes, h.cost, h.mileage_km,
              v.model AS vehicle_model, v.plate AS vehicle_plate
         FROM service_history h
         JOIN vehicles v ON v.id = h.vehicle_id
         WHERE v.created_by_user_id = $2 AND v.archived_at IS NULL AND h.voided_at IS NULL
         ORDER BY h.performed_at DESC
         LIMIT $1`,
      [limit, user.id],
    );
    sendJSON(res, 200, { data: r.rows, count: r.rowCount });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}