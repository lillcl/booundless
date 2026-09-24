/* Service-operations routes (T6) — pilot-mode commercial side.
   POST /api/dealer/service-orders/:id/payment     — record offline payment (owner/manager)
   POST /api/admin/service-orders/:id/refund      — admin refund (records reversal)
   POST /api/service-requests/:id/cases            — owner opens dispute
   GET  /api/dealer/cases/:id                       — dealer view of a case
   PATCH /api/dealer/cases/:id                      — dealer reply (cannot erase owner text)
   GET  /api/notifications                          — current user's notifications
   POST /api/notifications/:id/read                 — mark read
   GET  /api/admin/commissions                      — admin CSV export
   GET  /api/admin/service-orders                   — admin overview

   All currency in minor units (BIGINT). Idempotency via Idempotency-Key
   header required for all mutating routes. */

import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, readBody } from '../_lib/http.js';
import { audit } from '../_lib/auth.js';

async function idemOr409(client, { actorId, requestId, key, payloadHash }) {
  if (!key || typeof key !== 'string') throw new Error('Idempotency-Key header required');
  const existing = (await client.query(
    `SELECT * FROM request_actions WHERE actor_id=$1 AND request_id=$2 AND idempotency_key=$3`, [actorId, requestId, key]
  )).rows[0];
  if (existing) {
    if (existing.payload_hash !== payloadHash) throw Object.assign(new Error('Idempotency-Key reused with different payload'), { httpStatus: 409 });
    return existing;
  }
  return null;
}

