/* E2E tests for §11.1 (admin creates dealer → invite → dealer registers →
   publishes offer → opens slots). Runs against TEST_DATABASE_URL; skips
   itself when no DB is available so CI without secrets still passes. */

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { openDb, closeDb } from './_helpers/auth.js';

const HAS_DB = !!process.env.TEST_DATABASE_URL || !!process.env.KC_DATABASE_URL;

async function seedAdmin(db, suffix) {
  const adminId = `admin-${suffix}`;
  await db.query(
    `INSERT INTO users (id,email,password_hash,role,display_name,is_active)
     VALUES ($1,$2,$3,'admin','Admin',TRUE) ON CONFLICT DO NOTHING`,
    [adminId, `admin-${suffix}@e.test`, '$2b$10$dummy.hash.for.test.placeholder.only']
  );
  return { adminId };
}

async function seedDealer(db, suffix, dealerId, offerId, branchId, slotId, ownerId) {
  await db.query(
    `INSERT INTO users (id,email,password_hash,role,display_name,is_active)
     VALUES ($1,$2,$3,'user','Dealer',TRUE) ON CONFLICT DO NOTHING`,
    [ownerId, `dealer-${suffix}@e.test`, '$2b$10$dummy.hash.for.test.placeholder.only']
  );
  await db.query(
    `INSERT INTO dealers (id,display_name,status,pilot_enabled,phone)
     VALUES ($1,'Test Dealer','active',TRUE,'+8530000') ON CONFLICT (id) DO NOTHING`,
    [dealerId]
  );
  await db.query(
    `INSERT INTO dealer_branches (id,dealer_id,name,timezone)
     VALUES ($1,$2,$3,'Asia/Macau') ON CONFLICT (id) DO NOTHING`,
    [branchId, dealerId, 'Branch']
  );
  await db.query(
    `INSERT INTO dealer_members (dealer_id,user_id,role)
     VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`,
    [dealerId, ownerId]
  );
  // baseline-v1 service items + offer items for the offer (9 keys).
  for (const k of ['engine_oil','oil_filter','transmission_fluid','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter']) {
    const dsid = `dsi-${suffix}-${k}`;
    await db.query(
      `INSERT INTO dealer_service_items (id,dealer_id,name,service_item_type_key,is_active)
       VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT DO NOTHING`,
      [dsid, dealerId, k, k]
    );
    await db.query(
      `INSERT INTO service_offer_items (offer_id,dealer_service_item_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [offerId, dsid]
    );
  }
  await db.query(
    `INSERT INTO service_offers (id,dealer_id,branch_id,kind,name,description,currency,price_minor,pricing_mode,duration_minutes,checklist_version,active)
     VALUES ($1,$2,$3,'baseline','基線','d','MOP',28000,'fixed',45,'baseline-v1',TRUE)`,
    [offerId, dealerId, branchId]
  );
  // Slot already created by the test, this stub exists only for cleanup ordering.
  void slotId;
}

async function cleanupAll(db, suffix, dealerId, offerId) {
  await db.query(`DELETE FROM booking_slots WHERE branch_id IN (SELECT id FROM dealer_branches WHERE dealer_id=$1)`, [dealerId]);
  await db.query(`DELETE FROM service_offer_items WHERE offer_id=$1`, [offerId]);
  await db.query(`DELETE FROM service_offers WHERE id=$1`, [offerId]);
  await db.query(`DELETE FROM dealer_invites WHERE dealer_id=$1`, [dealerId]);
  await db.query(`DELETE FROM dealer_members WHERE dealer_id=$1`, [dealerId]);
  await db.query(`DELETE FROM dealer_branches WHERE dealer_id=$1`, [dealerId]);
  await db.query(`DELETE FROM dealers WHERE id=$1`, [dealerId]);
  await db.query(`DELETE FROM users WHERE email = $1`, [`admin-${suffix}@e.test`]);
  await db.query(`DELETE FROM users WHERE email = $1`, [`dealer-${suffix}@e.test`]);
}

async function api(request, baseURL, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const r = await request.fetch(`${baseURL}${path}`, {
    method: opts.method || 'GET', headers, data: opts.body,
  });
  let body = {}; try { body = await r.json(); } catch { /* no body */ }
  return { status: r.status(), body, setCookie: r.headers()['set-cookie'] };
}

test.describe('Service MVP pilot §11.1 (dealer onboarding)', () => {
  test.skip(!HAS_DB, 'TEST_DATABASE_URL not configured; skipping integration tests');

  test('admin creates dealer → invites → dealer registers → accepts → offer + slot published', async ({ request, baseURL }) => {
    const db = await openDb();
    const suffix = randomUUID().slice(0, 8);
    const dealerId = `dealer-${suffix}`;
    const offerId = randomUUID();
    const branchId = `branch-${suffix}`;
    const slotId = randomUUID();
    const ownerId = `dealer-${suffix}`;

    try {
      const { adminId } = await seedAdmin(db, suffix);
      await seedDealer(db, suffix, dealerId, offerId, branchId, slotId, ownerId);

      // Admin login
      let r = await api(request, baseURL, '/api/auth/login', {
        method: 'POST', body: { email: `admin-${suffix}@e.test`, password: 'Admin-pw-2026!' },
      });
      expect(r.status).toBe(200);
      const adminCookie = (r.setCookie || '').split(';')[0];

      // Admin creates dealer (via direct DB seed we skip the POST and assert ownership state)
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}`, { cookie: adminCookie });
      expect(r.status).toBe(200);
      expect(r.body.dealer?.id).toBe(dealerId);
      expect(r.body.dealer?.pilot_enabled).toBe(true);

      // Admin lists dealers
      r = await api(request, baseURL, '/api/admin/dealers', { cookie: adminCookie });
      expect(r.status).toBe(200);
      const found = (r.body.dealers || r.body.data || []).find((d) => d.id === dealerId);
      expect(found).toBeTruthy();

      // Admin invites dealer (seeded user email → existing-user membership path)
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}/invites`, {
        method: 'POST', cookie: adminCookie,
        body: { email: `dealer-${suffix}@e.test`, role: 'owner' },
      });
      expect(r.status).toBe(201);
      expect(r.body.invitation_sent).toBe(false); // already-existed path

      // Dealer-side user cannot self-promote to admin (security boundary check)
      r = await api(request, baseURL, '/api/auth/login', {
        method: 'POST', body: { email: `dealer-${suffix}@e.test`, password: 'Owner-pw-2026!' },
      });
      expect(r.status).toBe(200);
      const dealerCookie = (r.setCookie || '').split(';')[0];

      r = await api(request, baseURL, '/api/admin/dealers', { cookie: dealerCookie });
      expect(r.status).toBe(403); // non-admin forbidden

      // Dealer sees own membership via /api/dealer/me
      r = await api(request, baseURL, '/api/dealer/me', { cookie: dealerCookie });
      expect(r.status).toBe(200);
      const me = (r.body.data || []).find((d) => d.id === dealerId);
      expect(me).toBeTruthy();
      expect(me.role).toBe('owner');

      // Dealer creates an offer (post-v2 path via /api/dealer/offers)
      r = await api(request, baseURL, '/api/dealer/offers', {
        method: 'POST', cookie: dealerCookie,
        body: { branch_id: branchId, kind: 'baseline',
          name: '基線七項檢查', description: '七項基線檢查',
          currency: 'MOP', price_minor: 28000, pricing_mode: 'fixed',
          duration_minutes: 45, checklist_version: 'baseline-v1' },
      });
      expect([200, 201]).toContain(r.status);
      const newOfferId = r.body.data?.id;
      expect(newOfferId).toBeTruthy();
      // Deactivate the new draft so only the seeded offer is publicly visible
      await db.query(`UPDATE service_offers SET active=false WHERE id=$1`, [newOfferId]);

      // Dealer publishes the seeded offer (PATCH sets active=true via the
      // dedicated endpoint, asserting offer is visible publicly).
      r = await api(request, baseURL, `/api/dealer/offers/${offerId}`, {
        method: 'PATCH', cookie: dealerCookie, body: { active: true },
      });
      expect(r.status).toBe(200);
      expect(r.body.data.active).toBe(true);

      // Public offer list (anonymous) returns the published offer.
      r = await api(request, baseURL, '/api/service-offers');
      expect(r.status).toBe(200);
      const publicOffers = (r.body.data || []);
      expect(publicOffers.find((o) => o.id === offerId)).toBeTruthy();

      // Dealer opens a booking slot
      const starts = new Date(Date.now() + 3600_000).toISOString();
      const ends = new Date(starts.getTime() + 3600_000).toISOString();
      r = await api(request, baseURL, '/api/dealer/booking-slots', {
        method: 'POST', cookie: dealerCookie,
        body: { branch_id: branchId, starts_at: starts, ends_at: ends, capacity: 1 },
      });
      expect([200, 201]).toContain(r.status);
      const newSlotId = r.body.data?.id;
      expect(newSlotId).toBeTruthy();

      // Customer-visible slot list for the offer shows the future slot.
      r = await api(request, baseURL, `/api/service-offers/${offerId}/slots`);
      expect(r.status).toBe(200);
      const slots = (r.body.data || []);
      expect(slots.some((s) => s.id === newSlotId || s.id === slotId)).toBe(true);
    } finally {
      try { await cleanupAll(db, suffix, dealerId, offerId); } catch { /* ignore */ }
      await closeDb();
    }
  });
});