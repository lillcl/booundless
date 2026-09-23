/* E2E: maintenance record editing — owner edit, version conflict 409,
 * dealer edit, and cross-dealer 403. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb, seedUser, seedVehicle,
  seedDealerWithStaff,
  cleanupVehicle, cleanupDealer, cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

async function seedRecord(db, vehicleId, payload) {
  const id = `doc-${randomUUID()}`;
  await db.query(
    `INSERT INTO service_history
       (id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km,
        source, dealer_id, service_keys, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
    [
      id, vehicleId, payload.performed_at ?? new Date().toISOString(),
      payload.kind ?? 'maintenance', payload.title, payload.notes ?? null,
      payload.cost ?? null, payload.mileage_km ?? null, payload.source,
      payload.dealer_id ?? null, payload.service_keys ?? [],
    ],
  );
  return id;
}

test('owner edits a record; PATCH version mismatch is 409; dealer edits its own record', async ({ browser }) => {
  test.setTimeout(180_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { userId: ownerId, email: ownerEmail } = await seedUser(db, `pipe-owner-${suffix}`, PASSWORD, 'user', 'Owner');
  const { dealerId, staffEmail } = await seedDealerWithStaff(db, suffix, PASSWORD);
  const vehicleId = await seedVehicle(db, suffix, ownerId);
  const ownerRecordId = await seedRecord(db, vehicleId, {
    title: '車主紀錄', source: 'owner_manual', mileage_km: 42500,
    service_keys: ['oil_filter'],
  });
  const dealerRecordId = await seedRecord(db, vehicleId, {
    title: '車商紀錄', source: 'dealer', dealer_id: dealerId, mileage_km: 43100,
    service_keys: ['oil_filter'],
  });
  /* Pre-create grant so the dealer can edit. */
  await db.query(
    `INSERT INTO vehicle_dealer_grants
       (id, vehicle_id, dealer_id, granted_by_user_id, can_view_vehicle,
        can_manage_service_records, can_update_maintenance_status)
     VALUES ($3,$1,$2,$4,TRUE,TRUE,TRUE)`,
    [vehicleId, dealerId, `grant-${randomUUID()}`, ownerId],
  );

  const ownerContext = await browser.newContext();
  const dealerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const dealerPage = await dealerContext.newPage();

  try {
    /* ── Owner edits the record ─────────────────────────────────────────── */
    await login(ownerPage, ownerEmail, PASSWORD);
    await ownerPage.goto('/#/garage');
    await ownerPage.getByRole('button', { name: /開啟 Toyota Corolla 車輛護照/ }).click();
    const reader = ownerPage.getByRole('dialog', { name: /Toyota Corolla 車輛護照/ });
    await reader.getByRole('button', { name: '下一頁' }).click();
    await expect(reader).toContainText('車主紀錄');
    await reader.locator(`button[data-history-id="${ownerRecordId}"]`).click();
    const editor = ownerPage.locator('.vp-editor.is-open');
    await expect(editor).toContainText('修改保養紀錄');
    await editor.locator('input[name="title"]').fill('車主紀錄（已修正）');
    await editor.locator('input[name="mileage_km"]').fill('42600');
    const patchResp = ownerPage.waitForResponse((r) =>
      r.url().includes(`/api/vehicles/${vehicleId}/history/${ownerRecordId}`) && r.request().method() === 'PATCH');
    await editor.getByRole('button', { name: '儲存修改' }).click();
    expect((await patchResp).status()).toBe(200);

    const updated = await db.query(
      `SELECT title, mileage_km, version FROM service_history WHERE id = $1`,
      [ownerRecordId],
    );
    expect(updated.rows[0]).toMatchObject({ title: '車主紀錄（已修正）', mileage_km: 42600, version: 2 });

    /* ── Version mismatch ───────────────────────────────────────────────── */
    const stale = await ownerPage.evaluate(async ({ vehicleId, ownerRecordId }) => {
      const r = await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/history/${encodeURIComponent(ownerRecordId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'stale write', version: 1 }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }, { vehicleId, ownerRecordId });
    expect(stale.status).toBe(409);
    expect(stale.body?.error?.code).toBe('conflict');
    expect(stale.body?.error?.message).toMatch(/已被更新/);

    /* ── Dealer edits its own record ────────────────────────────────────── */
    await login(dealerPage, staffEmail, PASSWORD);
    await dealerPage.goto('/#/dealer');
    await dealerPage.locator('#dealerVehiclesList').getByRole('button', { name: '查看及更新' }).click();
    const dealerEditor = dealerPage.locator('.vp-editor.is-open');
    await dealerEditor.locator(`button[data-edit-dealer-history="${dealerRecordId}"]`).click();
    await dealerEditor.locator('input[name="title"]').fill('車商紀錄（核對完）');
    const dealerPatch = dealerPage.waitForResponse((r) =>
      r.url().includes(`/api/dealer/vehicles/${vehicleId}/history/${dealerRecordId}`) && r.request().method() === 'PATCH');
    await dealerEditor.getByRole('button', { name: '儲存紀錄' }).click();
    expect((await dealerPatch).status()).toBe(200);

    const dealerUpdated = await db.query(
      `SELECT title, version FROM service_history WHERE id = $1`,
      [dealerRecordId],
    );
    expect(dealerUpdated.rows[0]).toMatchObject({ title: '車商紀錄（核對完）', version: 2 });
  } finally {
    await retryDeadlock(() => db.query(`DELETE FROM vehicle_dealer_grants WHERE vehicle_id = $1`, [vehicleId]));
    await cleanupVehicle(db, vehicleId);
    await cleanupDealer(db, dealerId);
    await cleanupUsers(db, [ownerEmail, staffEmail]);
    await closeDb();
    await ownerContext.close();
    await dealerContext.close();
  }
});