function payloadHash(body) {
  // Stable JSON serialisation + sha256. Avoids requiring node:crypto via the sha256 helper.
  const str = JSON.stringify(body, Object.keys(body || {}).sort());
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of Buffer.from(str, 'utf8')) {
    h ^= BigInt(ch);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '');
  const user = await requireUser(req, res); if (!user) return;
  const db = await getDb();
  const client = await db.connect();
  try {
    /* ── Notifications ─────────────────────────────────────── */
    if (url === '/api/notifications') {
      if (req.method !== 'GET') { await client.release(); return sendError(res, 405, 'method_not_allowed', 'GET only'); }
      const rows = (await client.query(
        `SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [user.id]
      )).rows;
      await client.release();
      return sendJSON(res, 200, { data: rows });
    }
    const notifMatch = url.match(/^\/api\/notifications\/([^/?#]+)\/read\/?$/);
    if (notifMatch) {
      if (req.method !== 'POST') { await client.release(); return sendError(res, 405, 'method_not_allowed', 'POST only'); }
      const r = await client.query(
        `UPDATE notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *`,
        [notifMatch[1], user.id]
      );
      await client.release();
      if (!r.rowCount) return sendError(res, 404, 'not_found', 'Notification not found');
      return sendJSON(res, 200, { data: r.rows[0] });
    }

    /* ── Cases ─────────────────────────────────────────────── */
    const caseCreate = url.match(/^\/api\/service-requests\/([^/?#]+)\/cases\/?$/);
    if (caseCreate) {
      if (req.method !== 'POST') { await client.release(); return sendError(res, 405, 'method_not_allowed', 'POST only'); }
      const requestId = caseCreate[1];
      const body = await readBody(req);
      const kind = String(body?.kind || '');
      const description = String(body?.description || '').slice(0, 3000);
      if (!['workmanship', 'warranty', 'billing', 'other'].includes(kind) || description.length < 1) {
        await client.release(); return sendError(res, 422, 'unprocessable', 'kind and description required');
      }
      const r = (await client.query(`SELECT * FROM dealer_service_requests WHERE id=$1`, [requestId])).rows[0];
      if (!r || r.user_id !== user.id) { await client.release(); return sendError(res, 403, 'forbidden', 'Owner only'); }
      const ins = await client.query(
        `INSERT INTO service_cases (request_id, opened_by, kind, description, assigned_dealer_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [requestId, user.id, kind, description, r.dealer_id]
      );
      await audit({ actor: user, action: 'service_case.open',
        targetType: 'service_case', targetId: ins.rows[0].id });
      await client.release();
      return sendJSON(res, 201, { data: ins.rows[0] });
    }
    const dealerCaseMatch = url.match(/^\/api\/dealer\/cases\/([^/?#]+)\/?$/);
    if (dealerCaseMatch) {
      const caseId = dealerCaseMatch[1];
      const c = (await client.query(
        `SELECT sc.*, r.dealer_id FROM service_cases sc JOIN dealer_service_requests r ON r.id=sc.request_id WHERE sc.id=$1`, [caseId]
      )).rows[0];
      if (!c) { await client.release(); return sendError(res, 404, 'not_found', 'Case not found'); }
      const member = (await client.query(
        `SELECT 1 FROM dealer_members WHERE dealer_id=$1 AND user_id=$2 AND role IN ('owner','manager','staff')`, [c.dealer_id, user.id]
      )).rows[0];
      if (!member) { await client.release(); return sendError(res, 403, 'forbidden', 'Dealer only'); }
      if (req.method === 'GET') { await client.release(); return sendJSON(res, 200, { data: c }); }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const updates = [];
        const args = [];
        let i = 1;
        if (body.status && ['in_review', 'resolved'].includes(body.status)) {
          updates.push(`status=$${i++}`); args.push(body.status);
          if (body.status === 'resolved') {
            updates.push(`resolved_by=$${i++}`); args.push(user.id);
            updates.push(`resolved_at=NOW()`);
          }
        }
        if (typeof body.resolution === 'string' && body.resolution.length > 0) {
          updates.push(`resolution=$${i++}`); args.push(body.resolution.slice(0, 3000));
        }
        if (!updates.length) { await client.release(); return sendError(res, 422, 'unprocessable', 'No updates'); }
        updates.push(`version=version+1`); updates.push(`updated_at=NOW()`);
        args.push(caseId);
        const r = await client.query(
          `UPDATE service_cases SET ${updates.join(',')} WHERE id=$${i} RETURNING *`, args
        );
        await client.release();
        return sendJSON(res, 200, { data: r.rows[0] });
      }
      await client.release();
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
    }

    const adminCases = url.match(/^\/api\/admin\/cases(?:\/([^/?#]+))?\/?$/);
    if (adminCases) {
      if (user.role !== 'admin') { await client.release(); return sendError(res, 403, 'forbidden', 'Admin only'); }
      const caseId = adminCases[1];
      if (req.method === 'GET') {
        const args = caseId ? [caseId] : [];
        const rows = (await client.query(
          `SELECT sc.*, r.order_number, r.status AS request_status, r.payment_state,
                  r.currency, r.final_total_minor, d.display_name AS dealer_name,
                  u.display_name AS owner_name, u.email AS owner_email
             FROM service_cases sc
             JOIN dealer_service_requests r ON r.id=sc.request_id
             LEFT JOIN dealers d ON d.id=r.dealer_id
             LEFT JOIN users u ON u.id=r.user_id
            ${caseId ? 'WHERE sc.id=$1' : ''}
            ORDER BY sc.created_at DESC LIMIT 200`, args
        )).rows;
        await client.release();
        if (caseId && !rows.length) return sendError(res, 404, 'not_found', 'Case not found');
        return sendJSON(res, 200, { data: caseId ? rows[0] : rows });
      }
      if (req.method === 'PATCH' && caseId) {
        const body = await readBody(req);
        const status = String(body?.status || '');
        const resolution = typeof body?.resolution === 'string' ? body.resolution.trim().slice(0, 3000) : '';
        if (!['open','in_review','resolved','closed'].includes(status)) {
          await client.release(); return sendError(res, 422, 'unprocessable', 'Valid status required');
        }
        if (['resolved','closed'].includes(status) && !resolution) {
          await client.release(); return sendError(res, 422, 'unprocessable', 'Resolution required');
        }
        const updated = await client.query(
          `UPDATE service_cases SET status=$1, resolution=CASE WHEN $2='' THEN resolution ELSE $2 END,
             resolved_by=CASE WHEN $1 IN ('resolved','closed') THEN $3 ELSE resolved_by END,
             resolved_at=CASE WHEN $1 IN ('resolved','closed') THEN NOW() ELSE resolved_at END,
             version=version+1, updated_at=NOW() WHERE id=$4 RETURNING *`,
          [status, resolution, user.id, caseId]
        );
        await client.release();
        if (!updated.rowCount) return sendError(res, 404, 'not_found', 'Case not found');
        await audit({ actor:user, action:'service_case.admin_update', targetType:'service_case', targetId:caseId,
          payload:{ status } });
        return sendJSON(res, 200, { data:updated.rows[0] });
      }
      await client.release();
      return sendError(res, 405, 'method_not_allowed', 'GET or PATCH required');
    }

    /* ── Payment (dealer records offline payment) ─────────── */
    const payMatch = url.match(/^\/api\/dealer\/service-orders\/([^/?#]+)\/payment\/?$/);
    if (payMatch) {
      if (req.method !== 'POST') { await client.release(); return sendError(res, 405, 'method_not_allowed', 'POST only'); }
      const requestId = payMatch[1];
      const key = req.headers['idempotency-key'];
      const body = await readBody(req);
      if (!Number.isInteger(body?.amount_minor) || body.amount_minor <= 0) {
        await client.release(); return sendError(res, 422, 'unprocessable', 'amount_minor > 0 required');
      }
      const hash = payloadHash(body);
      try {
        const existing = await idemOr409(client, { actorId: user.id, requestId, key, payloadHash: hash });
        if (existing) { await client.release(); return sendJSON(res, existing.status_code || 200, existing.response || {}); }
      } catch (e) {
        await client.release();
        if (e.httpStatus === 409) return sendError(res, 409, 'conflict', e.message);
        throw e;
      }
      await client.query('BEGIN');
      const r = (await client.query(
        `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
      )).rows[0];
      if (!r) { await client.query('ROLLBACK'); await client.release(); return sendError(res, 404, 'not_found', 'Request not found'); }
      if (r.status !== 'completed' || r.work_state != null || !r.completion_confirmed_at) {
        await client.query('ROLLBACK'); await client.release(); return sendError(res, 409, 'conflict', 'Payment can only be recorded after owner confirmation');
      }
      const priorPaid = Number((await client.query(
        `SELECT COALESCE(SUM(amount_minor),0)::bigint AS total FROM service_payment_events WHERE request_id=$1 AND type='payment'`,
        [requestId]
      )).rows[0].total);
      const due = Number(r.final_total_minor ?? r.approved_total_minor ?? 0);
      if (due <= 0 || priorPaid + body.amount_minor !== due) {
        await client.query('ROLLBACK'); await client.release(); return sendError(res, 409, 'conflict', `Payment must settle the exact outstanding amount (${Math.max(0,due-priorPaid)})`);
      }
      const member = (await client.query(
        `SELECT 1 FROM dealer_members WHERE dealer_id=$1 AND user_id=$2 AND role IN ('owner','manager')`, [r.dealer_id, user.id]
      )).rows[0];
      if (!member) { await client.query('ROLLBACK'); await client.release(); return sendError(res, 403, 'forbidden', 'Owner/manager only'); }
      await client.query(
        `INSERT INTO service_payment_events
           (request_id, type, amount_minor, currency, reference, actor_id, idempotency_key)
         VALUES ($1,'payment',$2,$3,$4,$5,$6)`,
        [requestId, body.amount_minor, body.currency || r.currency || 'MOP',
         String(body.reference || '').slice(0, 200), user.id, key]
      );
      await client.query(
        `UPDATE dealer_service_requests SET payment_state='paid', paid_at=NOW(),
           payment_reference=$1, payment_recorded_by=$2,
           payment_method=$3, version=version+1, updated_at=NOW()
           WHERE id=$4`,
        [String(body.reference || '').slice(0, 200), user.id, body.payment_method || null, requestId]
      );
      await client.query(
        `INSERT INTO request_actions (actor_id, request_id, idempotency_key, payload_hash, response, status_code)
         VALUES ($1,$2,$3,$4,$5,200) ON CONFLICT (actor_id, request_id, idempotency_key) DO NOTHING`,
        [user.id, requestId, key, hash, JSON.stringify({ data: { status: 'paid' } })]
      );
      await client.query('COMMIT');
      await client.release();
      return sendJSON(res, 200, { data: { status: 'paid' } });
    }

    /* ── Refund (admin) ───────────────────────────────────── */
    const refundMatch = url.match(/^\/api\/admin\/service-orders\/([^/?#]+)\/refund\/?$/);
    if (refundMatch) {
      if (user.role !== 'admin') { await client.release(); return sendError(res, 403, 'forbidden', 'Admin only'); }
      if (req.method !== 'POST') { await client.release(); return sendError(res, 405, 'method_not_allowed', 'POST only'); }
      const requestId = refundMatch[1];
      const key = req.headers['idempotency-key'];
      const body = await readBody(req);
      if (!Number.isInteger(body?.amount_minor) || body.amount_minor <= 0) {
        await client.release(); return sendError(res, 422, 'unprocessable', 'amount_minor > 0 required');
      }
      const hash = payloadHash(body);
      try {
        const existing = await idemOr409(client, { actorId:user.id, requestId, key, payloadHash:hash });
        if (existing) { await client.release(); return sendJSON(res, existing.status_code || 200, existing.response || {}); }
      } catch (e) {
        await client.release();
        if (e.httpStatus === 409) return sendError(res, 409, 'conflict', e.message);
        throw e;
      }
      await client.query('BEGIN');
      const r = (await client.query(
        `SELECT * FROM dealer_service_requests WHERE id=$1 FOR UPDATE`, [requestId]
      )).rows[0];
      if (!r) { await client.query('ROLLBACK'); await client.release(); return sendError(res, 404, 'not_found', 'Request not found'); }
      const paid = Number((await client.query(
        `SELECT COALESCE(SUM(amount_minor),0)::bigint AS paid FROM service_payment_events WHERE request_id=$1 AND type='payment'`, [requestId]
      )).rows[0].paid);
      const refunded = Number((await client.query(
        `SELECT COALESCE(SUM(amount_minor),0)::bigint AS refunded FROM service_payment_events WHERE request_id=$1 AND type='refund'`, [requestId]
      )).rows[0].refunded);
      if (paid - refunded < body.amount_minor) {
        await client.query('ROLLBACK'); await client.release(); return sendError(res, 409, 'conflict', 'Refund exceeds paid amount');
      }
      await client.query(
        `INSERT INTO service_payment_events
           (request_id, type, amount_minor, currency, reference, actor_id, idempotency_key)
         VALUES ($1,'refund',$2,$3,$4,$5,$6)`,
        [requestId, body.amount_minor, body.currency || r.currency || 'MOP',
         String(body.reference || '').slice(0, 200), user.id, key]
      );
      const newRefundTotal = refunded + body.amount_minor;
      const newState = newRefundTotal >= paid ? 'refunded' : 'partially_refunded';
      await client.query(
        `UPDATE dealer_service_requests SET payment_state=$1, version=version+1, updated_at=NOW() WHERE id=$2`,
        [newState, requestId]
      );
      const accruals=(await client.query(`SELECT * FROM commission_entries
        WHERE request_id=$1 AND entry_type='accrual'`,[requestId])).rows;
      for(const accrual of accruals){
        const reversed=Number((await client.query(`SELECT COALESCE(SUM(commission_minor),0)::bigint AS n
          FROM commission_entries WHERE reverses_entry_id=$1 AND entry_type='reversal'`,[accrual.id])).rows[0].n);
        const target=Math.min(Number(accrual.commission_minor),Math.round(Number(accrual.commission_minor)*Number(newRefundTotal)/Number(paid||1)));
        const delta=target-reversed;
        if(delta>0)await client.query(`INSERT INTO commission_entries
          (request_id,completion_id,dealer_id,terms_id,origin,basis_minor,rate_bps,commission_minor,entry_type,reverses_entry_id,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'reversal',$9,'pending')`,
          [requestId,accrual.completion_id,accrual.dealer_id,accrual.terms_id,accrual.origin,body.amount_minor,accrual.rate_bps,delta,accrual.id]);
      }
      const response={ data:{ status:newState, refunded_total:newRefundTotal } };
      await client.query(`INSERT INTO request_actions(actor_id,request_id,idempotency_key,payload_hash,response,status_code)
        VALUES($1,$2,$3,$4,$5,200) ON CONFLICT(actor_id,request_id,idempotency_key) DO NOTHING`,
        [user.id,requestId,key,hash,JSON.stringify(response)]);
      await client.query('COMMIT');
      await client.release();
      return sendJSON(res, 200, response);
    }

    /* ── Admin commissions export (CSV) ──────────────────── */
    if (url === '/api/admin/commissions') {
      if (user.role !== 'admin') { await client.release(); return sendError(res, 403, 'forbidden', 'Admin only'); }
      const rows = (await client.query(
        `SELECT ce.id, ce.request_id, ce.dealer_id, ce.origin, ce.basis_minor, ce.rate_bps,
                ce.commission_minor, ce.entry_type, ce.status, ce.settled_at, ce.settlement_reference,
                ce.created_at
           FROM commission_entries ce ORDER BY ce.created_at DESC LIMIT 1000`
      )).rows;
      if (req.query?.format === 'json') {
        await client.release();
        return sendJSON(res, 200, { data: rows });
      }
      const header = 'id,request_id,dealer_id,origin,basis_minor,rate_bps,commission_minor,entry_type,status,settled_at,settlement_reference,created_at';
      const csv = [header].concat(rows.map((r) => [
        r.id, r.request_id, r.dealer_id, r.origin, r.basis_minor, r.rate_bps,
        r.commission_minor, r.entry_type, r.status, r.settled_at || '',
        r.settlement_reference || '', r.created_at.toISOString()
      ].join(','))).join('\n');
      await client.release();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="commissions.csv"');
      return res.end(csv);
    }

    if (url === '/api/admin/commissions/settle') {
      if (user.role !== 'admin') { await client.release(); return sendError(res, 403, 'forbidden', 'Admin only'); }
      if (req.method !== 'POST') { await client.release(); return sendError(res, 405, 'method_not_allowed', 'POST only'); }
      const body=await readBody(req);const ids=Array.isArray(body?.entry_ids)?[...new Set(body.entry_ids)]:[];
      const reference=String(body?.settlement_reference||'').trim().slice(0,200);
      if(!ids.length||!reference){await client.release();return sendError(res,422,'unprocessable','entry_ids and settlement_reference required');}
      const settled=await client.query(`UPDATE commission_entries SET status='settled',settled_at=NOW(),settlement_reference=$1
        WHERE id=ANY($2::uuid[]) AND status='pending' RETURNING id`,[reference,ids]);
      await client.release();return sendJSON(res,200,{data:{settled_ids:settled.rows.map((row)=>row.id)}});
    }

    /* ── Admin service-order overview ─────────────────────── */
    if (url === '/api/admin/service-orders') {
      if (user.role !== 'admin') { await client.release(); return sendError(res, 403, 'forbidden', 'Admin only'); }
      const rows = (await client.query(
        `SELECT id, order_number, status, workflow_version, dealer_id, vehicle_id, user_id,
                currency, approved_total_minor, final_total_minor, payment_state, work_state,
                created_at, completed_at
           FROM dealer_service_requests ORDER BY created_at DESC LIMIT 200`
      )).rows;
      await client.release();
      return sendJSON(res, 200, { data: rows });
    }

    await client.release();
    return sendError(res, 404, 'not_found', 'Operation route not found');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client.release();
    return sendError(res, 422, 'unprocessable', e.message);
  }
}
