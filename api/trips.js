import { randomUUID } from 'node:crypto';
import { getDb } from './_lib/db.js';
import { readBody, sendError, sendJSON } from './_lib/http.js';

export default async function handler(req, res) {
  try {
    const db = await getDb();
    const match = (req.url || '').match(/^\/api\/trips\/([^/?#]+)/);
    if (req.method === 'GET' && !match) {
      const r = await db.query('SELECT * FROM trips ORDER BY start_at NULLS LAST, created_at DESC');
      return sendJSON(res, 200, { data: r.rows, count: r.rowCount });
    }
    if (req.method === 'POST' && !match) {
      const b = await readBody(req);
      if (!b?.title || !b?.origin || !b?.destination) return sendError(res, 422, 'unprocessable', 'title, origin and destination are required');
      const id = randomUUID();
      const r = await db.query(`INSERT INTO trips (id,title,origin,destination,distance_km,duration_min,vehicle_id,notes,stops,status,start_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [id,b.title,b.origin,b.destination,Number(b.distance_km)||0,Number(b.duration_min)||0,b.vehicle_id||null,b.notes||null,JSON.stringify(b.stops||[]),b.status||'planned',b.start_at||null]);
      return sendJSON(res, 201, r.rows[0]);
    }
    if (match && req.method === 'DELETE') {
      const r = await db.query('DELETE FROM trips WHERE id=$1 RETURNING id', [decodeURIComponent(match[1])]);
      return r.rowCount ? sendJSON(res, 200, { ok: true }) : sendError(res, 404, 'not_found', 'Trip not found');
    }
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (e) { return sendError(res, 500, 'internal_error', e.message); }
}
