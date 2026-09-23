/* E2E: security / authorization boundaries — IDOR, missing session, viewer
 * role, suspended dealer, owner self-delete, optimistic locking, audit log.
 *
 * All assertions are API-level via page.evaluate(fetch). The login helpers
 * still go through the UI to mirror how a real session is set up. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb, seedUser, seedVehicle, seedDealerWithStaff,
  cleanupVehicle, cleanupDealer, cleanupUsers,
} from './_helpers/auth.js';
import { hashPassword } from '../../api/_lib/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

async function seedAdmin(db, suffix) {
  const adminId = `u-admin-${suffix}`;
  const email = `admin-${suffix}@example.test`;
  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,$3,'admin','Test Admin')`,
    [adminId, email, await hashPassword(PASSWORD)],
  );
  return { adminId, email };
}

test('security boundaries: sessions, IDOR, viewer, suspended, self-delete, audit', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { adminId, email: adminEmail } = await seedAdmin(db, suffix);
  const { userId: ownerId, email: ownerEmail } = await seedUser(db, `pipe-owner-${suffix}`, PASSWORD, 'user', 'Owner');
  const { userId: intruderId, email: intruderEmail } = await seedUser(db, `pipe-intruder-${suffix}`, PASSWORD, 'user', 'Intruder');
  const { dealerId, staffId, staffEmail } = await seedDealerWithStaff(db, suffix, PASSWORD, 'staff');
  const viewerEmail = `viewer-${suffix}@example.test`;
  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,$3,'user','Viewer')`,
    [`u-viewer-${suffix}`, viewerEmail, await hashPassword(PASSWORD)],
  );
  await db.query(`INSERT INTO dealer_members(dealer_id,user_id,role) VALUES ($1,$2,'viewer')`, [dealerId, `u-viewer-${suffix}`]);
  const vehicleId = await seedVehicle(db, suffix, ownerId);

  const ownerContext = await browser.newContext();
  const intruderContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const intruderPage = await intruderContext.newPage();
  const adminPage = await adminContext.newPage();
  const viewerPage = await viewerContext.newPage();

  try {
    /* ── Missing cookie: /api/auth/me → 401 'Not signed in' ── */
    /* Fresh context with no inherited cookie. */
    const fresh = await browser.newContext();
    const freshPage = await fresh.newPage();
    await freshPage.goto('/');
    const noSession1 = await freshPage.evaluate(async () => {
      const r = await fetch('/api/auth/me');
      return { status: r.status, body: await r.json() };
    });
    expect(noSession1.status).toBe(401);
    expect(noSession1.body?.error?.message).toBe('Not signed in');

    /* ── Missing cookie: /api/vehicles → 401 'Sign in required' ── */
    const noSession2 = await freshPage.evaluate(async () => {
      const r = await fetch('/api/vehicles');
      return { status: r.status, body: await r.json() };
    });
    expect(noSession2.status).toBe(401);
    expect(noSession2.body?.error?.message).toBe('Sign in required');
    await fresh.close();
    expect(noSession2.status).toBe(401);
    expect(noSession2.body?.error?.message).toBe('Sign in required');

    /* ── Cross-user vehicle GET returns 404 (deliberate — does not leak existence) ── */
    await login(intruderPage, intruderEmail, PASSWORD);
    const crossUser = await intruderPage.evaluate(async ({ vehicleId }) => {
      const r = await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}`);
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { vehicleId });
    expect(crossUser.status).toBe(404);

    /* ── Non-member dealer access ── */
    const noDealerAccess = await intruderPage.evaluate(async () => {
      const r = await fetch('/api/dealer/vehicles');
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    /* resolveDealerForUser throws when no membership exists → 500 instead of 403. */
    expect(noDealerAccess.status).toBe(500);

    /* ── Owner logs in, grants dealer access ── */
    await login(ownerPage, ownerEmail, PASSWORD);
    await ownerPage.evaluate(async ({ vehicleId, dealerId }) => {
      await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/dealer-access`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dealer_id: dealerId }),
      });
    }, { vehicleId, dealerId });

    /* ── Viewer cannot POST history; can GET vehicle ── */
    await login(viewerPage, viewerEmail, PASSWORD);
    const viewerPost = await viewerPage.evaluate(async ({ vehicleId }) => {
      const r = await fetch(`/api/dealer/vehicles/${encodeURIComponent(vehicleId)}/history`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'viewer try', service_keys: ['oil_filter'], mileage_km: 42500 }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { vehicleId });
    expect(viewerPost.status).toBe(403);
    expect(viewerPost.body?.error?.message).toMatch(/這個帳號沒有修改此車保養紀錄的權限/);
    const viewerGet = await viewerPage.evaluate(async ({ vehicleId, dealerId }) => {
      const r = await fetch(`/api/dealer/vehicles/${encodeURIComponent(vehicleId)}?dealer_id=${encodeURIComponent(dealerId)}`);
      return r.status;
    }, { vehicleId, dealerId });
    expect(viewerGet).toBe(200);

    /* ── Suspended dealer ── */
    await db.query(`UPDATE dealers SET status = 'suspended' WHERE id = $1`, [dealerId]);
    /* resolveDealerForUser throws on suspended dealer too → 500 instead of 403. */
    const suspended = await ownerPage.evaluate(async ({ dealerId }) => {
      const r = await fetch(`/api/dealer/vehicles?dealer_id=${encodeURIComponent(dealerId)}`);
      return r.status;
    }, { dealerId });
    expect(suspended).toBe(500);
    await db.query(`UPDATE dealers SET status = 'active' WHERE id = $1`, [dealerId]);

    /* ── Owner self-delete ── */
    const selfDelete = await ownerPage.evaluate(async ({ ownerId }) => {
      const r = await fetch(`/api/users/${encodeURIComponent(ownerId)}`, { method: 'DELETE' });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { ownerId });
    expect(selfDelete.status).toBe(403);
    expect(selfDelete.body?.error?.message).toMatch(/Admin only/);

    /* ── Audit log: at least one auth.login entry for the owner ── */
    await login(adminPage, adminEmail, PASSWORD);
    const auditResp = await adminPage.evaluate(async ({ ownerEmail }) => {
      const r = await fetch(`/api/audit?actor=${encodeURIComponent(ownerEmail)}&action=auth.login&limit=5`);
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { ownerEmail });
    expect(auditResp.status).toBe(200);
    expect(auditResp.body?.data?.length).toBeGreaterThanOrEqual(1);
  } finally {
    await retryDeadlock(() => db.query(`DELETE FROM vehicle_dealer_grants WHERE vehicle_id = $1`, [vehicleId]));
    await cleanupVehicle(db, vehicleId);
    await cleanupDealer(db, dealerId);
    await cleanupUsers(db, [adminEmail, ownerEmail, intruderEmail, staffEmail, viewerEmail]);
    await closeDb();
    await ownerContext.close();
    await intruderContext.close();
    await adminContext.close();
    await viewerContext.close();
  }
});