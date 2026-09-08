/* GET /api/vehicles — list vehicles.
   GET /api/vehicles/:id — fetch a single vehicle. */
import { getDb } from './_lib/db.js';
import { sendError, sendJSON, onlyMethod } from './_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;

  try {
    const db = await getDb();
    const url = req.url || '';
    const match = url.match(/^\/api\/vehicles\/([^/?#]+)/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const r = await db.query(
        `SELECT id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at
         FROM vehicles WHERE id = $1`,
        [id],
      );
      if (r.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);
      return sendJSON(res, 200, r.rows[0]);
    }

    const r = await db.query(
      `SELECT id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at
       FROM vehicles ORDER BY created_at ASC`,
    );
    sendJSON(res, 200, { data: r.rows, count: r.rowCount });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
