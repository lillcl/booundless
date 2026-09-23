/* End-to-end pipeline: signup → add car → record maintenance → refresh →
 * choose dealer → switch to dealer account → view maintenance status →
 * update as dealer → logout → log back in as user → verify dealer update is
 * synced → DB sanity check → cleanup.
 *
 * The dealer + dealer-staff user must exist before the user can grant
 * access — `/api/admin/dealers` requires admin role, and the dealer staff
 * needs to be a member of the dealer so the dealer portal recognises them.
 * We seed those rows directly in PostgreSQL to keep the pipeline focused on
 * the user-facing flow; everything else (signup, add car, add maintenance,
 * dealer access grant, dealer history, login as user, sync verification) is
 * driven through the real UI.
 */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, signup, logout, retryDeadlock,
  openDb, closeDb, seedDealerWithStaff, cleanupVehicle, cleanupDealer, cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test.describe('full pipeline: signup → car → maintenance → dealer sync → cleanup', () => {
  test.setTimeout(240_000);

  test('runs the complete user + dealer pipeline through the UI', async ({ browser }) => {
    const suffix = randomUUID();
    const userEmail = `pipeline-user-${suffix}@example.test`;
    const db = await openDb();

    /* Seed the dealer + staff user directly. The user account we'll create
       through the UI does not get pre-seeded. */
    const { dealerId, staffEmail, dealerDisplayName } = await seedDealerWithStaff(db, suffix, PASSWORD);

    const userContext = await browser.newContext();
    const dealerContext = await browser.newContext();
    const userPage = await userContext.newPage();
    const dealerPage = await dealerContext.newPage();
    const userConsoleErrors = [];
    userPage.on('pageerror', (error) => userConsoleErrors.push(`[user] ${error.message}`));
    dealerPage.on('pageerror', (error) => userConsoleErrors.push(`[dealer] ${error.message}`));

    let vehicleId = null;
    try {
      /* ── 1. Sign up as a new user ──────────────────────────────────────── */
      await signup(userPage, 'Pipeline User', userEmail, PASSWORD);
      const meResponse = await userPage.evaluate(async () => {
        const r = await fetch('/api/auth/me');
        return { status: r.status, body: r.ok ? await r.json() : null };
      });
      expect(meResponse.status).toBe(200);
      expect(meResponse.body?.user?.email).toBe(userEmail);

      /* ── 2. Add a car through the 4-step onboarding sheet ─────────────── */
      await userPage.goto('/#/garage');
      await expect(userPage.getByRole('heading', { name: '車輛護照', level: 1 })).toBeVisible();
      await userPage.locator('[data-add-passport]').first().click();
      /* Step 1: 車輛類別 — pick "輕型客車" */
      await userPage.locator('button[data-class="light_passenger"]').click();
      /* Step 2: 能源 — pick 燃油 */
      await userPage.locator('button[data-powertrain="fuel"]').click();
      /* Step 3: 品牌 — pick Toyota */
      await userPage.locator('button[data-brand="Toyota"]').click();
      /* Step 4a: capture — skip both photos, then continue. With no images
         the AI sequence is purely a series of ~360ms pauses (~3.6s total)
         before rendering the confirmation form. */
      await userPage.locator('#skipCar').click();
      await userPage.locator('#skipDash').click();
      await userPage.locator('#continueCaptureBtn').click();
      /* Step 4b: confirm — fill the AI-skipped fields manually. */
      await expect(userPage.locator('#newVehicleModel')).toBeVisible({ timeout: 15_000 });
      await userPage.locator('#newVehicleMake').fill('Toyota');
      await userPage.locator('#newVehicleModel').fill('Corolla');
      await userPage.locator('#newVehicleYear').fill('2021');
      await userPage.locator('#newVehicleMileage').fill('42000');
      await userPage.locator('#newVehiclePlate').fill('MX-12-34');
      const createResponse = userPage.waitForResponse((response) =>
        response.url().endsWith('/api/vehicles') && response.request().method() === 'POST');
      await userPage.getByRole('button', { name: '確認並建立車輛護照' }).click();
      const created = await createResponse;
      expect(created.status(), await created.text()).toBe(201);
      const createdBody = await created.json();
      vehicleId = createdBody.id;
      expect(vehicleId).toBeTruthy();

      /* The completion sheet pops after create; click "稍後再說，前往我的車" */
      await userPage.getByRole('button', { name: '稍後再說，前往我的車' }).click();
      await expect(userPage).toHaveURL(/#\/garage$/);

      const vehiclesResp = await db.query(
        `SELECT id, model, make, year, plate FROM vehicles
          WHERE id = $1 AND created_by_user_id = (SELECT id FROM users WHERE email = $2)`,
        [vehicleId, userEmail],
      );
      expect(vehiclesResp.rows[0]).toMatchObject({
        id: vehicleId,
        model: 'Corolla',
        make: 'Toyota',
        year: 2021,
        plate: 'MX-12-34',
      });

      /* ── 3. Modify car保養 — open the passport and add a maintenance record */
      await userPage
        .getByRole('button', { name: /開啟 Toyota Corolla 車輛護照/ })
        .click();
      const reader = userPage.getByRole('dialog', { name: /Toyota Corolla 車輛護照/ });
      await expect(reader).toBeVisible();
      /* spread 0: identity+overview, spread 1: maintenance+history */
      await reader.getByRole('button', { name: '下一頁' }).click();
      await reader.getByRole('button', { name: '＋ 手動新增保養紀錄' }).click();
      const ownerEditor = userPage.locator('.vp-editor.is-open');
      await expect(ownerEditor).toBeVisible();
      await ownerEditor.locator('input[name="title"]').fill('車主更換機油');
      await ownerEditor.locator('input[name="mileage_km"]').fill('42500');
      await ownerEditor.locator('input[name="service_keys"][value="oil_filter"]').check();
      const saveOwner = userPage.waitForResponse((response) =>
        response.url().includes(`/api/vehicles/${vehicleId}/history`) && response.request().method() === 'POST');
      await ownerEditor.getByRole('button', { name: '加入紀錄' }).click();
      expect((await saveOwner).status()).toBe(201);
      await expect(userPage.getByRole('dialog', { name: /Toyota Corolla 車輛護照/ })).toContainText('車主更換機油');

      const ownerSaved = await db.query(
        `SELECT title, source, mileage_km, service_keys FROM service_history
          WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [vehicleId],
      );
      expect(ownerSaved.rows[0]).toMatchObject({
        title: '車主更換機油',
        source: 'owner_manual',
        mileage_km: 42500,
        service_keys: ['oil_filter'],
      });

      /* ── 4. Refresh — the record must persist ──────────────────────────── */
      await userPage.reload();
      await expect(userPage).toHaveURL(/#\/garage$/);
      await userPage
        .getByRole('button', { name: /開啟 Toyota Corolla 車輛護照/ })
        .click();
      const reader2 = userPage.getByRole('dialog', { name: /Toyota Corolla 車輛護照/ });
      await reader2.getByRole('button', { name: '下一頁' }).click();
      await expect(reader2).toContainText('車主更換機油');

      /* ── 5. Choose dealer — grant access ─────────────────────────────── */
      await reader2.getByRole('button', { name: '下一頁' }).click();
      await reader2.getByRole('button', { name: '管理車商權限' }).click();
      const access = userPage.locator('.vp-editor.is-open');
      await expect(access).toBeVisible();
      await access.locator('select[name="dealer_id"]').selectOption(dealerId);
      await access.getByRole('button', { name: '授權車商' }).click();
      await expect(access).toContainText(dealerDisplayName);

      const grantRow = await db.query(
        `SELECT g.id, d.display_name FROM vehicle_dealer_grants g
           JOIN dealers d ON d.id = g.dealer_id
          WHERE g.vehicle_id = $1 AND g.dealer_id = $2 AND g.revoked_at IS NULL`,
        [vehicleId, dealerId],
      );
      expect(grantRow.rowCount).toBe(1);

      /* ── 6. Switch to the dealer staff account ───────────────────────── */
      await logout(userPage);
      await login(dealerPage, staffEmail, PASSWORD);

      /* ── 7. Dealer portal — view car maintenance status ──────────────── */
      await dealerPage.goto('/#/dealer');
      const dealerList = dealerPage.locator('#dealerVehiclesList');
      await expect(dealerList).toContainText('Toyota Corolla');
      await dealerList.getByRole('button', { name: '查看及更新' }).click();
      const dealerModal = dealerPage.locator('.vp-editor.is-open');
      await expect(dealerModal).toBeVisible();
      await expect(dealerModal).toContainText('保養狀態');
      await expect(dealerModal).toContainText('車主更換機油');
      await expect(dealerModal).toContainText('機油隔');

      /* ── 8. Update as dealer — add a maintenance record ──────────────── */
      await dealerModal.locator('input[name="title"]').fill('車商定期檢查');
      await dealerModal.locator('input[name="mileage_km"]').fill('43100');
      await dealerModal.locator('input[name="service_keys"][value="oil_filter"]').check();
      const dealerSave = dealerPage.waitForResponse((response) =>
        response.url().includes(`/api/dealer/vehicles/${vehicleId}/history`) && response.request().method() === 'POST');
      await dealerModal.getByRole('button', { name: '儲存紀錄' }).click();
      expect((await dealerSave).status()).toBe(201);
      /* The dealer save handler re-opens the vehicle modal so the list of
         records is refreshed in place — just verify the new title shows up
         without clicking 查看及更新 again. */
      await expect(dealerPage.locator('.vp-editor.is-open')).toContainText('車商定期檢查');

      const dealerSaved = await db.query(
        `SELECT title, source, dealer_id, mileage_km FROM service_history
          WHERE vehicle_id = $1 AND dealer_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [vehicleId, dealerId],
      );
      expect(dealerSaved.rows[0]).toMatchObject({
        title: '車商定期檢查',
        source: 'dealer',
        dealer_id: dealerId,
        mileage_km: 43100,
      });

      /* ── 9. Logout dealer ─────────────────────────────────────────────── */
      await logout(dealerPage);

      /* ── 10. Login as the user again ─────────────────────────────────── */
      await login(userPage, userEmail, PASSWORD);

      /* ── 11. Confirm the dealer's update is visible to the user ───────── */
      await userPage.goto('/#/garage');
      await userPage
        .getByRole('button', { name: /開啟 Toyota Corolla 車輛護照/ })
        .click();
      const userReader = userPage.getByRole('dialog', { name: /Toyota Corolla 車輛護照/ });
      await userReader.getByRole('button', { name: '下一頁' }).click();
      await expect(userReader).toContainText('車主更換機油');
      await expect(userReader).toContainText('車商定期檢查');

      /* DB sanity check: the vehicle has BOTH the owner and dealer records,
         plus the dealer grant is still active. */
      const finalHistory = await db.query(
        `SELECT title, source, dealer_id FROM service_history
          WHERE vehicle_id = $1 ORDER BY created_at ASC`,
        [vehicleId],
      );
      expect(finalHistory.rowCount).toBe(2);
      expect(finalHistory.rows.map((r) => r.title)).toEqual(['車主更換機油', '車商定期檢查']);
      expect(finalHistory.rows.map((r) => r.source).sort()).toEqual(['dealer', 'owner_manual']);

      const finalGrants = await db.query(
        `SELECT COUNT(*)::int AS n FROM vehicle_dealer_grants
          WHERE vehicle_id = $1 AND dealer_id = $2 AND revoked_at IS NULL`,
        [vehicleId, dealerId],
      );
      expect(finalGrants.rows[0].n).toBe(1);

      /* ── 12. Delete car — no UI affordance exists for owners, so we clean
         up directly. The expectation here is that the API does not expose a
         DELETE /api/vehicles/:id endpoint either (the dev-server returns
         404 because no route matches; the Vercel handler would return 405).
         Either way the owner cannot delete the vehicle through the API. */
      const deleteVehicleStatus = await userPage.evaluate(async ({ id }) => {
        const r = await fetch(`/api/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return r.status;
      }, { id: vehicleId });
      expect([404, 405]).toContain(deleteVehicleStatus);

      await retryDeadlock(() => db.query(`UPDATE vehicles SET archived_at = NOW() WHERE id = $1`, [vehicleId]));

      /* ── 13. Delete account — owners cannot delete themselves via the UI
         (the /api/users/:id DELETE requires admin role). Confirm and clean up. */
      const meId = meResponse.body.user.id;
      const deleteAccountStatus = await userPage.evaluate(async ({ id }) => {
        const r = await fetch(`/api/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
        return r.status;
      }, { id: meId });
      expect(deleteAccountStatus).toBe(403);

      await retryDeadlock(() => db.query(`UPDATE users SET is_active = FALSE WHERE email = $1`, [userEmail]));
    } finally {
      /* Cleanup — drop everything the pipeline created. The DB rows are
         intentionally kept here so a failing test leaves a traceable trail
         until cleanup runs. */
      await cleanupVehicle(db, vehicleId);
      await cleanupDealer(db, dealerId);
      await cleanupUsers(db, [userEmail, staffEmail]);
      await closeDb();
      await userContext.close();
      await dealerContext.close();
      if (userConsoleErrors.length) {
        console.warn('[pipeline] page errors observed:', userConsoleErrors);
      }
    }
  });
});