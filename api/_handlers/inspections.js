/* Service-inspection routes (T3).
   GET    /api/service-requests/:id/inspection         — owner reads published; operator reads draft
   PUT    /api/service-requests/:id/inspection         — operator draft upsert (idempotent on (request_id, revision=1))
   POST   /api/service-requests/:id/inspection/publish — operator publishes; validates full template
   POST   /api/service-requests/:id/follow-up          — owner creates a child maintenance request from selected results
*/

import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, readBody } from '../_lib/http.js';
import { listTemplates, getTemplate, templateFor, normaliseResultsForPublish, validateResultRow } from '../../shared/inspection-templates.js';
import { audit } from '../_lib/auth.js';

async function loadRequestOr404(client, requestId) {
  const r = (await client.query(
    `SELECT * FROM dealer_service_requests WHERE id=$1`, [requestId]
  )).rows[0];
  if (!r) return null;
  return r;
}

async function loadMember(client, dealerId, userId) {
  return (await client.query(
    `SELECT m.role FROM dealer_members m
       WHERE m.dealer_id=$1 AND m.user_id=$2 AND m.role IN ('owner','manager','staff')`, [dealerId, userId]
  )).rows[0];
}

function canRead(r, member, userId) {
  return r.user_id === userId || !!member;
}

export default async function handler(req, res) {
  const url = (req.url || '').replace(/\/+$/, '');
  const m = url.match(/^\/api\/service-requests\/([^/?#]+)\/(inspection(?:\/publish)?|follow-up)\/?$/);
  if (!m) return sendError(res, 404, 'not_found', 'Inspection route not found');
  const user = await requireUser(req, res); if (!user) return;
  const requestId = m[1];
  const action = m[2];
  const db = await getDb();
  const client = await db.connect();

  try {
    const r = await loadRequestOr404(client, requestId);
    if (!r) { await client.release(); return sendError(res, 404, 'not_found', 'Request not found'); }
    const member = await loadMember(client, r.dealer_id, user.id);
    const isOwner = r.user_id === user.id;
    const isOperator = !!member;

    if (action === 'inspection' && req.method === 'GET') {
      if (!canRead(r, member, user.id)) {
        await client.release(); return sendError(res, 403, 'forbidden', 'Not allowed');
      }
      const reports = (await client.query(
        `SELECT * FROM inspection_reports WHERE request_id=$1 ORDER BY revision DESC`, [requestId]
      )).rows;
      let results = [];
      if (reports.length) {
        results = (await client.query(
          `SELECT * FROM inspection_results WHERE report_id=ANY($1::uuid[])`,
          [reports.map((x) => x.id)]
        )).rows;
      }
      await client.release();
      return sendJSON(res, 200, { data: { reports, results } });
    }

    if (action === 'inspection' && req.method === 'PUT') {
      if (!isOperator) {
        await client.release(); return sendError(res, 403, 'forbidden', 'Only dealer staff can edit inspection drafts');
      }
      const body = await readBody(req);
      // Draft upsert: revision stays 1 until publish.
      const existing = (await client.query(
        `SELECT * FROM inspection_reports WHERE request_id=$1 AND status='draft' LIMIT 1`, [requestId]
      )).rows[0];
      let report;
      await client.query('BEGIN');
      if (existing) {
        await client.query(
          `UPDATE inspection_reports SET mileage_km=$1, summary=$2, customer_question=$3,
               version=version+1, updated_at=NOW()
             WHERE id=$4`,
          [Number.isInteger(body.mileage_km) ? body.mileage_km : existing.mileage_km,
           typeof body.summary === 'string' ? body.summary.slice(0, 3000) : existing.summary,
           typeof body.customer_question === 'string' ? body.customer_question.slice(0, 2000) : existing.customer_question,
           existing.id]
        );
        report = (await client.query(`SELECT * FROM inspection_reports WHERE id=$1`, [existing.id])).rows[0];
      } else {
        const ins = await client.query(
          `INSERT INTO inspection_reports
             (request_id, template_key, template_version, status, mileage_km, summary,
              customer_question, inspected_by, started_at)
           VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,NOW()) RETURNING *`,
          [requestId, body.template_key || 'baseline-v1',
           body.template_version || 'v1',
           Number.isInteger(body.mileage_km) ? body.mileage_km : null,
           typeof body.summary === 'string' ? body.summary.slice(0, 3000) : null,
           typeof body.customer_question === 'string' ? body.customer_question.slice(0, 2000) : null,
           user.id]
        );
        report = ins.rows[0];
      }
      // Replace result rows for this draft only (delete-then-insert).
      if (Array.isArray(body.results)) {
        const tpl = getTemplate(report.template_key);
        if (!tpl) { await client.query('ROLLBACK'); await client.release(); return sendError(res, 422, 'unprocessable', 'Unknown template_key'); }
        await client.query(`DELETE FROM inspection_results WHERE report_id=$1`, [report.id]);
        for (const row of body.results) {
          try {
            const norm = validateResultRow(tpl, row);
            await client.query(
              `INSERT INTO inspection_results
                 (report_id, check_key, service_keys, result, measurement_value,
                  measurement_unit, measurement_method, notes, recommended_action,
                  next_due_km, next_due_date)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [report.id, norm.check_key, norm.service_keys, norm.result, norm.measurement_value,
               norm.measurement_unit, norm.measurement_method, norm.notes, norm.recommended_action,
               norm.next_due_km, norm.next_due_date]
            );
          } catch (e) {
            await client.query('ROLLBACK'); await client.release();
            return sendError(res, 422, 'unprocessable', e.message);
          }
        }
      }
      await client.query('COMMIT');
      await audit({ actor: user, action: 'inspection.draft_save',
        targetType: 'inspection_report', targetId: report.id,
        payload: { request_id: requestId } });
      await client.release();
      return sendJSON(res, 200, { data: report });
    }

    if (action === 'inspection/publish' && req.method === 'POST') {
      if (!isOperator) {
        await client.release(); return sendError(res, 403, 'forbidden', 'Only dealer staff can publish');
      }
      const body = await readBody(req);
      const report = (await client.query(
        `SELECT * FROM inspection_reports WHERE request_id=$1 ORDER BY revision DESC LIMIT 1`, [requestId]
      )).rows[0];
      if (!report) { await client.release(); return sendError(res, 404, 'not_found', 'No draft to publish'); }
      if (report.status === 'published') { await client.release(); return sendError(res, 409, 'conflict', 'Already published'); }
      if (Number(body.version) !== Number(report.version)) {
        await client.release(); return sendError(res, 409, 'conflict', 'Version changed; refresh');
      }
      const tpl = getTemplate(report.template_key);
      const rows = (await client.query(
        `SELECT * FROM inspection_results WHERE report_id=$1`, [report.id]
      )).rows;
      let normalised;
      try { normalised = normaliseResultsForPublish(tpl, rows); }
      catch (e) { await client.release(); return sendError(res, 422, 'unprocessable', e.message); }
      await client.query('BEGIN');
      await client.query(
        `UPDATE inspection_reports SET status='published', published_at=NOW(),
           finished_at=COALESCE(finished_at, NOW()), version=version+1, updated_at=NOW()
           WHERE id=$1`, [report.id]
      );
      // For each result with outcome=recommended/urgent, write a need row so
      // the owner sees it in follow-up. We do NOT touch vehicle_status last_done.
      for (const row of normalised) {
        if (!['recommended', 'urgent'].includes(row.result)) continue;
        for (const key of row.service_keys) {
          await client.query(
            `INSERT INTO vehicle_needs
               (id, vehicle_id, service_key, source, source_id, state, severity, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, 'inspection_result', $3, 'open',
                     $4, NOW())
             ON CONFLICT (vehicle_id, service_key) DO NOTHING`,
            [r.vehicle_id, key, report.id, row.result === 'urgent' ? 'urgent' : 'recommended']
          );
        }
      }
      await client.query('COMMIT');
      await audit({ actor: user, action: 'inspection.publish',
        targetType: 'inspection_report', targetId: report.id,
        payload: { request_id: requestId } });
      await client.release();
      return sendJSON(res, 200, { data: { id: report.id, status: 'published' } });
    }

    if (action === 'follow-up' && req.method === 'POST') {
      if (!isOwner) {
        await client.release(); return sendError(res, 403, 'forbidden', 'Only owner can create follow-up');
      }
      const body = await readBody(req);
      if (!body.report_id || !Array.isArray(body.selected_result_ids) || !body.offer_id) {
        await client.release(); return sendError(res, 422, 'unprocessable', 'report_id, offer_id, selected_result_ids required');
      }
      // The follow-up is a new request pointing at the inspection report;
      // it does NOT auto-approve any maintenance.
      await client.query('BEGIN');
      const offer = (await client.query(
        `SELECT * FROM service_offers WHERE id=$1`, [body.offer_id]
      )).rows[0];
      if (!offer) { await client.query('ROLLBACK'); await client.release(); return sendError(res, 404, 'not_found', 'Offer not found'); }
      const newReq = await client.query(
        `INSERT INTO dealer_service_requests
           (id, dealer_id, branch_id, vehicle_id, user_id, status, workflow_version,
            offer_id, service_kind, parent_request_id, contact_name, contact_phone, customer_note,
            currency, created_at, updated_at)
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'new', 2, $5, 'maintenance', $6,
                 $7, $8, $9, $10, NOW(), NOW()) RETURNING *`,
        [offer.dealer_id, offer.branch_id, r.vehicle_id, user.id, offer.id, requestId,
         (body.contact_name || r.contact_name || '').slice(0, 200),
         (body.contact_phone || r.contact_phone || '').slice(0, 50),
         (body.customer_note || '').slice(0, 2000),
         offer.currency]
      );
      await client.query('COMMIT');
      await audit({ actor: user, action: 'follow_up.create',
        targetType: 'service_request', targetId: newReq.rows[0].id,
        payload: { parent_request_id: requestId, selected_result_ids: body.selected_result_ids } });
      await client.release();
      return sendJSON(res, 201, { data: newReq.rows[0] });
    }

    await client.release();
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client.release();
    return sendError(res, 500, 'internal_error', e.message);
  }
}