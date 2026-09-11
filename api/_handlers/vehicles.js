/* GET /api/vehicles — list vehicles.
   GET /api/vehicles/:id — fetch a single vehicle.
   GET /api/vehicles/:id/status — full maintenance status for one vehicle. */
import { getDb } from '../_lib/db.js';
import { randomUUID } from 'node:crypto';
import { requireUser } from '../_lib/auth.js';
import { readBody, sendError, sendJSON, onlyMethod } from '../_lib/http.js';

async function handleStatus(req, res, id, user) {
  const db = await getDb();
  const v = await db.query('SELECT id, model FROM vehicles WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL', [id, user.id]);
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

async function handleHistory(req, res, id, user) {
  const db = await getDb();
  const v = await db.query('SELECT id FROM vehicles WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL', [id, user.id]);
  if (v.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);

  const r = await db.query(
    `SELECT id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km
     FROM service_history
     WHERE vehicle_id = $1
     ORDER BY performed_at DESC`,
    [id],
  );
  sendJSON(res, 200, { data: r.rows, count: r.rowCount });
}

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET', 'POST'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const url = req.url || '';
    const historyMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/history\/?$/);
    if (historyMatch) return await handleHistory(req, res, decodeURIComponent(historyMatch[1]), user);

    const statusMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/status\/?$/);
    if (statusMatch) return await handleStatus(req, res, decodeURIComponent(statusMatch[1]), user);

    const idMatch = url.match(/^\/api\/vehicles\/([^/?#]+)\/?$/);
    if (idMatch) {
      const id = decodeURIComponent(idMatch[1]);
      const db = await getDb();
      const r = await db.query(
        `SELECT id, model, make, year, fuel_type, vin, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at
         FROM vehicles WHERE id = $1 AND created_by_user_id = $2 AND archived_at IS NULL`,
        [id, user.id],
      );
      if (r.rowCount === 0) return sendError(res, 404, 'not_found', `Vehicle ${id} not found`);
      return sendJSON(res, 200, r.rows[0]);
    }

    if (url.startsWith('/api/vehicles') && req.method === 'POST') {
      const db = await getDb();
      const body = await readBody(req);
      if (!body?.model) return sendError(res, 422, 'unprocessable', 'model is required');
      const id = randomUUID();
      const mileage = Math.max(0, Number(body.mileage_km) || 0);
      const r = await db.query(`INSERT INTO vehicles
        (id,model,make,year,fuel_type,plate,mileage_km,mileage_label,image,owner,team,created_by_user_id,updated_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING *`,
      [id,body.model,body.make||null,body.year||null,body.fuel_type||null,body.plate||null,mileage,`${mileage.toLocaleString()} km`,body.image||'/assets/vehicle-placeholder.svg',user.display_name||user.email,body.team||'personal',user.id]);
      return sendJSON(res, 201, r.rows[0]);
    }

    if (url.startsWith('/api/vehicles')) {
      const db = await getDb();
      const r = await db.query(
        `SELECT id, model, make, year, fuel_type, vin, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at
         FROM vehicles WHERE created_by_user_id = $1 AND archived_at IS NULL ORDER BY created_at ASC`,
        [user.id]);
      return sendJSON(res, 200, { data: r.rows, count: r.rowCount });
    }

    sendError(res, 404, 'not_found', `No route matches ${url}`);
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
