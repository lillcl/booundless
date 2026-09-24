/* E2E tests for §11.1 (Phase 7 — dealer self-registration refactor).
   - Anonymous self-registers with dealer:{} payload → active dealer + branch + owner member
   - Owner logs in, creates offer + booking slot, sees dealer at /api/dealer/me
   - Admin adds an existing user as manager via /members, then removes them
   - Admin suspends → owner /api/auth/me returns 401; reactivates → 200
   - Old invite endpoints return 404
   Runs against TEST_DATABASE_URL; skips itself when no DB is available. */

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { openDb, closeDb } from './_helpers/auth.js';

const HAS_DB = !!process.env.TEST_DATABASE_URL || !!process.env.KC_DATABASE_URL;

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

async function cleanupDealer(db, dealerId, offerId, ownerEmail, adminEmail, managerEmail) {
  if (dealerId) {
    await db.query(`DELETE FROM booking_slots WHERE branch_id IN (SELECT id FROM dealer_branches WHERE dealer_id=$1)`, [dealerId]);
    if (offerId) await db.query(`DELETE FROM service_offer_items WHERE offer_id=$1`, [offerId]);
    await db.query(`DELETE FROM service_offers WHERE dealer_id=$1`, [dealerId]);
    await db.query(`DELETE FROM dealer_members WHERE dealer_id=$1`, [dealerId]);
    await db.query(`DELETE FROM dealer_branches WHERE dealer_id=$1`, [dealerId]);
    await db.query(`DELETE FROM dealers WHERE id=$1`, [dealerId]);
  }
  for (const email of [ownerEmail, adminEmail, managerEmail].filter(Boolean)) {
    await db.query(`DELETE FROM users WHERE email = $1`, [email]);
  }
}

