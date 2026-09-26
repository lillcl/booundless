import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '../../api/_lib/db.js';
import { hashPassword } from '../../api/_lib/auth.js';

test('vehicle passport opens live identity, maintenance, history and reminders', async ({ page }) => {
  test.setTimeout(45_000);
  const suffix = randomUUID();
  const userId = `u-passport-${suffix}`;
  const vehicleId = `v-passport-${suffix}`;
  const email = `passport-${suffix}@example.test`;
  const password = 'Passport-e2e-only-2026!';
  const db = await getDb();

  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name)
     VALUES($1,$2,$3,'user','Passport E2E')`,
    [userId, email, await hashPassword(password)],
  );
  await db.query(
    `INSERT INTO vehicles
      (id,model,make,year,fuel_type,vehicle_class,powertrain_type,onboarding_state,
       plate,mileage_km,mileage_label,image,owner,team,created_by_user_id,updated_by_user_id)
     VALUES($1,'Corolla Cross','Toyota',2024,'Hybrid','light_passenger','hybrid','ready',
       'MP-2026','18640','18,640 km','/assets/vehicle-toyota.jpg','Passport E2E','personal',$2,$2)`,
    [vehicleId, userId],
  );
  await db.query(
    `INSERT INTO vehicle_status
      (vehicle_id,item,interval_km,interval_months,last_done_km,last_done_at,wear,display_order)
     VALUES($1,'機油及機油隔',10000,12,12000,'2026-01-15',82,1)`,
    [vehicleId],
  );
  await db.query(
    `INSERT INTO service_history(id,vehicle_id,performed_at,kind,title,cost,mileage_km,created_by_user_id)
     VALUES($1,$2,'2026-01-15','maintenance','更換機油及機油隔','MOP 980',12000,$3)`,
    [`h-${suffix}`, vehicleId, userId],
  );
  await db.query(
    `INSERT INTO reminders(id,vehicle_id,kind,title,due_in,icon,status,created_by_user_id)
     VALUES($1,$2,'maintenance','機油保養即將到期','尚餘 1,360 km','oil','upcoming',$3)`,
    [`r-${suffix}`, vehicleId, userId],
  );

  try {
    await page.goto('/#/login');
    await page.locator('#loginEmail').fill(email);
    await page.locator('#loginPassword').fill(password);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/, { timeout: 15_000 });

    await page.goto('/#/garage');
    await expect(page).toHaveTitle(/車輛護照/);
    await expect(page.getByRole('heading', { name: '車輛護照' })).toBeVisible();
    const passport = page.getByRole('button', { name: /開啟 Toyota Corolla Cross 車輛護照/ });
    await expect(passport).toBeVisible();
    await passport.click();

    const reader = page.getByRole('dialog', { name: /Toyota Corolla Cross 車輛護照/ });
    await expect(reader).toBeVisible();
    await expect(reader).toContainText('18,640 km');
    await expect(reader).toContainText('MP-2026');
    await expect(reader).toContainText('保養基準資料完整');

    await reader.getByRole('button', { name: '下一頁' }).click();
    await expect(reader).toContainText('更換機油及機油隔');
    await expect(reader).toContainText('需要留意');

    await reader.getByRole('button', { name: '下一頁' }).click();
    await expect(reader).toContainText('機油保養即將到期');
    await expect(reader).toContainText('車商協作由你控制');

    await page.setViewportSize({ width: 390, height: 844 });
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('body *')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, className: element.className, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
      }).filter((item) => item.right > document.documentElement.clientWidth + 1 || item.left < -1).slice(0, 8),
    }));
    expect(dimensions.content, JSON.stringify(dimensions.offenders)).toBeLessThanOrEqual(dimensions.viewport);
    await page.keyboard.press('Escape');
    await expect(reader).toBeHidden();
  } finally {
    await db.query('DELETE FROM vehicles WHERE id=$1', [vehicleId]);
    await db.query('DELETE FROM audit_log WHERE actor_email=$1', [email]);
    await db.query('DELETE FROM users WHERE id=$1', [userId]);
    await closeDb();
  }
});

test('empty passport persists unknown maintenance scope and supports manual edits', async ({ page }) => {
  test.setTimeout(45_000);
  const suffix = randomUUID();
  const userId = `u-passport-empty-${suffix}`;
  const vehicleId = `v-passport-empty-${suffix}`;
  const email = `passport-empty-${suffix}@example.test`;
  const password = 'Passport-e2e-only-2026!';
  const db = await getDb();
  await db.query(`INSERT INTO users(id,email,password_hash,role,display_name) VALUES($1,$2,$3,'user','Empty Passport E2E')`, [userId, email, await hashPassword(password)]);
  await db.query(
    `INSERT INTO vehicles (id,model,make,year,fuel_type,vehicle_class,powertrain_type,onboarding_state,plate,mileage_km,mileage_label,image,owner,team,created_by_user_id,updated_by_user_id)
     VALUES($1,'Fit','Honda',2022,'燃油','light_passenger','fuel','identity_confirmed',NULL,5200,'5,200 km','/assets/vehicle-placeholder.svg','Empty Passport E2E','personal',$2,$2)`,
    [vehicleId, userId],
  );
  try {
    await page.goto('/#/login');
    await page.locator('#loginEmail').fill(email);
    await page.locator('#loginPassword').fill(password);
    await page.getByRole('button', { name: '登入', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/, { timeout: 15_000 });
    await page.goto('/#/garage');
    await page.getByRole('button', { name: /開啟 Honda Fit 車輛護照/ }).click();
    const reader = page.getByRole('dialog', { name: /Honda Fit 車輛護照/ });
    await expect(reader).toBeVisible();
    await expect(reader.getByRole('button', { name: '修改護照' })).toBeVisible();
    await reader.getByRole('button', { name: '下一頁' }).click();
    await expect(reader.getByText('狀態未知').first()).toBeVisible();
    const persisted = await db.query('SELECT item, source FROM vehicle_status WHERE vehicle_id=$1', [vehicleId]);
    expect(persisted.rowCount).toBeGreaterThan(0);
    expect(persisted.rows.every((row) => row.item && row.source === 'template')).toBeTruthy();

    await reader.getByRole('button', { name: '上一頁' }).click();
    await reader.getByRole('button', { name: '修改護照' }).click();
    const editor = page.getByRole('dialog', { name: '修改車輛護照' });
    await expect(editor.getByText('辨識結果只作預填參考，儲存前請先核對。')).toBeVisible();
    await editor.locator('[name="plate"]').fill('AA-2026');
    await editor.locator('[name="mileage_km"]').fill('6789');
    await editor.getByRole('button', { name: '儲存護照' }).click();
    await expect(page.getByRole('dialog', { name: /Honda Fit 車輛護照/ })).toContainText('AA-2026');
    const updated = await db.query('SELECT plate,mileage_km,mileage_label FROM vehicles WHERE id=$1', [vehicleId]);
    expect(updated.rows[0]).toMatchObject({ plate: 'AA-2026', mileage_km: 6789, mileage_label: '6,789 km' });
  } finally {
    await db.query('DELETE FROM vehicles WHERE id=$1', [vehicleId]);
    await db.query('DELETE FROM audit_log WHERE actor_email=$1', [email]);
    await db.query('DELETE FROM users WHERE id=$1', [userId]);
    await closeDb();
  }
});
