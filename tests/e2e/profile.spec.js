/* E2E: profile sheets — notification preferences + support form. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb, seedUser,
  cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test('user opens profile sheets, toggles notifications, submits support', async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { email } = await seedUser(db, `pipe-profile-${suffix}`, PASSWORD, 'user', 'Profile User');
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, email, PASSWORD);
    /* After login the SPA is on /#/home. Wait for the auth cookie + me to
       be settled (the page runs fetchMe on first load) before navigating. */
    await page.waitForFunction(async () => {
      const r = await fetch('/api/auth/me');
      return r.ok;
    }, null, { timeout: 10_000 });
    await page.goto('/#/profile');
    await expect(page.getByRole('heading', { name: '我的', level: 1 })).toBeVisible({ timeout: 15_000 });
    /* 通知 sheet */
    await page.locator('#profile button.profile-action[data-profile-action="通知"]').click();
    await expect(page.locator('#savePrefsBtn')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[data-pref="ai_suggestions"]').uncheck();
    const patchResp = page.waitForResponse((r) =>
      r.url().endsWith('/api/profile/notifications') && r.request().method() === 'PATCH');
    await page.locator('#savePrefsBtn').click();
    expect([200, 201]).toContain((await patchResp).status());

    const stored = await db.query(
      `SELECT ai_suggestions FROM user_notification_preferences WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    expect(stored.rows[0].ai_suggestions).toBe(false);

    /* 支援 sheet — close the notification overlay first. */
    await page.evaluate(() => {
      document.getElementById('overlay')?.classList.remove('open');
      document.getElementById('sheetContent').innerHTML = '';
    });
    await page.locator('#profile button.profile-action[data-profile-action="支援"]').click();
    await expect(page.locator('#supportForm')).toBeVisible({ timeout: 10_000 });
    await page.locator('#supportSubject').fill('Cannot add second vehicle');
    await page.locator('#supportMessage').fill('Tried to add a motorcycle but the form blocked me.');
    const supportResp = page.waitForResponse((r) =>
      r.url().endsWith('/api/profile/support') && r.request().method() === 'POST');
    await page.locator('#supportForm button[type="submit"]').click();
    expect([200, 201]).toContain((await supportResp).status());

    const ticket = await db.query(
      `SELECT subject, status FROM support_tickets WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    expect(ticket.rowCount).toBe(1);
    expect(ticket.rows[0]).toMatchObject({ subject: 'Cannot add second vehicle', status: 'open' });
  } finally {
    await retryDeadlock(() => db.query(`DELETE FROM support_tickets WHERE user_id = (SELECT id FROM users WHERE email = $1)`, [email]));
    await cleanupUsers(db, [email]);
    await closeDb();
    await context.close();
  }
});