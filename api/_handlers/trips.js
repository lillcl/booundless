import { randomUUID } from 'node:crypto';
import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { readBody, sendError, sendJSON } from '../_lib/http.js';

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const db = await getDb();
    const match = (req.url || '').match(/^\/api\/trips\/([^/?#]+)/);
    if (req.method === 'GET' && !match) {
      const r = await db.query('SELECT * FROM trips WHERE created_by_user_id=$1 ORDER BY start_at NULLS LAST, created_at DESC', [user.id]);
      return sendJSON(res, 200, { data: r.rows, count: r.rowCount });
    }
    if (req.method === 'POST' && !match) {
      const b = await readBody(req);
      if (!b?.title || !b?.origin || !b?.destination) return sendError(res, 422, 'unprocessable', 'title, origin and destination are required');
      if (b.vehicle_id) {
        const vehicle = await db.query('SELECT id FROM vehicles WHERE id=$1 AND created_by_user_id=$2 AND archived_at IS NULL', [b.vehicle_id, user.id]);
        if (!vehicle.rowCount) return sendError(res, 404, 'not_found', 'Vehicle not found');
      }
      const id = randomUUID();
      const r = await db.query(`INSERT INTO trips (id,title,origin,destination,distance_km,duration_min,vehicle_id,notes,stops,status,start_at,created_by_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id,b.title,b.origin,b.destination,Number(b.distance_km)||0,Number(b.duration_min)||0,b.vehicle_id||null,b.notes||null,JSON.stringify(b.stops||[]),b.status||'planned',b.start_at||null,user.id]);
      return sendJSON(res, 201, r.rows[0]);
    }
    if (match && req.method === 'DELETE') {
      const r = await db.query('DELETE FROM trips WHERE id=$1 AND created_by_user_id=$2 RETURNING id', [decodeURIComponent(match[1]), user.id]);
      return r.rowCount ? sendJSON(res, 200, { ok: true }) : sendError(res, 404, 'not_found', 'Trip not found');
    }
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (e) { return sendError(res, 500, 'internal_error', e.message); }
}
