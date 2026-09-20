import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from '../../api/_lib/db.js';
import { hashPassword } from '../../api/_lib/auth.js';

async function login(page, email, password) {
  await page.goto('/#/login');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 15_000 });
}

async function retryDeadlock(operation) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (error?.code !== '40P01' || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}

test('owner records maintenance and grants one vehicle to a dealer with an exact access boundary', async ({ browser }) => {
  test.setTimeout(75_000);
  const suffix = randomUUID();
  const ownerId = `u-owner-${suffix}`;
  const staffId = `u-staff-${suffix}`;
  const vehicleId = `v-shared-${suffix}`;
  const privateVehicleId = `v-private-${suffix}`;
  const dealerId = `d-shared-${suffix}`;
  const ownerEmail = `owner-${suffix}@example.test`;
  const staffEmail = `staff-${suffix}@example.test`;
  const password = 'Vehicle-sharing-e2e-2026!';
  const db = await getDb();
  await db.query(`INSERT INTO users(id,email,password_hash,role,display_name) VALUES
    ($1,$2,$3,'user','Vehicle Owner'),($4,$5,$3,'user','Dealer Staff')`,
    [ownerId, ownerEmail, await hashPassword(password), staffId, staffEmail]);
  await db.query(`INSERT INTO dealers(id,display_name,legal_name,status,created_by_user_id)
    VALUES($1,'可信汽車服務','可信汽車服務有限公司','active',$2)`, [dealerId, ownerId]);
  await db.query(`INSERT INTO dealer_members(dealer_id,user_id,role) VALUES($1,$2,'staff')`, [dealerId, staffId]);
  for (const [id, model, plate] of [[vehicleId, 'Civic', 'AA-101'], [privateVehicleId, 'Jazz', 'BB-202']]) {
    await db.query(`INSERT INTO vehicles
      (id,model,make,year,fuel_type,onboarding_state,plate,mileage_km,mileage_label,image,owner,team,created_by_user_id,updated_by_user_id)
      VALUES($1,$2,'Honda',2023,'燃油','ready',$3,12000,'12,000 km','/assets/vehicle-placeholder.svg','Vehicle Owner','personal',$4,$4)`,
      [id, model, plate, ownerId]);
    await db.query(`INSERT INTO vehicle_status
      (vehicle_id,item,service_item_type_key,interval_km,interval_months,wear,display_order,source)
      VALUES($1,'機油及機油隔','oil_filter',10000,12,0,1,'template')`, [id]);
  }

  const ownerContext = await browser.newContext();
  const dealerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const dealerPage = await dealerContext.newPage();
  try {
    await login(ownerPage, ownerEmail, password);
    await ownerPage.goto('/#/garage');
    await ownerPage.getByRole('button', { name: /開啟 Honda Civic 車輛護照/ }).click();
    let reader = ownerPage.getByRole('dialog', { name: /Honda Civic 車輛護照/ });
    await reader.getByRole('button', { name: '下一頁' }).click();
    await reader.getByRole('button', { name: '＋ 手動新增保養紀錄' }).click();
    const editor = ownerPage.locator('.vp-editor.is-open');
    await editor.locator('[name="title"]').fill('車主更換機油');
    await editor.locator('[name="mileage_km"]').fill('12500');
    await editor.getByText('機油及機油隔', { exact: true }).click();
    await editor.getByRole('button', { name: '加入紀錄' }).click();
    reader = ownerPage.getByRole('dialog', { name: /Honda Civic 車輛護照/ });
    await reader.getByRole('button', { name: '下一頁' }).click();
    await expect(reader).toContainText('車主更換機油');

    let saved = await db.query(`SELECT id,source,service_keys,mileage_km FROM service_history WHERE vehicle_id=$1`, [vehicleId]);
    expect(saved.rows[0]).toMatchObject({ source: 'owner_manual', service_keys: ['oil_filter'], mileage_km: 12500 });
    let status = await db.query(`SELECT last_done_km,last_service_history_id FROM vehicle_status WHERE vehicle_id=$1`, [vehicleId]);
    expect(status.rows[0].last_done_km).toBe(12500);
    expect(status.rows[0].last_service_history_id).toBe(saved.rows[0]?.id);

    await reader.getByRole('button', { name: '下一頁' }).click();
    await reader.getByRole('button', { name: '管理車商權限' }).click();
    const access = ownerPage.locator('.vp-editor.is-open');
    await access.locator('select[name="dealer_id"]').selectOption(dealerId);
    await access.getByRole('button', { name: '授權車商' }).click();
    await expect(access).toContainText('可信汽車服務');

    await login(dealerPage, staffEmail, password);
    await dealerPage.goto('/#/dealer');
    const vehicleList = dealerPage.locator('#dealerVehiclesList');
    await expect(vehicleList).toContainText('Honda Civic');
    await expect(vehicleList).not.toContainText('Honda Jazz');
    await vehicleList.getByRole('button', { name: '查看及更新' }).click();
    const dealerEditor = dealerPage.locator('.vp-editor.is-open');
    await dealerEditor.locator('[name="title"]').fill('車商定期保養');
    await dealerEditor.locator('[name="mileage_km"]').fill('13000');
    await dealerEditor.locator('input[name="service_keys"][value="oil_filter"]').check();
    const dealerSave = dealerPage.waitForResponse((response) =>
      response.url().includes(`/api/dealer/vehicles/${vehicleId}/history`) && response.request().method() === 'POST');
    await dealerEditor.getByRole('button', { name: '儲存紀錄' }).click();
    const dealerSaveResponse = await dealerSave;
    expect(dealerSaveResponse.status(), await dealerSaveResponse.text()).toBe(201);
    await expect(dealerPage.locator('.vp-editor.is-open')).toBeVisible();
    saved = await db.query(`SELECT source,dealer_id,mileage_km FROM service_history WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT 1`, [vehicleId]);
    expect(saved.rows[0]).toMatchObject({ source: 'dealer', dealer_id: dealerId, mileage_km: 13000 });

    const refreshedDealerEditor = dealerPage.locator('.vp-editor.is-open');
    await refreshedDealerEditor.locator('[data-edit-dealer-history]').click();
    await refreshedDealerEditor.locator('[name="title"]').fill('車商定期保養（已核對）');
    const dealerUpdate = dealerPage.waitForResponse((response) =>
      response.url().includes(`/api/dealer/vehicles/${vehicleId}/history/`) && response.request().method() === 'PATCH');
    await refreshedDealerEditor.getByRole('button', { name: '儲存紀錄' }).click();
    expect((await dealerUpdate).status()).toBe(200);
    const changed = await db.query(`SELECT title,version FROM service_history WHERE vehicle_id=$1 AND dealer_id=$2`, [vehicleId, dealerId]);
    expect(changed.rows[0]).toMatchObject({ title: '車商定期保養（已核對）', version: 2 });

    const denied = await dealerPage.evaluate(async ({ id, dealerId }) => {
      const response = await fetch(`/api/dealer/vehicles/${encodeURIComponent(id)}?dealer_id=${encodeURIComponent(dealerId)}`);
      return response.status;
    }, { id: privateVehicleId, dealerId });
    expect(denied).toBe(404);

    const grant = (await db.query('SELECT id FROM vehicle_dealer_grants WHERE vehicle_id=$1 AND dealer_id=$2', [vehicleId, dealerId])).rows[0];
    const revoke = await ownerPage.evaluate(async ({ vehicleId, grantId }) => {
      const response = await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/dealer-access/${encodeURIComponent(grantId)}`, { method: 'DELETE' });
      return response.status;
    }, { vehicleId, grantId: grant.id });
    expect(revoke).toBe(200);
    const afterRevoke = await dealerPage.evaluate(async ({ vehicleId, dealerId }) => {
      const response = await fetch(`/api/dealer/vehicles/${encodeURIComponent(vehicleId)}?dealer_id=${encodeURIComponent(dealerId)}`);
      return response.status;
    }, { vehicleId, dealerId });
    expect(afterRevoke).toBe(404);
  } finally {
    await ownerContext.close(); await dealerContext.close();
    await retryDeadlock(() => db.query('DELETE FROM vehicles WHERE id=ANY($1::text[])', [[vehicleId, privateVehicleId]]));
    await retryDeadlock(() => db.query('DELETE FROM dealers WHERE id=$1', [dealerId]));
    await retryDeadlock(() => db.query('DELETE FROM audit_log WHERE actor_email=ANY($1::text[])', [[ownerEmail, staffEmail]]));
    await retryDeadlock(() => db.query('DELETE FROM users WHERE id=ANY($1::text[])', [[ownerId, staffId]]));
    await closeDb();
  }
});