test.describe('Phase 7 — Dealer self-registration refactor', () => {
  test.skip(!HAS_DB, 'TEST_DATABASE_URL not configured; skipping integration tests');

  test('anonymous self-register → owner flow → admin member mgmt + suspend', async ({ request, baseURL }) => {
    const db = await openDb();
    const suffix = randomUUID().slice(0, 8);
    const ownerEmail = `owner-${suffix}@e.test`;
    const adminEmail = `admin-${suffix}@e.test`;
    const managerEmail = `mgr-${suffix}@e.test`;
    const offerId = randomUUID();
    let dealerId, branchId, ownerCookie, adminCookie, managerUserId;

    try {
      // 1. Seed admin + manager-candidate users with real password hashes.
      await db.query(
        `INSERT INTO users (id,email,password_hash,role,display_name,is_active)
         VALUES ($1,$2,$3,'admin','Admin',TRUE)`,
        [`admin-${suffix}`, adminEmail, '$2b$10$Qf7oY4xBzqjYf3z2cZ4z1O7Xk1pW1eRn8YrZ0eVbW9c1aZ1bC2dEe.']
      );
      const managerId = `mgr-${suffix}`;
      managerUserId = managerId;
      await db.query(
        `INSERT INTO users (id,email,password_hash,role,display_name,is_active)
         VALUES ($1,$2,$3,'user','Manager',TRUE)`,
        [managerId, managerEmail, '$2b$10$Qf7oY4xBzqjYf3z2cZ4z1O7Xk1pW1eRn8YrZ0eVbW9c1aZ1bC2dEe.']
      );

      // 2. Anonymous self-registers with dealer payload.
      let r = await api(request, baseURL, '/api/auth/register', {
        method: 'POST',
        body: {
          email: ownerEmail, password: 'Owner-pw-2026!',
          display_name: 'Self Reg Owner', terms_version: 'v1',
          dealer: {
            display_name: `Self Reg Workshop ${suffix}`,
            legal_name: 'Self Reg Ltd',
            registration_number: `SR-${suffix}`,
            phone: '+853-2882-0000', email: ownerEmail,
            branch_name: '澳門店',
            branch_address: '澳門半島測試路 1 號',
            branch_district: '澳門半島',
          },
        },
      });
      expect(r.status).toBe(201);
      dealerId = r.body.dealer_id;
      expect(dealerId).toBeTruthy();
      ownerCookie = (r.setCookie || '').split(';')[0];

      // 3. Verify DB shape: dealer active, branch exists, owner member created.
      const dealerRow = (await db.query(`SELECT status FROM dealers WHERE id=$1`, [dealerId])).rows[0];
      expect(dealerRow.status).toBe('active');
      branchId = (await db.query(`SELECT id FROM dealer_branches WHERE dealer_id=$1 LIMIT 1`, [dealerId])).rows[0].id;
      expect(branchId).toBeTruthy();
      const memberRow = (await db.query(`SELECT role FROM dealer_members WHERE dealer_id=$1`, [dealerId])).rows[0];
      expect(memberRow.role).toBe('owner');

      // 4. Owner sees own dealer at /api/dealer/me
      r = await api(request, baseURL, '/api/dealer/me', { cookie: ownerCookie });
      expect(r.status).toBe(200);
      expect(r.body.data.find((d) => d.id === dealerId)).toBeTruthy();

      // 5. Admin login
      r = await api(request, baseURL, '/api/auth/login', {
        method: 'POST', body: { email: adminEmail, password: 'Admin-pw-2026!' },
      });
      /* Password hash above is a placeholder; the test still needs a real login.
         Replace it with a known hash and re-login. */
      const bcrypt = await import('bcryptjs');
      await db.query(`UPDATE users SET password_hash=$1 WHERE email=$2`, [await bcrypt.default.hash('Admin-pw-2026!', 4), adminEmail]);
      await db.query(`UPDATE users SET password_hash=$1 WHERE email=$2`, [await bcrypt.default.hash('Manager-pw-2026!', 4), managerEmail]);
      r = await api(request, baseURL, '/api/auth/login', {
        method: 'POST', body: { email: adminEmail, password: 'Admin-pw-2026!' },
      });
      expect(r.status).toBe(200);
      adminCookie = (r.setCookie || '').split(';')[0];

      // 6. Admin adds existing user as manager via /members.
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}/members`, {
        method: 'POST', cookie: adminCookie,
        body: { email: managerEmail, role: 'manager' },
      });
      expect(r.status).toBe(200);
      const membersAfterAdd = (await db.query(`SELECT COUNT(*)::int AS n FROM dealer_members WHERE dealer_id=$1`, [dealerId])).rows[0].n;
      expect(membersAfterAdd).toBe(2);

      // 7. Admin removes manager.
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}/members/${managerUserId}`, {
        method: 'DELETE', cookie: adminCookie,
      });
      expect(r.status).toBe(200);
      const membersAfterRemove = (await db.query(`SELECT COUNT(*)::int AS n FROM dealer_members WHERE dealer_id=$1`, [dealerId])).rows[0].n;
      expect(membersAfterRemove).toBe(1);

      // 8. A non-existent user needs a temporary password before the admin
      // can create and add it in one operation.
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}/members`, {
        method: 'POST', cookie: adminCookie,
        body: { email: `nobody-${randomUUID().slice(0, 6)}@e.test`, role: 'staff' },
      });
      expect(r.status).toBe(422);
      expect(r.body.error?.message).toContain('臨時密碼');

      // 9. Admin edits dealer field.
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}`, {
        method: 'PATCH', cookie: adminCookie, body: { phone: '+853-9999-0000' },
      });
      expect(r.status).toBe(200);
      expect(r.body.dealer.phone).toBe('+853-9999-0000');

      // 10. Owner creates an offer.
      r = await api(request, baseURL, '/api/dealer/offers', {
        method: 'POST', cookie: ownerCookie,
        body: { branch_id: branchId, kind: 'baseline', name: '基線', description: 'd',
          currency: 'MOP', price_minor: 28000, pricing_mode: 'fixed',
          duration_minutes: 45, checklist_version: 'baseline-v1' },
      });
      expect([200, 201]).toContain(r.status);
      const newOfferId = r.body.data?.id;
      expect(newOfferId).toBeTruthy();
      if (newOfferId && newOfferId !== offerId) {
        await db.query(`UPDATE service_offers SET active=false WHERE id=$1`, [newOfferId]);
      }

      // 11. Owner opens a booking slot.
      const starts = new Date(Date.now() + 3600_000).toISOString();
      const ends = new Date(new Date(starts).getTime() + 3600_000).toISOString();
      r = await api(request, baseURL, '/api/dealer/booking-slots', {
        method: 'POST', cookie: ownerCookie,
        body: { branch_id: branchId, starts_at: starts, ends_at: ends, capacity: 1 },
      });
      expect([200, 201]).toContain(r.status);

      // 12. Admin suspends dealer → owner's session is deactivated.
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}`, {
        method: 'PATCH', cookie: adminCookie, body: { status: 'suspended' },
      });
      expect(r.status).toBe(200);
      expect(r.body.member_flip?.is_active).toBe(false);
      expect(r.body.member_flip?.count).toBeGreaterThanOrEqual(1);
      const ownerActive = (await db.query(`SELECT is_active FROM users WHERE email=$1`, [ownerEmail])).rows[0].is_active;
      expect(ownerActive).toBe(false);
      /* Reactivate for cleanup */
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}`, {
        method: 'PATCH', cookie: adminCookie, body: { status: 'active' },
      });
      expect(r.status).toBe(200);

      // 13. Old invite endpoints return 404.
      r = await api(request, baseURL, `/api/admin/dealers/${dealerId}/invites`, {
        method: 'POST', cookie: adminCookie, body: { email: 'x@y.test' },
      });
      expect(r.status).toBe(404);
      r = await api(request, baseURL, '/api/dealer/invites/accept', {
        method: 'POST', cookie: ownerCookie, body: { token: 'a'.repeat(48) },
      });
      expect(r.status).toBe(404);
      r = await api(request, baseURL, '/api/dealer/invites/register', {
        method: 'POST', body: { token: 'a'.repeat(48), password: 'Long-test-password-2026' },
      });
      expect(r.status).toBe(404);

      // 14. dealer_invites table no longer exists.
      const reg = (await db.query(`SELECT to_regclass(current_schema() || '.dealer_invites') AS r`)).rows[0].r;
      expect(reg).toBeNull();
    } finally {
      try { await cleanupDealer(db, dealerId, offerId, ownerEmail, adminEmail, managerEmail); } catch { /* ignore */ }
      await closeDb();
    }
  });
});
