/* GET /api/vehicles — list vehicles.
   GET /api/vehicles/:id — fetch a single vehicle. */
import { getDb } from './_lib/db.js';
import { sendError, sendJSON, onlyMethod } from './_lib/http.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;

  try {
    const db = getDb();
    const url = req.url || '';
    const match = url.match(/^\/api\/vehicles\/([^/?#]+)/);
    if (match) {
      const vehicle = db
        .prepare('SELECT id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at FROM vehicles WHERE id = ?')
        .get(match[1]);
      if (!vehicle) return sendError(res, 404, 'not_found', `Vehicle ${match[1]} not found`);
      return sendJSON(res, 200, vehicle);
    }

    const vehicles = db
      .prepare('SELECT id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at FROM vehicles ORDER BY created_at ASC')
      .all();

    sendJSON(res, 200, { data: vehicles, count: vehicles.length });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}