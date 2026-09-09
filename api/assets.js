/* GET /api/assets — admin-only aggregated view of every vehicle, reminder,
   and service_history row across the system. Used by the admin assets page. */

import { requireAdmin } from './_lib/auth.js';
import { sendError, sendJSON, onlyMethod } from './_lib/http.js';
import { getDb } from './_lib/db.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const db = await getDb();

    const vehicles = await db.query(
      `SELECT id, model, plate, mileage_km, mileage_label, owner, team, image, created_at
       FROM vehicles ORDER BY created_at ASC`,
    );
    const reminders = await db.query(
      `SELECT r.id, r.vehicle_id, r.kind, r.title, r.due_in, r.status,
              v.model AS vehicle_model, v.plate AS vehicle_plate
       FROM reminders r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       ORDER BY r.created_at DESC`,
    );
    const history = await db.query(
      `SELECT h.id, h.vehicle_id, h.performed_at, h.kind, h.title, h.cost, h.mileage_km,
              v.model AS vehicle_model, v.plate AS vehicle_plate
       FROM service_history h
       LEFT JOIN vehicles v ON v.id = h.vehicle_id
       ORDER BY h.performed_at DESC`,
    );
    const status = await db.query(
      `SELECT id, vehicle_id, item, wear, last_done_km, interval_km
       FROM vehicle_status ORDER BY vehicle_id, display_order`,
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
