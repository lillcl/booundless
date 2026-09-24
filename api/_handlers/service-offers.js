/* Service-offer browse (T8 endpoint).
   GET /api/service-offers             — public list of active offers (login optional)
   GET /api/service-offers/:id         — single offer detail
   GET /api/dealer/offers              — dealer's own offers (admin or member)
   POST /api/dealer/offers             — admin or owner creates draft offer
   PATCH /api/dealer/offers/:id        — admin or owner updates draft; sets active=true to publish
   */

import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, readBody } from '../_lib/http.js';
import { audit } from '../_lib/auth.js';

async function fetchOfferRow(db, offerId) {
  const r = await db.query(
    `SELECT so.*, d.display_name AS dealer_name, db.name AS branch_name
       FROM service_offers so
       JOIN dealers d ON d.id = so.dealer_id
       LEFT JOIN dealer_branches db ON db.id = so.branch_id
      WHERE so.id=$1`, [offerId]
  );
  return r.rows[0] || null;
}

function pilotAllows(dealerId) {
  if (String(process.env.SERVICE_MVP_ENABLED || 'true').toLowerCase() === 'false') return false;
  const configured=String(process.env.SERVICE_MVP_DEALER_IDS || '').split(',').map((value)=>value.trim()).filter(Boolean);
  return !configured.length || configured.includes(dealerId);
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost').pathname.replace(/\/+$/, '');
  const db = await getDb();

  try {
    // Public / customer-facing list (returns active offers, anonymous OK).
    if (req.method === 'GET' && (url === '/api/service-offers' || url === '/api/service-offers/')) {
      const rows = (await db.query(
        `SELECT so.id, so.dealer_id, so.branch_id, so.kind, so.name, so.description,
                so.currency, so.price_minor, so.pricing_mode, so.duration_minutes,
                so.checklist_version, so.active, d.display_name AS dealer_name, db.name AS branch_name
           FROM service_offers so
           JOIN dealers d ON d.id = so.dealer_id
           LEFT JOIN dealer_branches db ON db.id = so.branch_id
          WHERE so.active=true AND d.status='active' AND d.pilot_enabled=true
          ORDER BY so.created_at DESC LIMIT 100`
      )).rows;
      return sendJSON(res, 200, { data: rows.filter((offer)=>pilotAllows(offer.dealer_id)) });
    }

    // From here on, all routes require auth (dealer-side workspace).
    const user = await requireUser(req, res); if (!user) return;

    // Single offer detail (dealer-side; customers hit /api/service-offers/:id/slots).
    let m = url.match(/^\/api\/service-offers\/([^/?#]+)\/?$/);
    if (req.method === 'GET' && m) {
      const offer = await fetchOfferRow(db, m[1]);
      if (!offer || !offer.active || !pilotAllows(offer.dealer_id)) return sendError(res, 404, 'not_found', 'Offer not found');
      return sendJSON(res, 200, { data: offer });
    }

    // Dealer workspace: list own offers
    if (req.method === 'GET' && url === '/api/dealer/offers') {
      const member = (await db.query(
        `SELECT dealer_id FROM dealer_members WHERE user_id=$1 AND role IN ('owner','manager','staff') LIMIT 1`, [user.id])).rows[0];
      if (!member) return sendJSON(res, 200, { data: [] });
      const rows = (await db.query(
        `SELECT * FROM service_offers WHERE dealer_id=$1 ORDER BY created_at DESC`, [member.dealer_id])).rows;
      return sendJSON(res, 200, { data: rows });
    }

    // Create draft offer
    if (req.method === 'POST' && url === '/api/dealer/offers') {
      const body = await readBody(req);
      const membership = (await db.query(
        `SELECT dealer_id FROM dealer_members WHERE user_id=$1 AND role IN ('owner','manager') LIMIT 1`, [user.id])).rows[0];
      if (user.role !== 'admin' && !membership) return sendError(res, 403, 'forbidden', 'Owner/manager required');
      const dealerId = user.role === 'admin' ? body.dealer_id : membership.dealer_id;
      if (!dealerId) return sendError(res, 422, 'unprocessable', 'dealer_id required');
      const dealer = (await db.query(`SELECT status FROM dealers WHERE id=$1`, [dealerId])).rows[0];
      if (!dealer) return sendError(res, 404, 'not_found', 'Dealer not found');
      if (body.branch_id) {
        const branch = await db.query(`SELECT 1 FROM dealer_branches WHERE id=$1 AND dealer_id=$2`, [body.branch_id, dealerId]);
        if (!branch.rowCount) return sendError(res, 422, 'unprocessable', 'branch_id must belong to dealer');
      }
      const name = String(body.name || '').slice(0, 120);
      if (!name) return sendError(res, 422, 'unprocessable', 'name required (1-120 chars)');
      const kind = String(body.kind || '');
      if (!['baseline', 'maintenance', 'second_opinion'].includes(kind)) return sendError(res, 422, 'unprocessable', 'kind must be baseline|maintenance|second_opinion');
      const description = String(body.description || '').slice(0, 2000);
      if (!description) return sendError(res, 422, 'unprocessable', 'description required');
      const currency = String(body.currency || 'MOP').slice(0, 8);
      const pricingMode = body.pricing_mode === 'quote_required' ? 'quote_required' : 'fixed';
      const priceMinor = pricingMode === 'fixed' ? Number(body.price_minor) : null;
      if (pricingMode === 'fixed' && (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > 10000000)) {
        return sendError(res, 422, 'unprocessable', 'price_minor invalid');
      }
      const duration = Number(body.duration_minutes);
      if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
        return sendError(res, 422, 'unprocessable', 'duration_minutes must be 15-480');
      }
      if ((kind === 'baseline' || kind === 'second_opinion') && !body.checklist_version) {
        return sendError(res, 422, 'unprocessable', 'checklist_version required for baseline/second_opinion');
      }
      const itemIds = Array.isArray(body.service_item_ids) ? [...new Set(body.service_item_ids)] : [];
      let validItems = [];
      if (itemIds.length) {
        const valid = await db.query(`SELECT id FROM dealer_service_items WHERE dealer_id=$1 AND is_active=true AND id=ANY($2::text[])`, [dealerId, itemIds]);
        if (valid.rowCount !== itemIds.length) return sendError(res, 422, 'unprocessable', 'Every service item must be active and belong to the dealer');
        validItems = valid.rows;
      }
      const offerId = randomUUID();
      await db.query(
        `INSERT INTO service_offers
           (id, dealer_id, branch_id, kind, name, description, currency,
            price_minor, pricing_mode, duration_minutes, checklist_version, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE)`,
        [offerId, dealerId, body.branch_id || null, kind, name, description, currency,
         priceMinor, pricingMode, duration, body.checklist_version || null]
      );
      for (const row of validItems) await db.query(`INSERT INTO service_offer_items(offer_id,dealer_service_item_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [offerId,row.id]);
      const offer = await fetchOfferRow(db, offerId);
      await audit({ actor: user, action: 'dealer.offer.create', targetType: 'dealer', targetId: dealerId,
        payload: { offer_id: offerId, kind, pricing_mode: pricingMode } });
      return sendJSON(res, 201, { data: offer });
    }

    // Update offer (publish)
    m = url.match(/^\/api\/dealer\/offers\/([^/?#]+)\/?$/);
    if (m && (req.method === 'PATCH' || req.method === 'POST')) {
      const offer = await fetchOfferRow(db, m[1]);
      if (!offer) return sendError(res, 404, 'not_found', 'Offer not found');
      if (user.role !== 'admin') {
        const mem = await db.query(
          `SELECT 1 FROM dealer_members WHERE dealer_id=$1 AND user_id=$2 AND role IN ('owner','manager')`, [offer.dealer_id, user.id]);
        if (!mem.rowCount) return sendError(res, 403, 'forbidden', 'Owner/manager only');
      }
      const body = await readBody(req);
      if (body.active === true) {
        const candidate = { ...offer, ...body };
        const dealer = (await db.query(`SELECT status,pilot_enabled FROM dealers WHERE id=$1`, [offer.dealer_id])).rows[0];
        if (!dealer || dealer.status !== 'active' || !dealer.pilot_enabled || !pilotAllows(offer.dealer_id)) {
          return sendError(res, 409, 'conflict', 'Dealer is not enabled for the service pilot');
        }
        if (!candidate.branch_id) return sendError(res, 422, 'unprocessable', 'A branch is required before publishing');
        const branch = await db.query(`SELECT 1 FROM dealer_branches WHERE id=$1 AND dealer_id=$2 AND is_active=true`, [candidate.branch_id, offer.dealer_id]);
        if (!branch.rowCount) return sendError(res, 422, 'unprocessable', 'The selected branch is not active');
        if (!['baseline','maintenance','second_opinion'].includes(candidate.kind)) return sendError(res, 422, 'unprocessable', 'Invalid offer kind');
        if (['baseline','second_opinion'].includes(candidate.kind) && !candidate.checklist_version) return sendError(res, 422, 'unprocessable', 'Checklist required before publishing');
        if (candidate.pricing_mode === 'fixed' && (!Number.isInteger(Number(candidate.price_minor)) || Number(candidate.price_minor) < 0)) return sendError(res, 422, 'unprocessable', 'Valid fixed price required');
        const items = await db.query(`SELECT 1 FROM service_offer_items soi JOIN dealer_service_items dsi ON dsi.id=soi.dealer_service_item_id WHERE soi.offer_id=$1 AND dsi.dealer_id=$2 AND dsi.is_active=true`, [offer.id, offer.dealer_id]);
        if (!items.rowCount) return sendError(res, 422, 'unprocessable', 'At least one active service item is required before publishing');
      }
      const sets = [], vals = []; let p = 1;
      for (const [col, max] of [['name', 120], ['description', 2000]]) {
        if (body[col] != null) { sets.push(`${col}=$${p++}`); vals.push(String(body[col]).slice(0, max)); }
      }
      if (body.price_minor != null) { sets.push(`price_minor=$${p++}`); vals.push(Number(body.price_minor)); }
      if (body.duration_minutes != null) { sets.push(`duration_minutes=$${p++}`); vals.push(Number(body.duration_minutes)); }
      if (body.checklist_version != null) { sets.push(`checklist_version=$${p++}`); vals.push(String(body.checklist_version)); }
      if (body.active != null) { sets.push(`active=$${p++}`); vals.push(!!body.active); }
      if (!sets.length) return sendError(res, 422, 'unprocessable', 'No fields to update');
      sets.push('updated_at=NOW()'); sets.push('version=version+1'); vals.push(m[1]);
      const r = await db.query(
        `UPDATE service_offers SET ${sets.join(',')} WHERE id=$${p} RETURNING *`, vals);
      await audit({ actor: user, action: 'dealer.offer.update',
        targetType: 'service_offer', targetId: m[1],
        payload: body });
      return sendJSON(res, 200, { data: r.rows[0] });
    }

    return sendError(res, 404, 'not_found', 'Offer route not found');
  } catch (e) {
    return sendError(res, 422, 'unprocessable', e.message);
  }
}

import { randomUUID } from 'node:crypto';
