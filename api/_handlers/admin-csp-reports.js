/* CSP reports admin dashboard (T8).
   GET /api/admin/csp-reports — last 200 reports ordered by received_at desc
   GET /api/admin/csp-reports/summary — counts per violated-directive over the last 7 days */

import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON } from '../_lib/http.js';

export default async function handler(req, res) {
  const url = (req.url || '').replace(/\/+$/, '');
  const user = await requireUser(req, res); if (!user) return;
  if (user.role !== 'admin') return sendError(res, 403, 'forbidden', 'Admin only');
  const db = await getDb();
  try {
    if (url === '/api/admin/csp-reports/summary') {
      const rows = (await db.query(
        `SELECT violated_directive, document_uri, COUNT(*)::int AS count, MAX(received_at) AS last_seen
           FROM csp_reports
          WHERE received_at > NOW() - INTERVAL '7 days'
          GROUP BY violated_directive, document_uri
          ORDER BY count DESC LIMIT 50`
      )).rows;
      return sendJSON(res, 200, { data: rows });
    }
    if (url === '/api/admin/csp-reports') {
      const rows = (await db.query(
        `SELECT id, received_at, document_uri, violated_directive, effective_directive,
                blocked_uri, source_file, line_number, column_number, sample
           FROM csp_reports ORDER BY received_at DESC LIMIT 200`
      )).rows;
      return sendJSON(res, 200, { data: rows });
    }
    return sendError(res, 404, 'not_found', 'CSP admin route not found');
  } catch (e) {
    return sendError(res, 500, 'internal_error', e.message);
  }
}