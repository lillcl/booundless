/* GET /api/vehicles — list vehicles.
   GET /api/vehicles/:id — fetch a single vehicle.
   GET /api/vehicles/:id/status — full maintenance status for one vehicle. */
import { getDb } from './_lib/db.js';
import { sendError, sendJSON, onlyMethod } from './_lib/http.js';

async function handleStatus(req, res, id) {
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
}

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;

  try {
    const url = req.url || '';
    const statusMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/status\/?$/);
    if (statusMatch) return await handleStatus(req, res, decodeURIComponent(statusMatch[1]));

    const idMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/?$/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const db = await getDb();
      const r = await db.query(
        `SELECT id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at
         FROM vehicles WHERE id = $1`,
        [id],
      );
      if (r.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);
      return sendJSON(res, 200, r.rows[0]);
    }

    if (url.startsWith('/api/vehicles')) {
      const db = await getDb();
      const r = await db.query(
        `SELECT id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at
         FROM vehicles ORDER BY created_at ASC`,
      );
      return sendJSON(res, 200, { data: r.rows, count: r.rowCount });
    }

    sendError(res, 404, 'not_found', `No route matches ${url}`);
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
