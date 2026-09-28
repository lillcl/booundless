/* E2E: onboarding completion sheet — the three branches (history_pending,
 * baseline_pending, ready) from the "車輛護照已建立" sheet. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  signup, retryDeadlock,
  openDb, closeDb, cleanupVehicle, cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

async function addCar(page) {
  await page.goto('/#/garage');
  await expect(page.getByRole('heading', { name: '我的車輛', level: 1 })).toBeVisible();
  await page.locator('[data-add-passport]').first().click();
  await page.locator('[data-add-mode="manual"]').click();
  await page.locator('button[data-class="light_passenger"]').click();
  await page.locator('button[data-powertrain="fuel"]').click();
  await page.locator('button[data-brand="Toyota"]').click();
  await expect(page.locator('#newVehicleModel')).toBeVisible({ timeout: 15_000 });
  await page.locator('#newVehicleMake').fill('Toyota');
  await page.locator('#newVehicleModel').fill('Corolla');
  await page.locator('#newVehicleYear').fill('2021');
  await page.locator('#newVehicleMileage').fill('42000');
  const createResp = page.waitForResponse((r) => r.url().endsWith('/api/vehicles') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '確認並新增車輛' }).click();
  const created = await (await createResp).json();
  return created.id;
}

test.describe('onboarding completion paths', () => {
  test.setTimeout(180_000);

  test('history_pending path', async ({ browser }) => {
    const suffix = randomUUID();
    const email = `ob-history-${suffix}@example.test`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const db = await openDb();
    let vehicleId = null;
    try {
      await signup(page, 'OB History', email, PASSWORD);
      vehicleId = await addCar(page);
      const onboardingResp = page.waitForResponse((r) =>
        r.url().includes(`/api/vehicles/${vehicleId}/onboarding`) && r.request().method() === 'POST');
      await page.getByRole('button', { name: /稍後補上保養紀錄/ }).click();
      expect((await onboardingResp).status()).toBe(200);
      const row = await db.query(`SELECT onboarding_state FROM vehicles WHERE id = $1`, [vehicleId]);
      expect(row.rows[0].onboarding_state).toBe('history_pending');
    } finally {
      await cleanupVehicle(db, vehicleId);
      await cleanupUsers(db, [email]);
      await closeDb();
      await context.close();
    }
  });

  test('baseline_pending path', async ({ browser }) => {
    const suffix = randomUUID();
    const email = `ob-baseline-${suffix}@example.test`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const db = await openDb();
    let vehicleId = null;
    try {
      await signup(page, 'OB Baseline', email, PASSWORD);
      vehicleId = await addCar(page);
      const onboardingResp = page.waitForResponse((r) =>
        r.url().includes(`/api/vehicles/${vehicleId}/onboarding`) && r.request().method() === 'POST');
      await page.getByRole('button', { name: /目前沒有紀錄/ }).click();
      expect((await onboardingResp).status()).toBe(200);
      const row = await db.query(`SELECT onboarding_state FROM vehicles WHERE id = $1`, [vehicleId]);
      expect(row.rows[0].onboarding_state).toBe('baseline_pending');
    } finally {
      await cleanupVehicle(db, vehicleId);
      await cleanupUsers(db, [email]);
      await closeDb();
      await context.close();
    }
  });

  test('ready path (skip)', async ({ browser }) => {
    const suffix = randomUUID();
    const email = `ob-ready-${suffix}@example.test`;
    const context = await browser.newContext();
    const page = await context.newPage();
    const db = await openDb();
    let vehicleId = null;
    try {
      await signup(page, 'OB Ready', email, PASSWORD);
      vehicleId = await addCar(page);
      await page.getByRole('button', { name: '稍後處理，前往我的車' }).click();
      await expect(page).toHaveURL(/#\/garage$/, { timeout: 10_000 });
      const row = await db.query(`SELECT onboarding_state FROM vehicles WHERE id = $1`, [vehicleId]);
      expect(row.rows[0].onboarding_state).toBe('ready');
    } finally {
      await cleanupVehicle(db, vehicleId);
      await cleanupUsers(db, [email]);
      await closeDb();
      await context.close();
    }
  });
});
