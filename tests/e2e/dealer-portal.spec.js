/* E2E: dealer portal — add a service item + fitment rule, toggle
 * per-branch services, and verify viewer role cannot add. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb, seedDealerWithStaff,
  cleanupDealer, cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test('manager adds a service + fitment, toggles branch services, viewer cannot edit', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { dealerId, staffId: managerId, staffEmail: managerEmail } = await seedDealerWithStaff(db, suffix, PASSWORD, 'manager');
  const branchId = `branch-${suffix}`;
  await db.query(
    `INSERT INTO dealer_branches(id,dealer_id,name,address,district,phone,opening_hours)
     VALUES ($1,$2,'氹仔分店','氹仔市中心','氹仔','+852 1234 5678','{}'::jsonb)`,
    [branchId, dealerId],
  );

  const managerContext = await browser.newContext();
  const viewerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  const viewerPage = await viewerContext.newPage();

  let viewerEmail = null;
  try {
    /* ── Manager: add a service + fitment ────────────────────────────────── */
    await login(managerPage, managerEmail, PASSWORD);
    await managerPage.goto('/#/dealer');
    await expect(managerPage.locator('#dealerServiceKey')).toBeVisible({ timeout: 10_000 });
    /* Wait for the catalogue to load (the select is initially disabled). */
    await managerPage.waitForFunction(() => {
      const select = document.getElementById('dealerServiceKey');
      return select && select.options.length > 1;
    }, null, { timeout: 10_000 });
    await managerPage.locator('#dealerServiceKey').selectOption('oil_filter');
    await managerPage.locator('#dealerServiceName').fill('機油及機油隔更換');
    await managerPage.locator('#dealerFitMake').fill('Toyota');
    await managerPage.locator('#dealerFitModel').fill('Corolla');
    await managerPage.locator('#dealerFitYearFrom').fill('2018');
    await managerPage.locator('#dealerFitYearTo').fill('2025');
    const addResp = managerPage.waitForResponse((r) =>
      r.url().includes('/api/dealer/services') && r.request().method() === 'POST');
    await managerPage.locator('#dealerAddService').click();
    expect((await addResp).status()).toBe(201);
    await expect(managerPage.locator('#dealerPortalResult')).toContainText('服務已新增');

    const services = await db.query(
      `SELECT id, name, service_item_type_key FROM dealer_service_items WHERE dealer_id = $1`,
      [dealerId],
    );
    expect(services.rowCount).toBe(1);
    expect(services.rows[0]).toMatchObject({ name: '機油及機油隔更換', service_item_type_key: 'oil_filter' });

    const fitments = await db.query(
      `SELECT f.make_norm, f.model_norm FROM dealer_item_fitments f
         JOIN dealer_service_items s ON s.id = f.dealer_service_item_id
        WHERE s.dealer_id = $1`,
      [dealerId],
    );
    expect(fitments.rowCount).toBe(1);
    expect(fitments.rows[0]).toMatchObject({ make_norm: 'Toyota', model_norm: 'Corolla' });

    /* ── Manager: per-branch toggle ────────────────────────────────── */
    /* Wait for the branch form to render after the portal re-loads. */
    await expect(managerPage.locator('#dealerServicesList').getByText('氹仔分店')).toBeVisible({ timeout: 10_000 });
    const branchCheckbox = managerPage
      .locator('#dealerServicesList input[type="checkbox"][name="service_ids"]').first();
    await branchCheckbox.check();
    const branchPut = managerPage.waitForResponse((r) =>
      r.url().includes(`/api/dealer/branches/${branchId}/services`) && r.request().method() === 'PUT');
    await managerPage.locator('#dealerServicesList').getByRole('button', { name: '儲存分店服務' }).first().click();
    expect((await branchPut).status()).toBe(200);

    const branchServices = await db.query(
      `SELECT service_id FROM dealer_branch_services WHERE branch_id = $1`,
      [branchId],
    );
    expect(branchServices.rowCount).toBe(1);

    /* ── Viewer role cannot edit ─────────────────────────────────────── */
    const viewerSuffix = randomUUID();
    const viewerId = `u-viewer-${viewerSuffix}`;
    viewerEmail = `viewer-${viewerSuffix}@example.test`;
    const passwordHash = await (await import('../../api/_lib/auth.js')).hashPassword(PASSWORD);
    await db.query(
      `INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,$3,'user','Viewer')`,
      [viewerId, viewerEmail, passwordHash],
    );
    await db.query(
      `INSERT INTO dealer_members(dealer_id,user_id,role) VALUES ($1,$2,'viewer')`,
      [dealerId, viewerId],
    );
    await login(viewerPage, viewerEmail, PASSWORD);
    await viewerPage.goto('/#/dealer');
    /* Viewer should see the portal but the add-service button is disabled
       (the catalogue loads but the submit button is not enabled because the
       catalogue-load handler ties enabled state to the role for viewers). */
    /* Direct API attempt is the most reliable assertion. */
    const blocked = await viewerPage.evaluate(async ({ dealerId }) => {
      const r = await fetch(`/api/dealer/services?dealer_id=${encodeURIComponent(dealerId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ service_item_type_key: 'oil_filter', name: 'viewer try' }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { dealerId });
    expect(blocked.status).toBe(403);
  } finally {
    await retryDeadlock(() => db.query(`DELETE FROM dealer_branch_services WHERE branch_id = $1`, [branchId]));
    await retryDeadlock(() => db.query(`DELETE FROM dealer_branches WHERE dealer_id = $1`, [dealerId]));
    await cleanupDealer(db, dealerId);
    await cleanupUsers(db, [managerEmail, viewerEmail].filter(Boolean));
    await closeDb();
    await managerContext.close();
    await viewerContext.close();
  }
});
