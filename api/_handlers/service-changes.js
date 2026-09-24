/* Service-change (追加工程) routes (T4).
   POST /api/service-requests/:id/changes              — operator proposes
   POST /api/service-requests/:id/changes/:changeId/decision — owner approve/reject
   GET  /api/service-requests/:id/changes              — both parties read
*/

import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, readBody } from '../_lib/http.js';
import { validateQuoteLinesV2 } from '../_lib/service-orders.js';
import { audit } from '../_lib/auth.js';

async function loadAccess(client, requestId, userId) {
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1`, [requestId]
  )).rows[0];
  if (!r) return { error: 'Request not found' };
  const member = (await client.query(
    `SELECT m.role FROM dealer_members m
       WHERE m.dealer_id=$1 AND m.user_id=$2 AND m.role IN ('owner','manager','staff')`, [r.dealer_id, userId]
  )).rows[0];
  const isOwner = r.user_id === userId;
  return { request: r, isOwner, member: isOwner ? null : member };
}

export default async function handler(req, res) {
  const url = (req.url || '').replace(/\/+$/, '');
  const m = url.match(/^\/api\/service-requests\/([^/?#]+)\/changes(?:\/([^/?#]+)\/decision)?\/?$/);
  if (!m) return sendError(res, 404, 'not_found', 'Change route not found');
  const user = await requireUser(req, res); if (!user) return;
  const requestId = m[1];
  const changeId = m[2];
  const db = await getDb();
  const client = await db.connect();

  try {
    const { request: r, isOwner, member } = await loadAccess(client, requestId, user.id);
    if (!r) { await client.release(); return sendError(res, 404, 'not_found', 'Request not found'); }
    if (!isOwner && !member) { await client.release(); return sendError(res, 403, 'forbidden', 'Access denied'); }

    if (req.method === 'GET' && !changeId) {
      const changes = (await client.query(
        `SELECT * FROM service_changes WHERE request_id=$1 ORDER BY created_at DESC`, [requestId]
      )).rows;
      await client.release();
      return sendJSON(res, 200, { data: changes });
    }

    if (req.method === 'POST' && !changeId) {
      if (!member) { await client.release(); return sendError(res, 403, 'forbidden', 'Operator only'); }
      const body = await readBody(req);
      const reason = String(body?.reason || '').slice(0, 2000);
      if (!reason || reason.length < 1) { await client.release(); return sendError(res, 422, 'unprocessable', 'reason required'); }
      const lines = validateQuoteLinesV2(body?.quote_lines || body?.items || []);
      const total = lines.reduce((sum, l) => sum + l.amount_minor, 0);
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO service_changes
           (request_id, status, reason, items, quote_lines, total_minor, created_by, proposed_at)
         VALUES ($1, 'proposed', $2, $3::jsonb, $4::jsonb, $5, $6, NOW()) RETURNING *`,
        [requestId, reason, JSON.stringify(lines), JSON.stringify(lines), total, user.id]
      );
      await client.query(`INSERT INTO notifications(user_id,request_id,event_id,type,title,body)
        VALUES($1,$2,$3,'change_proposed','有追加項目待批准',$4)
        ON CONFLICT(user_id,event_id,type) DO NOTHING`,
        [r.user_id,requestId,`${requestId}:change:${ins.rows[0].id}`,reason]);
      await client.query('COMMIT');
      await audit({ actor: user, action: 'service_change.propose',
        targetType: 'service_change', targetId: ins.rows[0].id,
        payload: { request_id: requestId, total_minor: total } });
      await client.release();
      return sendJSON(res, 201, { data: ins.rows[0] });
    }

    if (req.method === 'POST' && changeId) {
      if (!isOwner) { await client.release(); return sendError(res, 403, 'forbidden', 'Owner only'); }
      const body = await readBody(req);
      const decision = String(body?.decision || '');
      const decisionNote = String(body?.decision_note || '').slice(0, 2000);
      if (!['approve', 'reject'].includes(decision)) {
        await client.release(); return sendError(res, 422, 'unprocessable', 'decision must be approve|reject');
      }
      await client.query('BEGIN');
      const ch = (await client.query(
        `SELECT * FROM service_changes WHERE id=$1 AND request_id=$2 FOR UPDATE`, [changeId, requestId]
      )).rows[0];
      if (!ch) { await client.query('ROLLBACK'); await client.release(); return sendError(res, 404, 'not_found', 'Change not found'); }
      if (ch.status !== 'proposed') {
        await client.query('ROLLBACK'); await client.release();
        return sendError(res, 409, 'conflict', `Change already ${ch.status}`);
      }
      if (decision === 'reject') {
        await client.query(
          `UPDATE service_changes SET status='rejected', decided_by=$1, decided_at=NOW(),
             decision_note=$2, version=version+1 WHERE id=$3`,
          [user.id, decisionNote, changeId]
        );
      } else {
        // Approve: insert service_order_lines per change line, marked with change_id.
        const items = Array.isArray(ch.quote_lines) ? ch.quote_lines : (ch.items || []);
        for (const [lineIndex,line] of items.entries()) {
          await client.query(
            `INSERT INTO service_order_lines
               (request_id, change_id, change_line_index, description, service_keys, work_type,
                quantity, parts_brand, parts_spec, part_number, parts_unit_minor, labour_minor,
                amount_minor, warranty_text, approved_by, approved_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
             ON CONFLICT DO NOTHING`,
            [requestId, changeId, Number.isInteger(line.line_index) ? line.line_index : lineIndex,
             line.description, line.service_keys || [], line.work_type,
             Number.isInteger(line.quantity) ? line.quantity : 1,
             line.parts_brand || null, line.parts_spec || null, line.part_number || null,
             line.parts_unit_minor || 0, line.labour_minor || 0, line.amount_minor,
             line.warranty_text || null, user.id]
          );
        }
        await client.query(
          `UPDATE service_changes SET status='approved', decided_by=$1, decided_at=NOW(),
             decision_note=$2, version=version+1 WHERE id=$3`,
          [user.id, decisionNote, changeId]
        );
      }
      if(ch.created_by!==user.id)await client.query(`INSERT INTO notifications(user_id,request_id,event_id,type,title,body)
        VALUES($1,$2,$3,'change_decided',$4,$5) ON CONFLICT(user_id,event_id,type) DO NOTHING`,
        [ch.created_by,requestId,`${requestId}:change-decision:${changeId}`,decision==='approve'?'追加項目已批准':'追加項目被拒絕',decisionNote||'車主已作出決定。']);
      await client.query('COMMIT');
      await audit({ actor: user, action: `service_change.${decision}`,
        targetType: 'service_change', targetId: changeId,
        payload: { request_id: requestId } });
      await client.release();
      return sendJSON(res, 200, { data: { id: changeId, status: decision === 'approve' ? 'approved' : 'rejected' } });
    }

    await client.release();
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client.release();
    return sendError(res, 422, 'unprocessable', e.message);
  }
}
