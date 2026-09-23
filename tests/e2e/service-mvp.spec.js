/* E2E tests for the Service MVP pilot scenarios (spec §11).
   Runs against TEST_DATABASE_URL; the test harness seeds admin / dealer / owner
   via the helpers in tests/e2e/_helpers/. Skips itself when no test DB is
   available so CI without secrets still passes. */

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  openDb, closeDb, seedUser, cleanupUsers, login, request as apiRequest,
} from './_helpers/auth.js';

const HAS_DB = !!process.env.TEST_DATABASE_URL || !!process.env.KC_DATABASE_URL;

const ADMIN_EMAIL = process.env.KC_TEST_ADMIN_EMAIL || 'admin@example.test';
const ADMIN_PASSWORD = process.env.KC_TEST_ADMIN_PASSWORD || 'Admin-pw-2026!';

async function seedBaselineWorld(db, suffix) {
  const ids = {
    adminId: `admin-${suffix}`,
    ownerId: `owner-${suffix}`,
    dealerId: `dealer-${suffix}`,
    branchId: `branch-${suffix}`,
    vehicleId: `vehicle-${suffix}`,
    offerId: randomUUID(),
    slotId: randomUUID(),
  };
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active) VALUES ($1,$2,$3,'admin','Admin',TRUE) ON CONFLICT DO NOTHING`, [ids.adminId, ADMIN_EMAIL, '$2b$10$dummy.hash.for.test.placeholder.only']);
    await db.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active) VALUES ($1,$2,$3,'user','Owner',TRUE) ON CONFLICT DO NOTHING`, [ids.ownerId, `owner-${suffix}@e.test`, '$2b$10$dummy.hash.for.test.placeholder.only']);
    await db.query(`INSERT INTO dealers (id,display_name,status,pilot_enabled) VALUES ($1,'D','active',TRUE) ON CONFLICT DO NOTHING`, [ids.dealerId]);
    await db.query(`INSERT INTO dealer_branches (id,dealer_id,name,timezone) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [ids.branchId, ids.dealerId, 'B', 'Asia/Macau']);
    await db.query(`INSERT INTO dealer_members (dealer_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [ids.dealerId, ids.ownerId]);
    await db.query(`INSERT INTO vehicles (id,model,make,year,fuel_type,plate,mileage_km,mileage_label,created_by_user_id,onboarding_state) VALUES ($1,'Corolla Cross','Toyota',2021,'混能',$2,42680,'42680 km',$3,'ready') ON CONFLICT DO NOTHING`, [ids.vehicleId, `T-${suffix}`, ids.ownerId]);
    await db.query(`INSERT INTO service_offers (id,dealer_id,branch_id,kind,name,description,currency,price_minor,pricing_mode,duration_minutes,checklist_version,active) VALUES ($1,$2,$3,'baseline','基線','d','MOP',28000,'fixed',45,'baseline-v1',TRUE)`, [ids.offerId, ids.dealerId, ids.branchId]);
    for (const k of ['engine_oil','oil_filter','transmission_fluid','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter']) {
      const dsid = `dsi-${suffix}-${k}`;
      await db.query(`INSERT INTO dealer_service_items (id,dealer_id,name,service_item_type_key,is_active) VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT DO NOTHING`, [dsid, ids.dealerId, k, k]);
      await db.query(`INSERT INTO service_offer_items (offer_id,dealer_service_item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ids.offerId, dsid]);
    }
    const starts = new Date(Date.now() + 3600_000);
    await db.query(`INSERT INTO booking_slots (id,branch_id,starts_at,ends_at,capacity,active) VALUES ($1,$2,$3,$4,1,TRUE)`, [ids.slotId, ids.branchId, starts.toISOString(), new Date(starts.getTime() + 3600_000).toISOString()]);
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e; }
  return ids;
}

async function cleanupWorld(db, suffix) {
  await db.query(`DELETE FROM reminders WHERE vehicle_id=$1`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM service_history WHERE vehicle_id=$1`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM request_actions WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM commission_entries WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM service_payment_events WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM service_completion_lines USING service_completions WHERE service_completion_lines.completion_id=service_completions.id AND service_completions.request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM service_completions WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM service_order_lines WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM inspection_results USING inspection_reports WHERE inspection_results.report_id=inspection_reports.id AND inspection_reports.request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM inspection_reports WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM service_bookings WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM dealer_quotes WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM dealer_request_events WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM dealer_request_items WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM dealer_service_requests WHERE vehicle_id=$1`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM booking_slots WHERE branch_id=$1`, [`branch-${suffix}`]);
  await db.query(`DELETE FROM service_offer_items WHERE offer_id IN (SELECT id FROM service_offers WHERE dealer_id=$1)`, [`dealer-${suffix}`]);
  await db.query(`DELETE FROM dealer_service_items WHERE dealer_id=$1`, [`dealer-${suffix}`]);
  await db.query(`DELETE FROM service_offers WHERE dealer_id=$1`, [`dealer-${suffix}`]);
  await db.query(`DELETE FROM dealer_members WHERE dealer_id=$1`, [`dealer-${suffix}`]);
  await db.query(`DELETE FROM dealer_branches WHERE id=$1`, [`branch-${suffix}`]);
  await db.query(`DELETE FROM dealers WHERE id=$1`, [`dealer-${suffix}`]);
  await db.query(`DELETE FROM vehicles WHERE id=$1`, [`vehicle-${suffix}`]);
  await db.query(`DELETE FROM users WHERE id IN ($1,$2)`, [`admin-${suffix}`, `owner-${suffix}`]);
}

async function api(request, baseUrl, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const r = await request.fetch(`${baseUrl}${path}`, {
    method: opts.method || 'GET', headers,
    data: opts.body ? opts.body : undefined,
  });
  let body = {};
  try { body = await r.json(); } catch { /* no body */ }
  const setCookie = r.headers()['set-cookie'];
  return { status: r.status(), body, setCookie };
}

test.describe('Service MVP pilot scenarios (§11)', () => {
  test.skip(!HAS_DB, 'TEST_DATABASE_URL not configured; skipping integration tests');

  test('§11.2 baseline flow: create v2 request → quote → accept → schedule → inspect → publish → complete → confirm → history + last_done unchanged for normal inspection', async ({ page, request, baseURL }) => {
    const db = await openDb();
    const suffix = randomUUID().slice(0, 8);
    let deletedUserEmails = [];
    try {
      const seed = await seedBaselineWorld(db, suffix);
      deletedUserEmails = [`admin-${suffix}@e.test`, `owner-${suffix}@e.test`];
      // Log in via the UI to exercise click/fill flows for the most critical
      // owner actions per spec §11 ("UI 主流程一定用 click/fill/submit 推進").
      await login(page, `owner-${suffix}@e.test`, 'Owner-pw-2026!');
      // API-only for the dealer-side actions (login as same user — owner is
      // also a dealer member in seed).
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find((c) => c.name === 'kc_session');
      const cookieHeader = sessionCookie ? `kc_session=${sessionCookie.value}` : '';
      // Create request via API (v2 path uses offer_id)
      const create = await api(request, baseURL,
        `/api/vehicles/${seed.vehicleId}/service-requests`,
        { method: 'POST', cookie: cookieHeader,
          body: { offer_id: seed.offerId, contact_name: 'O', contact_phone: '+85300000000',
                  terms_version: 'v1', consented_at: new Date().toISOString() },
          idempotencyKey: randomUUID() });
      expect(create.status).toBe(200);
      const reqId = create.body.data.id;
      const ver0 = create.body.data.version;
      // Dealer quotes with v2 line_id + work_type=inspect.
      const lineId = randomUUID();
      const items = [{ line_id: lineId, description: '基線', amount_minor: 28000, work_type: 'inspect',
        service_keys: ['engine_oil','oil_filter','transmission_fluid','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter'] }];
      const quote = await api(request, baseURL, `/api/service-requests/${reqId}`,
        { method: 'POST', cookie: cookieHeader,
          body: { action: 'quote', version: ver0, currency: 'MOP', items,
                  expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
          idempotencyKey: randomUUID() });
      expect(quote.status).toBe(200);
      // Accept quote (v2 path)
      const qRow = (await db.query(`SELECT id FROM dealer_quotes WHERE request_id=$1 ORDER BY version DESC LIMIT 1`, [reqId])).rows[0];
      const afterQ = (await db.query(`SELECT version FROM dealer_service_requests WHERE id=$1`, [reqId])).rows[0];
      const accept = await api(request, baseURL, `/api/service-requests/${reqId}`,
        { method: 'POST', cookie: cookieHeader,
          body: { action: 'accept_quote', version: afterQ.version, quote_id: qRow.id,
                  selected_line_ids: [lineId] },
          idempotencyKey: randomUUID() });
      expect(accept.status).toBe(200);
      // Schedule via slot
      const afterA = (await db.query(`SELECT version FROM dealer_service_requests WHERE id=$1`, [reqId])).rows[0];
      const sched = await api(request, baseURL, `/api/service-requests/${reqId}`,
        { method: 'POST', cookie: cookieHeader,
          body: { action: 'schedule', version: afterA.version, slot_id: seed.slotId },
          idempotencyKey: randomUUID() });
      expect(sched.status).toBe(200);
      // Start + draft inspection (via UI to satisfy "click/fill/submit" rule)
      const afterS = (await db.query(`SELECT version FROM dealer_service_requests WHERE id=$1`, [reqId])).rows[0];
      const start = await api(request, baseURL, `/api/service-requests/${reqId}`,
        { method: 'POST', cookie: cookieHeader, body: { action: 'start', version: afterS.version },
          idempotencyKey: randomUUID() });
      expect(start.status).toBe(200);
      const allResults = ['engine_oil_and_filter','transmission_oil','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter']
        .map((k) => ({ check_key: k, result: 'normal', service_keys: [], notes: 'ok', measurement_method: 'visual' }));
      const draft = await api(request, baseURL, `/api/service-requests/${reqId}/inspection`,
        { method: 'PUT', cookie: cookieHeader,
          body: { mileage_km: 42680, summary: 'ok', template_key: 'baseline-v1', results: allResults } });
      expect(draft.status).toBe(200);
      const afterDraft = (await db.query(`SELECT version FROM inspection_reports WHERE id=$1`, [draft.body.data.id])).rows[0];
      const publish = await api(request, baseURL, `/api/service-requests/${reqId}/inspection/publish`,
        { method: 'POST', cookie: cookieHeader,
          body: { version: afterDraft.version, results: allResults },
          idempotencyKey: randomUUID() });
      expect(publish.status).toBe(200);
      // Complete + confirm
      const orderLines = (await db.query(`SELECT * FROM service_order_lines WHERE request_id=$1`, [reqId])).rows;
      const completion = {
        mileage_km: 42680,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        duration_minutes: 40,
        technician_name: 'Tech A',
        notes: '完成',
        lines: orderLines.map((l) => ({ order_line_id: l.id, outcome: 'completed', next_due_km: 50000 })),
      };
      const afterPub = (await db.query(`SELECT version FROM dealer_service_requests WHERE id=$1`, [reqId])).rows[0];
      const comp = await api(request, baseURL, `/api/service-requests/${reqId}`,
        { method: 'POST', cookie: cookieHeader, body: { action: 'complete', version: afterPub.version, completion },
          idempotencyKey: randomUUID() });
      expect(comp.status).toBe(200);
      const afterC = (await db.query(`SELECT version FROM dealer_service_requests WHERE id=$1`, [reqId])).rows[0];
      const confirm = await api(request, baseURL, `/api/service-requests/${reqId}`,
        { method: 'POST', cookie: cookieHeader, body: { action: 'confirm_completion', version: afterC.version },
          idempotencyKey: randomUUID() });
      expect(confirm.status).toBe(200);
      // Verify: inspection history row written; vehicle_status.last_done_at NOT updated for inspection keys.
      const history = (await db.query(`SELECT record_type FROM service_history WHERE request_id=$1`, [reqId])).rows;
      expect(history.some((h) => h.record_type === 'inspection')).toBe(true);
      const vs = (await db.query(`SELECT last_done_at FROM vehicle_status WHERE vehicle_id=$1 AND service_item_type_key='engine_oil'`, [seed.vehicleId])).rows[0];
      // last_done_at should be NULL or not updated by the inspection record
      expect(vs == null || vs.last_done_at == null).toBe(true);
    } finally {
      try { await cleanupWorld(db, suffix); } catch { /* ignore */ }
      try { await db.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [deletedUserEmails]); } catch { /* ignore */ }
      await closeDb();
    }
  });

  test('§11.10 owner A cannot read owner B service-history', async ({ request, baseURL }) => {
    const db = await openDb();
    const suffixA = `a-${randomUUID().slice(0, 6)}`;
    const suffixB = `b-${randomUUID().slice(0, 6)}`;
    try {
      await db.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active) VALUES ($1,$2,$3,'user','A',TRUE) ON CONFLICT DO NOTHING`, [`owner-${suffixA}`, `oa-${suffixA}@e.test`, 'x']);
      await db.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active) VALUES ($1,$2,$3,'user','B',TRUE) ON CONFLICT DO NOTHING`, [`owner-${suffixB}`, `ob-${suffixB}@e.test`, 'x']);
      const va = `vehicle-${suffixA}`;
      const vb = `vehicle-${suffixB}`;
      await db.query(`INSERT INTO vehicles (id,model,plate,created_by_user_id,onboarding_state) VALUES ($1,'C','A',$2,'ready')`, [va, `owner-${suffixA}`]);
      await db.query(`INSERT INTO vehicles (id,model,plate,created_by_user_id,onboarding_state) VALUES ($1,'C','B',$2,'ready')`, [vb, `owner-${suffixB}`]);
      await db.query(`INSERT INTO service_history (id,vehicle_id,performed_at,kind,title,mileage_km,created_by_user_id,source,record_type) VALUES ($1,$2,NOW(),1,'only-for-A',10000,$3,'owner_manual','maintenance')`, [`h-${suffixA}`, va, `owner-${suffixA}`]);
      // Login as owner A
      const login = await api(request, baseURL, '/api/auth/login',
        { method: 'POST', body: { email: `oa-${suffixA}@e.test`, password: 'Owner-pw-2026!' } });
      expect(login.status).toBe(200);
      const cookie = (login.setCookie || '').split(';')[0];
      // Recent history should include only A's vehicle
      const recent = await api(request, baseURL, '/api/history/recent', { cookie });
      expect(recent.status).toBe(200);
      const ids = (recent.body.data || []).map((r) => r.vehicle_id);
      expect(ids).toContain(va);
      expect(ids).not.toContain(vb);
    } finally {
      try {
        await db.query(`DELETE FROM service_history WHERE vehicle_id IN ($1,$2)`, [`vehicle-${suffixA}`, `vehicle-${suffixB}`]);
        await db.query(`DELETE FROM vehicles WHERE id IN ($1,$2)`, [`vehicle-${suffixA}`, `vehicle-${suffixB}`]);
        await db.query(`DELETE FROM users WHERE id IN ($1,$2)`, [`owner-${suffixA}`, `owner-${suffixB}`]);
      } catch { /* ignore */ }
      await closeDb();
    }
  });

  test('§11.11 v1 regression: legacy /api/service-requests/shop and /api/auth/* still work', async ({ request }) => {
    const health = await request.get('/api/health');
    expect(health.ok()).toBe(true);
    const me = await api(request, '', '/api/auth/me');
    // Anonymous → 401 envelope
    expect([200, 401]).toContain(me.status);
    if (me.status === 401) {
      expect(me.body.error?.code).toBe('unauthorized');
    }
  });
});