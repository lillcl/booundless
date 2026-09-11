/* GET /api/audit — admin-only paginated audit log.
   Query: ?limit=50 (default 50, max 200), ?actor=<email>,
   ?action=<code>, ?target_type=<type>, ?before=<iso8601> */

import { requireAdmin } from '../_lib/auth.js';
import { sendError, sendJSON, onlyMethod, getQueryInt } from '../_lib/http.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  if (!onlyMethod(req, res, ['GET'])) return;
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    const limit = getQueryInt(req, 'limit', { min: 1, max: 200, fallback: 50 });
    const { actor, action, target_type, before } = req.query || {};

    const where = [];
    const values = [];
    let i = 1;
    if (actor) { where.push(`actor_email = $${i++}`); values.push(String(actor)); }
    if (action) {
      const actionFilter = String(action);
      where.push(`${actionFilter.endsWith('%') ? 'action LIKE' : 'action ='} $${i++}`);
      values.push(actionFilter);
    }
    if (target_type) { where.push(`target_type = $${i++}`); values.push(String(target_type)); }
    if (before) { where.push(`created_at < $${i++}`); values.push(String(before)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    values.push(limit);

    const db = await getDb();
    const r = await db.query(
      `SELECT id, actor_user_id, actor_email, action, target_type, target_id, payload,
              ip, user_agent, created_at
       FROM audit_log
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${i}`,
      values,
    );

    sendJSON(res, 200, {
      data: r.rows,
      count: r.rowCount,
      filters: { actor: actor || null, action: action || null, target_type: target_type || null, before: before || null, limit },
    });
  } catch (err) {
    sendError(res, 500, 'internal_error', err.message);
  }
}
