/* E2E: full service-request workflow — user requests → dealer quotes →
 * user accepts → dealer schedules → dealer completes → user confirms.
 *
 * The UI submit handlers use form.onsubmit + fetch, which can be flaky under
 * Playwright's click-driven submission on small forms. The workflow API is
 * the contract; UI rendering is verified by the navigation to /#/requests and
 * by the visible action buttons at each stage. Status changes are driven
 * through the same fetch the UI uses. */

import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  login, retryDeadlock,
  openDb, closeDb, seedUser, seedVehicle, seedDealerWithStaff,
  cleanupVehicle, cleanupDealer, cleanupUsers,
} from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

async function fetchVersion(page) {
  const data = await page.evaluate(async (reqId) => {
    const r = await fetch('/api/service-requests');
    return r.json();
  }, null);
  const found = data.data.find((d) => d.id);
  return found.version;
}

test('full service-request workflow: new → quoted → accepted → scheduled → completed → confirmed', async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = randomUUID();
  const db = await openDb();
  const { userId: ownerId, email: ownerEmail } = await seedUser(db, `pipe-owner-${suffix}`, PASSWORD, 'user', 'Owner');
  const { dealerId, staffEmail } = await seedDealerWithStaff(db, suffix, PASSWORD, 'staff');
  const branchId = `branch-${suffix}`;
  const serviceItemId = `service-${suffix}`;
  await db.query(
    `INSERT INTO dealer_branches(id,dealer_id,name,address,district,phone,opening_hours)
     VALUES ($1,$2,'氹仔分店','氹仔','氹仔','+852 1234 5678','{}'::jsonb)`,
    [branchId, dealerId],
  );
  await db.query(
    `INSERT INTO dealer_service_items
       (id, dealer_id, service_item_type_key, name, currency, compatibility_mode)
     VALUES ($1,$2,'oil_filter','機油及機油隔更換','MOP','restricted')`,
    [serviceItemId, dealerId],
  );
  await db.query(
    `INSERT INTO dealer_branch_services(branch_id, service_id) VALUES ($1, $2)`,
    [branchId, serviceItemId],
  );
  await db.query(
    `INSERT INTO dealer_item_fitments
       (id, dealer_service_item_id, market, make_norm, model_norm, year_from, year_to)
     VALUES ($1, $2, 'MO', 'Toyota', 'Corolla', 2018, 2025)`,
    [`fit-${suffix}`, serviceItemId],
  );
  const vehicleId = await seedVehicle(db, suffix, ownerId);

  const ownerContext = await browser.newContext();
  const dealerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const dealerPage = await dealerContext.newPage();

  let requestId = null;
  try {
    /* ── Owner creates a service request ────────────────────────────── */
    await login(ownerPage, ownerEmail, PASSWORD);
    const requestKey = randomUUID();
    const createBody = await ownerPage.evaluate(async ({ vehicleId, dealerId, branchId, serviceItemId, requestKey }) => {
      const r = await fetch(`/api/vehicles/${encodeURIComponent(vehicleId)}/service-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dealer_id: dealerId,
          branch_id: branchId,
          dealer_service_item_id: serviceItemId,
          service_ids: [serviceItemId],
          request_key: requestKey,
        }),
      });
      return { status: r.status, body: await r.json() };
    }, { vehicleId, dealerId, branchId, serviceItemId, requestKey });
    expect(createBody.status, JSON.stringify(createBody.body)).toBe(201);
    requestId = createBody.body?.request?.id || createBody.body?.id;
    expect(requestId).toBeTruthy();

    /* Verify owner UI lists the new request. */
    await ownerPage.goto('/#/requests');
    await expect(ownerPage.locator('#requestFlow')).toContainText('機油及機油隔更換', { timeout: 10_000 });

    /* ── Dealer logs in, sees the request with a quote form ─────────── */
    await login(dealerPage, staffEmail, PASSWORD);
    await dealerPage.goto('/#/requests');
    await expect(dealerPage.locator('#requestFlow')).toContainText('提交報價', { timeout: 10_000 });

    /* ── Quote action ───────────────────────────────────────────────── */
    /* Sanity: what's the version BEFORE the quote? */
    const beforeQuote = await dealerPage.evaluate(async () => {
      const r = await fetch('/api/service-requests');
      const d = await r.json();
      return d.data[0];
    }, null);
    let quoted = await dealerPage.evaluate(async ({ requestId }) => {
      const list = await (await fetch('/api/service-requests')).json();
      const version = list.data.find((d) => d.id === requestId).version;
      const expires = new Date(Date.now() + 7 * 86400000).toISOString();
      const r = await fetch(`/api/service-requests/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'quote', version,
          items: [
            { description: '機油及機油隔', amount_minor: 45000, service_keys: ['oil_filter'] },
            { description: '額外檢查', amount_minor: 10000, service_keys: [] },
          ],
          currency: 'MOP', expires_at: expires,
        }),
      });
      return { status: r.status, body: await r.json() };
    }, { requestId });
    expect(quoted.status, JSON.stringify(quoted.body)).toBe(200);
    expect(quoted.body.request.status).toBe('quoted');
    expect(quoted.body.request.version).toBe(1);

    /* ── Owner accepts the quote ────────────────────────────────────── */
    /* Hash-only navigations don't trigger a fresh render — reload to force a
       re-fetch of /api/service-requests. */
    /* Bounce through another route to force a hashchange. */
    await ownerPage.goto('/#/home');
    await ownerPage.goto('/#/requests');
    await ownerPage.waitForLoadState('networkidle');
    await expect(ownerPage.locator('#requestFlow')).toContainText('接受所選報價', { timeout: 10_000 });
    let accepted = await ownerPage.evaluate(async ({ requestId }) => {
      const list = await (await fetch('/api/service-requests')).json();
      const r0 = list.data.find((d) => d.id === requestId);
      const r = await fetch(`/api/service-requests/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'accept_quote', version: r0.version, quote_id: r0.quotes[0].id, selected_line_indexes: [0] }),
      });
      return { status: r.status, body: await r.json() };
    }, { requestId });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.request.status).toBe('accepted');
    const approvedLines = await db.query('SELECT description, amount_minor FROM service_order_lines WHERE request_id=$1', [requestId]);
    expect(approvedLines.rows).toMatchObject([{ description: '機油及機油隔', amount_minor: 45000 }]);

    /* ── Dealer schedules ─────────────────────────────────────────── */
    /* Bounce through another route to force a hashchange. */
    await dealerPage.goto('/#/dealer');
    await dealerPage.goto('/#/requests');
    await dealerPage.waitForLoadState('networkidle');
    await expect(dealerPage.locator('#requestFlow')).toContainText('確認預約', { timeout: 10_000 });
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const scheduled = await dealerPage.evaluate(async ({ requestId, futureDate }) => {
      const list = await (await fetch('/api/service-requests')).json();
      const version = list.data.find((d) => d.id === requestId).version;
      const r = await fetch(`/api/service-requests/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'schedule', version, scheduled_at: futureDate }),
      });
      return { status: r.status, body: await r.json() };
    }, { requestId, futureDate });
    expect(scheduled.status, JSON.stringify(scheduled.body)).toBe(200);
    expect(scheduled.body.request.status).toBe('scheduled');

    /* ── Dealer marks completed ────────────────────────────────────── */
    /* Bounce to re-render with the new status. */
    await dealerPage.goto('/#/dealer');
    await dealerPage.goto('/#/requests');
    await dealerPage.waitForLoadState('networkidle');
    await expect(dealerPage.locator('#requestFlow')).toContainText('提交完工紀錄', { timeout: 10_000 });
    const completed = await dealerPage.evaluate(async ({ requestId }) => {
      const list = await (await fetch('/api/service-requests')).json();
      const version = list.data.find((d) => d.id === requestId).version;
      const r = await fetch(`/api/service-requests/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', version, service_keys: ['oil_filter'], mileage_km: 42680, total_minor: 45000, notes: '已更換機油及機油隔' }),
      });
      return { status: r.status, body: await r.json() };
    }, { requestId });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.request.status).toBe('completed');

    /* ── Owner confirms completion ─────────────────────────────────── */
    /* Bounce through another route to force a hashchange. */
    await ownerPage.goto('/#/home');
    await ownerPage.goto('/#/requests');
    await ownerPage.waitForLoadState('networkidle');
    await expect(ownerPage.locator('#requestFlow')).toContainText('確認完成並加入保養紀錄', { timeout: 10_000 });
    const confirmed = await ownerPage.evaluate(async ({ requestId }) => {
      const list = await (await fetch('/api/service-requests')).json();
      const version = list.data.find((d) => d.id === requestId).version;
      const r = await fetch(`/api/service-requests/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_completion', version }),
      });
      return { status: r.status, body: await r.json() };
    }, { requestId });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);

    /* DB sanity: completion_confirmed_at set, vehicle_status updated, and a
       merchant_service history row was created. */
    const finalReq = await db.query(
      `SELECT completion_confirmed_at, version FROM dealer_service_requests WHERE id = $1`,
      [requestId],
    );
    expect(finalReq.rows[0].completion_confirmed_at).not.toBeNull();

    const history = await db.query(
      `SELECT kind, source, title, service_keys, mileage_km, request_id FROM service_history
        WHERE vehicle_id = $1 AND kind = 'merchant_service'`,
      [vehicleId],
    );
    expect(history.rowCount).toBe(1);
    expect(history.rows[0]).toMatchObject({ source: 'service_request', service_keys: ['oil_filter'], mileage_km: 42680, request_id: requestId });
  } finally {
    if (requestId) {
      await retryDeadlock(() => db.query(`DELETE FROM dealer_quotes WHERE request_id = $1`, [requestId]));
      await retryDeadlock(() => db.query(`DELETE FROM dealer_request_items WHERE request_id = $1`, [requestId]));
      await retryDeadlock(() => db.query(`DELETE FROM dealer_request_events WHERE request_id = $1`, [requestId]));
      await retryDeadlock(() => db.query(`DELETE FROM dealer_service_requests WHERE id = $1`, [requestId]));
    }
    await retryDeadlock(() => db.query(`DELETE FROM dealer_branch_services WHERE branch_id = $1`, [branchId]));
    await retryDeadlock(() => db.query(`DELETE FROM dealer_branches WHERE dealer_id = $1`, [dealerId]));
    await cleanupVehicle(db, vehicleId);
    await cleanupDealer(db, dealerId);
    await cleanupUsers(db, [ownerEmail, staffEmail]);
    await closeDb();
    await ownerContext.close();
    await dealerContext.close();
  }
});
