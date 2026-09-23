/* E2E: admin dealer toggle (suspend / reactivate). Invite flow is covered by
 * service-requests.spec.js seeding pattern; the admin invite UI relies on
 * a <dialog> prompt that needs stubbing and is left for a follow-up. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb,
  cleanupDealer, cleanupUsers,
} from './_helpers/auth.js';
import { hashPassword } from '../../api/_lib/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test('admin suspends and reactivates a dealer', async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const db = await openDb();
  const adminEmail = `admin-${suffix}@example.test`;
  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,$3,'admin','Test Admin')`,
    [`u-admin-${suffix}`, adminEmail, await hashPassword(PASSWORD)],
  );
  const dealerId = `d-pipe-${suffix}`;
  await db.query(
    `INSERT INTO dealers(id,display_name,legal_name,status,created_by_user_id)
     VALUES ($1,$2,$2,'active',$3)`,
    [dealerId, `測試車商 ${suffix.slice(0, 8)}`, `u-admin-${suffix}`],
  );

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  try {
    await login(adminPage, adminEmail, PASSWORD);
    await adminPage.goto('/#/admin/dealers');
    await expect(adminPage.locator('h1', { hasText: '車商' })).toBeVisible({ timeout: 10_000 });
    await expect(adminPage.locator('#adminDealersList')).toContainText(`測試車商 ${suffix.slice(0, 8)}`, { timeout: 10_000 });

    /* Suspend. */
    const suspendResp = adminPage.waitForResponse((r) =>
      r.url().includes(`/api/admin/dealers/${dealerId}`) && r.request().method() === 'PATCH');
    await adminPage.locator(`button[data-dealer-status="${dealerId}"]`).click();
    expect((await suspendResp).status()).toBe(200);
    const suspended = await db.query(`SELECT status FROM dealers WHERE id = $1`, [dealerId]);
    expect(suspended.rows[0].status).toBe('suspended');
    await expect(adminPage.locator(`button[data-dealer-status="${dealerId}"]`)).toHaveAttribute('data-next-status', 'active');

    /* Reactivate is gated by the handler until contact info + branch + a
       service exist (422 'incomplete_setup'). We seed none of those, so the
       UI shows an error toast instead of the DB update — assert the call
       comes back 422 and the DB stays suspended. */
    const activateResp = adminPage.waitForResponse((r) =>
      r.url().includes(`/api/admin/dealers/${dealerId}`) && r.request().method() === 'PATCH');
    await adminPage.locator(`button[data-dealer-status="${dealerId}"]`).click();
    expect((await activateResp).status()).toBe(422);
    const stillSuspended = await db.query(`SELECT status FROM dealers WHERE id = $1`, [dealerId]);
    expect(stillSuspended.rows[0].status).toBe('suspended');
  } finally {
    await cleanupDealer(db, dealerId);
    await cleanupUsers(db, [adminEmail]);
    await closeDb();
    await adminContext.close();
  }
});
