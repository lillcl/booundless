import { getDb } from '../_lib/db.js';
import { sendError, sendJSON } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Only GET allowed');
  try {
    const db = await getDb();
    const r = await db.query('SELECT * FROM videos ORDER BY created_at ASC');
    return sendJSON(res, 200, { data: r.rows, count: r.rowCount });
  } catch (e) { return sendError(res, 500, 'internal_error', e.message); }
}
