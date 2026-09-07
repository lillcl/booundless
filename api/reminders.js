/* GET /api/reminders — list maintenance reminders (newest first).
   GET /api/reminders/:id — fetch a single reminder. */
import { getDb } from './_lib/db.js';
import { sendError, sendJSON, onlyMethod } from './_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;

  try {
    const db = getDb();
    const url = req.url || '';
    const match = url.match(/^\/api\/reminders\/([^/?#]+)/);
    if (match) {
      const reminder = db
        .prepare(`
          SELECT r.id, r.vehicle_id, r.kind, r.title, r.due_in, r.icon, r.status,
                 r.created_at, r.updated_at, v.model AS vehicle_model, v.plate AS vehicle_plate
          FROM reminders r
          LEFT JOIN vehicles v ON v.id = r.vehicle_id
          WHERE r.id = ?
        `)
        .get(match[1]);
      if (!reminder) return sendError(res, 404, 'not_found', `Reminder ${match[1]} not found`);
      return sendJSON(res, 200, reminder);
    }

    const reminders = db
      .prepare(`
        SELECT r.id, r.vehicle_id, r.kind, r.title, r.due_in, r.icon, r.status,
               r.created_at, r.updated_at, v.model AS vehicle_model, v.plate AS vehicle_plate
        FROM reminders r
        LEFT JOIN vehicles v ON v.id = r.vehicle_id
        WHERE r.status IN ('upcoming', 'overdue')
        ORDER BY r.created_at DESC
      `)
      .all();

    sendJSON(res, 200, { data: reminders, count: reminders.length });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}