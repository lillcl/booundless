/* E2E: dealer access — grant + revoke (UI) and IDOR (cross-user). */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, signup, retryDeadlock,
  openDb, closeDb, seedUser, seedVehicle,
  cleanupVehicle, cleanupDealer, cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test('owner grants dealer access, revokes it, and IDOR is blocked', async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { userId: ownerId, email: ownerEmail } = await seedUser(db, `pipe-owner-${suffix}`, PASSWORD, 'user', 'Owner');
  const { userId: intruderId, email: intruderEmail } = await seedUser(db, `pipe-intruder-${suffix}`, PASSWORD, 'user', 'Intruder');
  const { dealerId, staffEmail, dealerDisplayName } = await (await import('./_helpers/auth.js')).seedDealerWithStaff(db, suffix, PASSWORD);
  const vehicleId = await seedVehicle(db, suffix, ownerId);

  const ownerContext = await browser.newContext();
  const intruderContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const intruderPage = await intruderContext.newPage();

  try {
    /* Owner logs in via UI, opens passport, grants + revokes. */
    await login(ownerPage, ownerEmail, PASSWORD);
    await ownerPage.goto('/#/garage');
    await ownerPage.getByRole('button', { name: /開啟 Toyota Corolla 車輛護照/ }).click();
    let reader = ownerPage.getByRole('dialog', { name: /Toyota Corolla 車輛護照/ });
    await reader.getByRole('button', { name: '下一頁' }).click();
    await reader.getByRole('button', { name: '下一頁' }).click();
    await reader.getByRole('button', { name: '管理車商權限' }).click();
    const access = ownerPage.locator('.vp-editor.is-open');
    await access.locator('select[name="dealer_id"]').selectOption(dealerId);
    const grantResp = ownerPage.waitForResponse((r) => r.url().includes(`/api/vehicles/${vehicleId}/dealer-access`) && r.request().method() === 'POST');
    await access.getByRole('button', { name: '授權車商' }).click();
    expect((await grantResp).status()).toBe(201);
    await expect(access.locator('.vp-access-list')).toContainText(dealerDisplayName);

    const grantRow = await db.query(
      `SELECT id FROM vehicle_dealer_grants WHERE vehicle_id = $1 AND dealer_id = $2 AND revoked_at IS NULL`,
      [vehicleId, dealerId],
    );
    expect(grantRow.rowCount).toBe(1);
    const grantId = grantRow.rows[0].id;

    /* Force-close any open passport/editor modals, reload, and click the book again. */
    await ownerPage.evaluate(() => {
      document.querySelectorAll('.vp-reader.is-open, .vp-editor.is-open').forEach((el) => el.remove());
      document.body.style.overflow = '';
    });
    await ownerPage.reload();
    await ownerPage.getByRole('button', { name: /開啟 Toyota Corolla 車輛護照/ }).click();
    const reader2 = ownerPage.getByRole('dialog', { name: /Toyota Corolla 車輛護照/ });
    await expect(reader2).toBeVisible({ timeout: 10_000 });
    await reader2.getByRole('button', { name: '下一頁' }).click();
    await reader2.getByRole('button', { name: '下一頁' }).click();
    await reader2.getByRole('button', { name: '管理車商權限' }).click();
    const access2 = ownerPage.locator('.vp-editor.is-open');
    await expect(access2).toBeVisible();
    await access2.locator(`button[data-revoke-grant="${grantId}"]`).click();
    await expect(access2.locator(`button[data-revoke-grant="${grantId}"]`)).toHaveCount(0);

    const revoked = await db.query(
      `SELECT revoked_at FROM vehicle_dealer_grants WHERE id = $1`,
      [grantId],
    );
    expect(revoked.rows[0].revoked_at).not.toBeNull();

    /* Re-grant the same dealer; UPSERT revives the same row (vehicle_id,
       dealer_id has a unique index, so total count stays 1 but
       revoked_at is reset). */
    await access2.locator('select[name="dealer_id"]').selectOption(dealerId);
    const regrantResp = ownerPage.waitForResponse((r) => r.url().includes(`/api/vehicles/${vehicleId}/dealer-access`) && r.request().method() === 'POST');
    await access2.getByRole('button', { name: '授權車商' }).click();
    expect((await regrantResp).status()).toBe(201);
    await expect(access2.locator('.vp-access-list')).toContainText(dealerDisplayName);
    const regrant = await db.query(
      `SELECT COUNT(*)::int AS n, BOOL_OR(revoked_at IS NULL) AS any_active
         FROM vehicle_dealer_grants WHERE vehicle_id = $1 AND dealer_id = $2`,
      [vehicleId, dealerId],
    );
    expect(regrant.rows[0].n).toBe(1);
    expect(regrant.rows[0].any_active).toBe(true);

    /* IDOR: a second user (intentionally seeded as a different account) tries
       to DELETE the owner's grant. The endpoint returns 404, not 403, to
       avoid leaking the existence of the vehicle. */
    await login(intruderPage, intruderEmail, PASSWORD);
    const idorStatus = await intruderPage.evaluate(async ({ vehicleId, grantId }) => {
      const r = await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/dealer-access/${encodeURIComponent(grantId)}`, { method: 'DELETE' });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { vehicleId, grantId });
    expect(idorStatus.status).toBe(404);
    expect(idorStatus.body?.error?.message).toMatch(/Vehicle not found|找不到有效授權/);
  } finally {
    await cleanupVehicle(db, vehicleId);
    await cleanupDealer(db, dealerId);
    await cleanupUsers(db, [ownerEmail, intruderEmail, staffEmail]);
    await closeDb();
    await ownerContext.close();
    await intruderContext.close();
  }
});
