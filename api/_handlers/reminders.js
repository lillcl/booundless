/* GET /api/reminders — list maintenance reminders (upcoming/overdue).
   GET /api/reminders/:id — fetch a single reminder. */
import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, onlyMethod } from '../_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const db = await getDb();
    const url = req.url || '';
    const match = url.match(/^\/api\/reminders\/([^/?#]+)/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const r = await db.query(
        `SELECT r.id, r.vehicle_id, r.kind, r.title, r.due_in, r.icon, r.status,
                r.created_at, r.updated_at,
                v.model AS vehicle_model, v.plate AS vehicle_plate
         FROM reminders r
         LEFT JOIN vehicles v ON v.id = r.vehicle_id
         WHERE r.id = $1 AND v.created_by_user_id = $2 AND v.archived_at IS NULL`,
        [id, user.id],
      );
      if (r.rowCount === 0) return sendError(res, 404, 'not_found', `Reminder ${id} not found`);
      return sendJSON(res, 200, r.rows[0]);
    }

    const r = await db.query(
      `SELECT r.id, r.vehicle_id, r.kind, r.title, r.due_in, r.icon, r.status,
              r.created_at, r.updated_at,
              v.model AS vehicle_model, v.plate AS vehicle_plate
       FROM reminders r
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       WHERE r.status IN ('upcoming', 'overdue')
         AND v.created_by_user_id = $1
         AND v.archived_at IS NULL
       ORDER BY r.created_at DESC`,
      [user.id],
    );
    sendJSON(res, 200, { data: r.rows, count: r.rowCount });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
