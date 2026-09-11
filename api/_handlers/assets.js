/* GET /api/assets — admin-only aggregated view of every vehicle, reminder,
   and service_history row across the system. Used by the admin assets page. */

import { requireAdmin } from '../_lib/auth.js';
import { sendError, sendJSON, onlyMethod } from '../_lib/http.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const db = await getDb();

    const vehicles = await db.query(
      `SELECT id, model, plate, mileage_km, mileage_label, owner, team, image, created_at
       FROM vehicles WHERE archived_at IS NULL ORDER BY created_at ASC`,
    );
    const reminders = await db.query(
      `SELECT r.id, r.vehicle_id, r.kind, r.title, r.due_in, r.status,
              v.model AS vehicle_model, v.plate AS vehicle_plate
       FROM reminders r
       JOIN vehicles v ON v.id = r.vehicle_id AND v.archived_at IS NULL
       ORDER BY r.created_at DESC`,
    );
    const history = await db.query(
      `SELECT h.id, h.vehicle_id, h.performed_at, h.kind, h.title, h.cost, h.mileage_km,
              v.model AS vehicle_model, v.plate AS vehicle_plate
       FROM service_history h
       JOIN vehicles v ON v.id = h.vehicle_id AND v.archived_at IS NULL
       ORDER BY h.performed_at DESC`,
    );
    const status = await db.query(
      `SELECT s.id, s.vehicle_id, s.item, s.wear, s.last_done_km, s.interval_km
       FROM vehicle_status s
       JOIN vehicles v ON v.id = s.vehicle_id AND v.archived_at IS NULL
       ORDER BY s.vehicle_id, s.display_order`,
    );

    sendJSON(res, 200, {
      vehicles: vehicles.rows,
      reminders: reminders.rows,
      history: history.rows,
      status: status.rows,
      counts: {
        vehicles: vehicles.rowCount,
        reminders: reminders.rowCount,
        history: history.rowCount,
        status: status.rowCount,
      },
    });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
