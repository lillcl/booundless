import { randomUUID } from 'node:crypto';
import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { readBody, sendError, sendJSON } from '../_lib/http.js';

export default async function handler(req, res) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;
    const db = await getDb();
    const url = req.url || '';
    if (url.startsWith('/api/profile/notifications')) {
      if (req.method === 'GET') {
        const r = await db.query(`INSERT INTO user_notification_preferences (user_id) VALUES ($1)
          ON CONFLICT (user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *`, [user.id]);
        return sendJSON(res, 200, r.rows[0]);
      }
      if (req.method === 'PATCH') {
        const b = await readBody(req);
        const r = await db.query(`INSERT INTO user_notification_preferences (user_id,maintenance_reminders,trip_updates,ai_suggestions)
          VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET maintenance_reminders=$2,trip_updates=$3,ai_suggestions=$4,updated_at=NOW() RETURNING *`,
        [user.id,b.maintenance_reminders!==false,b.trip_updates!==false,b.ai_suggestions!==false]);
        return sendJSON(res, 200, r.rows[0]);
      }
    }
    if (url.startsWith('/api/profile/teams') && req.method === 'GET') {
      const r = await db.query(`SELECT t.*, tm.role FROM teams t JOIN team_members tm ON tm.team_id=t.id WHERE tm.user_id=$1 ORDER BY t.created_at`, [user.id]);
      return sendJSON(res, 200, { data: r.rows });
    }
    if (url.startsWith('/api/profile/support') && req.method === 'POST') {
      const b = await readBody(req);
      if (!b?.subject || !b?.message) return sendError(res, 422, 'unprocessable', 'subject and message are required');
      const r = await db.query('INSERT INTO support_tickets (id,user_id,subject,message) VALUES ($1,$2,$3,$4) RETURNING *', [randomUUID(),user.id,b.subject,b.message]);
      return sendJSON(res, 201, r.rows[0]);
    }
    return sendError(res, 404, 'not_found', 'Profile route not found');
  } catch (e) { return sendError(res, 500, 'internal_error', e.message); }
}
