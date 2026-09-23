/* E2E: admin user management — create user, toggle is_active, soft delete. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb, seedUser,
  cleanupUsers,
} from './_helpers/auth.js';
import { hashPassword } from '../../api/_lib/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test('admin creates a user, toggles is_active, and soft-deletes; non-admin cannot reach the API', async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const db = await openDb();
  const adminId = `u-admin-${suffix}`;
  const adminEmail = `admin-${suffix}@example.test`;
  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name) VALUES ($1,$2,$3,'admin','Test Admin')`,
    [adminId, adminEmail, await hashPassword(PASSWORD)],
  );
  const newEmail = `newuser-${suffix}@example.test`;
  const adminContext = await browser.newContext();
  const userContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const userPage = await userContext.newPage();
  let userId = null;
  try {
    await login(adminPage, adminEmail, PASSWORD);
    await adminPage.goto('/#/admin/users');
    await expect(adminPage.locator('h1', { hasText: '用戶管理' })).toBeVisible({ timeout: 10_000 });

    /* Create user via the UI form. */
    await adminPage.locator('#userCreateEmail').fill(newEmail);
    await adminPage.locator('#userCreatePassword').fill(PASSWORD);
    await adminPage.locator('#userCreateRole').selectOption('user');
    const createResp = adminPage.waitForResponse((r) => r.url().endsWith('/api/users') && r.request().method() === 'POST');
    await adminPage.locator('#userCreateForm button[type="submit"]').click();
    const created = await (await createResp).json();
    userId = created.user?.id || created.id;
    expect(userId).toBeTruthy();
    await expect(adminPage.locator('#usersList')).toContainText(newEmail, { timeout: 10_000 });

    /* Toggle is_active via the UI button. */
    const toggleResp = adminPage.waitForResponse((r) =>
      r.url().includes(`/api/users/${userId}`) && r.request().method() === 'PATCH');
    await adminPage.locator(`button[data-act="toggle"][data-uid="${userId}"]`).click();
    expect((await toggleResp).status()).toBe(200);
    const toggled = await db.query(`SELECT is_active FROM users WHERE id = $1`, [userId]);
    expect(toggled.rows[0].is_active).toBe(false);

    /* Soft-delete via API. */
    const delResp = await adminPage.evaluate(async ({ userId }) => {
      const r = await fetch(`/api/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      return { status: r.status, body: await r.json() };
    }, { userId });
    expect(delResp.status).toBe(200);
    const deleted = await db.query(`SELECT is_active FROM users WHERE id = $1`, [userId]);
    expect(deleted.rows[0].is_active).toBe(false);

    /* Non-admin cannot reach /api/users. */
    const { userId: regularId, email: regularEmail } = await seedUser(db, `pipe-reg-${suffix}`, PASSWORD, 'user', 'Regular');
    await login(userPage, regularEmail, PASSWORD);
    const blocked = await userPage.evaluate(async () => {
      const r = await fetch('/api/users');
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body?.error?.message).toMatch(/Admin only/);
  } finally {
    await retryDeadlock(() => db.query(`DELETE FROM audit_log WHERE actor_email = ANY($1::text[])`, [[adminEmail, newEmail]]));
    await retryDeadlock(() => db.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [[adminEmail, newEmail]]));
    if (userId) {
      await retryDeadlock(() => db.query(`DELETE FROM users WHERE id = $1`, [userId]));
    }
    await cleanupUsers(db, [adminEmail, newEmail, `pipe-reg-${suffix}@example.test`]);
    await closeDb();
    await adminContext.close();
    await userContext.close();
  }
});