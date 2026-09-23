/* Booking-slot management (T4).
   GET  /api/dealer/booking-slots           — members read slots for their dealer
   POST /api/dealer/booking-slots           — owner/manager create slots
   PATCH /api/dealer/booking-slots/:id      — owner/manager update (cancel or move)
   GET  /api/service-offers/:id/slots       — customer view (only active, future slots)
*/

import { getDb } from '../_lib/db.js';
import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON, readBody, onlyMethod } from '../_lib/http.js';
import { audit } from '../_lib/auth.js';

async function loadMember(client, dealerId, userId, allowed = ['owner', 'manager']) {
  return (await client.query(
    `SELECT m.role FROM dealer_members m
       WHERE m.dealer_id=$1 AND m.user_id=$2 AND m.role = ANY($3::text[])
         AND EXISTS (SELECT 1 FROM dealers d WHERE d.id=m.dealer_id AND d.status='active')`,
    [dealerId, userId, allowed]
  )).rows[0];
}

function parseSlotPayload(body) {
  if (!body?.branch_id || typeof body.branch_id !== 'string') throw new Error('branch_id required');
  const starts = new Date(body.starts_at);
  const ends = new Date(body.ends_at);
  if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime())) throw new Error('starts_at/ends_at invalid');
  if (ends <= starts) throw new Error('ends_at must be after starts_at');
  const capacity = Number.isInteger(body.capacity) ? body.capacity : 1;
  if (capacity < 1 || capacity > 20) throw new Error('capacity must be 1-20');
  return { branch_id: body.branch_id, starts_at: starts.toISOString(),
           ends_at: ends.toISOString(), capacity };
}

export default async function handler(req, res) {
  const url = (req.url || '').replace(/\/+$/, '');
  const user = await requireUser(req, res); if (!user) return;
  const db = await getDb();
  const client = await db.connect();

  try {
    // Customer view: future slots for an offer's branch
    const offerMatch = url.match(/^\/api\/service-offers\/([^/?#]+)\/slots\/?$/);
    if (offerMatch) {
      if (!onlyMethod(req, res, ['GET'])) { await client.release(); return; }
      const offerId = offerMatch[1];
      const offer = (await client.query(
        `SELECT * FROM service_offers WHERE id=$1 AND active=true`, [offerId]
      )).rows[0];
      if (!offer) { await client.release(); return sendError(res, 404, 'not_found', 'Offer not found'); }
      // Slot must be at least offer.duration_minutes long.
      const slots = (await client.query(
        `SELECT bs.id, bs.starts_at, bs.ends_at, bs.capacity,
                (SELECT COUNT(*)::int FROM service_bookings sb
                  WHERE sb.slot_id=bs.id AND sb.status='confirmed') AS booked
           FROM booking_slots bs
          WHERE bs.branch_id=$1 AND bs.active=true AND bs.starts_at > NOW()
            AND bs.ends_at >= $2::timestamptz + ($3 || ' minutes')::interval
          ORDER BY bs.starts_at ASC LIMIT 50`,
        [offer.branch_id, offer.starts_at || new Date().toISOString(), String(offer.duration_minutes)]
      )).rows;
      await client.release();
      return sendJSON(res, 200, { data: slots });
    }

    // Dealer workspace
    const dealerMatch = url.match(/^\/api\/dealer\/booking-slots(?:\/([^/?#]+))?\/?$/);
    if (!dealerMatch) { await client.release(); return sendError(res, 404, 'not_found', 'Booking-slot route not found'); }
    const slotId = dealerMatch[1];
    if (req.method === 'GET' && !slotId) {
      // List slots for the user's dealer (no dealer id from URL; use first membership).
      const memberships = await client.query(
        `SELECT dealer_id FROM dealer_members WHERE user_id=$1
           AND role IN ('owner','manager','staff','viewer')
           AND EXISTS (SELECT 1 FROM dealers d WHERE d.id=dealer_members.dealer_id AND d.status='active')
           ORDER BY created_at LIMIT 1`, [user.id]
      );
      if (!memberships.rowCount) { await client.release(); return sendJSON(res, 200, { data: [] }); }
      const slots = (await client.query(
        `SELECT * FROM booking_slots WHERE branch_id IN (
            SELECT id FROM dealer_branches WHERE dealer_id=$1
          ) ORDER BY starts_at ASC LIMIT 100`, [memberships.rows[0].dealer_id]
      )).rows;
      await client.release();
      return sendJSON(res, 200, { data: slots });
    }
    if (req.method === 'POST' && !slotId) {
      const body = await readBody(req);
      const payload = parseSlotPayload(body);
      const branch = (await client.query(
        `SELECT dealer_id FROM dealer_branches WHERE id=$1`, [payload.branch_id]
      )).rows[0];
      if (!branch) { await client.release(); return sendError(res, 404, 'not_found', 'Branch not found'); }
      const member = await loadMember(client, branch.dealer_id, user.id);
      if (!member) { await client.release(); return sendError(res, 403, 'forbidden', 'Owner/manager required'); }
      const inserted = await client.query(
        `INSERT INTO booking_slots (branch_id, starts_at, ends_at, capacity, active)
         VALUES ($1, $2::timestamptz, $3::timestamptz, $4, true) RETURNING *`,
        [payload.branch_id, payload.starts_at, payload.ends_at, payload.capacity]
      );
      await audit({ actor: user, action: 'booking_slot.create',
        targetType: 'booking_slot', targetId: inserted.rows[0].id });
      await client.release();
      return sendJSON(res, 201, { data: inserted.rows[0] });
    }
    if (req.method === 'PATCH' && slotId) {
      const body = await readBody(req);
      const slot = (await client.query(
        `SELECT bs.*, db.dealer_id FROM booking_slots bs
           JOIN dealer_branches db ON db.id=bs.branch_id WHERE bs.id=$1`, [slotId]
      )).rows[0];
      if (!slot) { await client.release(); return sendError(res, 404, 'not_found', 'Slot not found'); }
      const member = await loadMember(client, slot.dealer_id, user.id);
      if (!member) { await client.release(); return sendError(res, 403, 'forbidden', 'Owner/manager required'); }
      const updates = [];
      const args = [];
      let i = 1;
      if (typeof body.active === 'boolean') { updates.push(`active=$${i++}`); args.push(body.active); }
      if (body.starts_at) { updates.push(`starts_at=$${i++}::timestamptz`); args.push(new Date(body.starts_at).toISOString()); }
      if (body.ends_at) { updates.push(`ends_at=$${i++}::timestamptz`); args.push(new Date(body.ends_at).toISOString()); }
      if (Number.isInteger(body.capacity)) { updates.push(`capacity=$${i++}`); args.push(body.capacity); }
      if (!updates.length) { await client.release(); return sendError(res, 422, 'unprocessable', 'No updatable fields'); }
      updates.push(`version=version+1`);
      updates.push(`updated_at=NOW()`);
      args.push(slotId);
      const r = await client.query(
        `UPDATE booking_slots SET ${updates.join(',')} WHERE id=$${i} RETURNING *`, args
      );
      await client.release();
      return sendJSON(res, 200, { data: r.rows[0] });
    }

    await client.release();
    return sendError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client.release();
    return sendError(res, 422, 'unprocessable', e.message);
  }
}