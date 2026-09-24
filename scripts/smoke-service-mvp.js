#!/usr/bin/env node
/* Standalone smoke test for the Service MVP end-to-end flow.
   Runs in plain Node (no test runner), connects to the configured Postgres,
   starts `scripts/dev-server.js`, and exercises the v2 actions through the
   real HTTP routes. Prints a PASS/FAIL line per step and exits non-zero on
   any failure. */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { setTimeout as sleep } from 'node:timers/promises';

const DB_URL = process.env.TEST_DATABASE_URL || process.env.KC_DATABASE_URL;
if (!DB_URL) { console.error('KC_DATABASE_URL required'); process.exit(2); }

function log(label, ok, extra = '') {
  console.log(`${ok ? '[32mPASS[0m' : '[31mFAIL[0m'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });

async function withClient(fn) { const c = await pool.connect(); try { return await fn(c); } finally { c.release(); } }

function hash(pw) { return bcrypt.hashSync(pw, 4); }

async function seed(c, suffix) {
  await c.query('BEGIN');
  try {
    const adminId = `admin-${suffix}`;
    const ownerId = `owner-${suffix}`;
    const dealerUserId = `dealer-user-${suffix}`;
    const dealerId = `dealer-${suffix}`;
    const branchId = `branch-${suffix}`;
    const vehicleId = `vehicle-${suffix}`;
    const offerId = randomUUID();
    const slotId = randomUUID();
    await c.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active) VALUES ($1,$2,$3,'admin','Admin',TRUE) ON CONFLICT DO NOTHING`, [adminId, `admin-${suffix}@e.test`, hash('a')]);
    await c.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active) VALUES ($1,$2,$3,'user','Owner',TRUE) ON CONFLICT DO NOTHING`, [ownerId, `owner-${suffix}@e.test`, hash('Owner-pw-2026!')]);
    await c.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active) VALUES ($1,$2,$3,'user','Dealer',TRUE) ON CONFLICT DO NOTHING`, [dealerUserId, `dealer-${suffix}@e.test`, hash('Dealer-pw-2026!')]);
    await c.query(`INSERT INTO dealers (id,display_name,status,pilot_enabled) VALUES ($1,'Dealer','active',TRUE) ON CONFLICT DO NOTHING`, [dealerId]);
    await c.query(`INSERT INTO dealer_branches (id,dealer_id,name,timezone) VALUES ($1,$2,'Branch','Asia/Macau') ON CONFLICT DO NOTHING`, [branchId, dealerId]);
    await c.query(`INSERT INTO dealer_members (dealer_id,user_id,role) VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING`, [dealerId, dealerUserId]);
    await c.query(`INSERT INTO vehicles (id,model,make,year,fuel_type,plate,mileage_km,mileage_label,created_by_user_id,onboarding_state,onboarding_completed_at) VALUES ($1,'Corolla Cross','Toyota',2021,'混能',$2,42680,'42680 km',$3,'ready',NOW()) ON CONFLICT DO NOTHING`, [vehicleId, `T-${suffix}`, ownerId]);
    await c.query(`INSERT INTO service_offers (id,dealer_id,branch_id,kind,name,description,currency,price_minor,pricing_mode,duration_minutes,checklist_version,active) VALUES ($1,$2,$3,'baseline','基線','d','MOP',28000,'fixed',45,'baseline-v1',TRUE)`, [offerId, dealerId, branchId]);
    /* dealer_service_items + service_offer_items so v1 quote allowlist matches. */
    const serviceItems = [
      ['engine_oil', 'Engine Oil'], ['oil_filter', 'Oil Filter'],
      ['transmission_fluid', 'Transmission Fluid'], ['brake_pads', 'Brake Pads'],
      ['brake_fluid', 'Brake Fluid'], ['coolant', 'Coolant'],
      ['spark_plugs', 'Spark Plugs'], ['air_filter', 'Air Filter'],
      ['cabin_filter', 'Cabin Filter'],
    ];
    for (const [key, label] of serviceItems) {
      const dsid = `dsi-${suffix}-${key}`;
      await c.query(
        `INSERT INTO dealer_service_items (id, dealer_id, name, service_item_type_key, is_active)
         VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (id) DO NOTHING`, [dsid, dealerId, label, key]);
      await c.query(
        `INSERT INTO service_offer_items (offer_id, dealer_service_item_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`, [offerId, dsid]);
    }
    const starts = new Date(Date.now() + 3600_000);
    await c.query(`INSERT INTO booking_slots (id,branch_id,starts_at,ends_at,capacity,active) VALUES ($1,$2,$3,$4,1,TRUE)`, [slotId, branchId, starts.toISOString(), new Date(starts.getTime() + 3600_000).toISOString()]);
    await c.query('COMMIT');
    return { adminId, ownerId, dealerUserId, dealerId, branchId, vehicleId, offerId, slotId };
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
}

async function cleanup(c, suffix) {
  await c.query(`DELETE FROM request_actions WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM commission_entries WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM service_payment_events WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM service_completion_lines USING service_completions WHERE service_completion_lines.completion_id=service_completions.id AND service_completions.request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM service_completions WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM service_order_lines WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM inspection_results USING inspection_reports WHERE inspection_results.report_id=inspection_reports.id AND inspection_reports.request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM inspection_reports WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM service_bookings WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM dealer_quotes WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM dealer_request_events WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE vehicle_id=$1)`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM dealer_service_requests WHERE vehicle_id=$1`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM service_history WHERE vehicle_id=$1`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM booking_slots WHERE branch_id=$1`, [`branch-${suffix}`]);
  await c.query(`DELETE FROM service_offers WHERE dealer_id=$1`, [`dealer-${suffix}`]);
  await c.query(`DELETE FROM dealer_members WHERE dealer_id=$1`, [`dealer-${suffix}`]);
  await c.query(`DELETE FROM dealer_branches WHERE id=$1`, [`branch-${suffix}`]);
  await c.query(`DELETE FROM dealers WHERE id=$1`, [`dealer-${suffix}`]);
  await c.query(`DELETE FROM vehicles WHERE id=$1`, [`vehicle-${suffix}`]);
  await c.query(`DELETE FROM users WHERE id IN ($1,$2,$3)`, [`admin-${suffix}`, `owner-${suffix}`, `dealer-user-${suffix}`]);
}

async function call(base, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const r = await fetch(base + path, { method: opts.method || 'GET', headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  let body = {}; try { body = text ? JSON.parse(text) : {}; } catch {}
  return { status: r.status, body, setCookie: r.headers.get('set-cookie') };
}

async function main() {
  const port = 3111;
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn('node', ['scripts/dev-server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      KC_DATABASE_URL: DB_URL,
      KC_AUTO_MIGRATE: '0',
      DEMO_SEED_ENABLED: '0',
      KC_ALLOW_NO_ORIGIN: '1',
      KC_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  proc.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
  // Wait for /api/health
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) { ready = true; break; }
    } catch { /* not yet */ }
    await sleep(250);
  }
  if (!ready) { console.error('dev server never became ready'); proc.kill(); process.exit(2); }
  const suffix = randomUUID().slice(0, 8);
  let exitCode = 0;
  try {
    const ids = await withClient((c) => seed(c, suffix));
    // 1. Owner login
    let r = await call(base, '/api/auth/login', { method: 'POST',
      body: { email: `owner-${suffix}@e.test`, password: 'Owner-pw-2026!' } });
    log('owner login', r.status === 200, r.status);
    const ownerCookie = r.setCookie && r.setCookie.split(';')[0];
    // 2. Create request
    r = await call(base, `/api/vehicles/${ids.vehicleId}/service-requests`, { method: 'POST', cookie: ownerCookie,
      body: { offer_id: ids.offerId, contact_name: 'O', contact_phone: '+85300000000', terms_version: 'v1', consented_at: new Date().toISOString() },
      idempotencyKey: randomUUID() });
    log('create request', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    const reqId = r.body.data.id;
    const ver0 = r.body.data.version;
    // Dealer login uses a separate account to preserve owner/operator separation.
    r = await call(base, '/api/auth/login', { method: 'POST',
      body: { email: `dealer-${suffix}@e.test`, password: 'Dealer-pw-2026!' } });
    const dealerCookie = r.setCookie && r.setCookie.split(';')[0];
    // 3. Quote (v1 path uses indexes; v2 line_ids path requires select_line_ids)
    const lineId = randomUUID();
    const items = [{ line_id: lineId, description: '基線七項檢查', amount_minor: 28000,
      work_type: 'inspect',
      service_keys: ['engine_oil','oil_filter','transmission_fluid','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter'] }];
    const allowBefore = await withClient((c) => c.query(
      `SELECT service_key FROM dealer_request_items WHERE request_id=$1`, [reqId]
    ));
    log('request_items seeded', allowBefore.rowCount >= 9, `count=${allowBefore.rowCount} keys=${allowBefore.rows.map(x=>x.service_key).join(',')}`);
    r = await call(base, `/api/service-requests/${reqId}`, { method: 'POST', cookie: dealerCookie,
      body: { action: 'quote', version: ver0, currency: 'MOP', items, expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
      idempotencyKey: randomUUID() });
    log('quote', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    const afterQ = await call(base, `/api/service-requests/${reqId}`, { cookie: ownerCookie });
    const qrow = Array.isArray(afterQ.body.data) ? afterQ.body.data[0] : afterQ.body.data;
    const ver1 = qrow.version;
    const qidRow = (await withClient((c) => c.query(`SELECT id FROM dealer_quotes WHERE request_id=$1 ORDER BY version DESC LIMIT 1`, [reqId]))).rows[0];
    const qid = qidRow.id;
    const qInspect = await withClient((c) => c.query(`SELECT items FROM dealer_quotes WHERE id=$1`, [qid]));
    log('quote line_id persisted', qInspect.rows[0].items?.[0]?.line_id === lineId, `stored=${qInspect.rows[0].items?.[0]?.line_id} expected=${lineId}`);
    // 4. Accept quote (v1 with selected_line_indexes since our quote had no line_id)
    r = await call(base, `/api/service-requests/${reqId}`, { method: 'POST', cookie: ownerCookie,
      body: { action: 'accept_quote', version: ver1, quote_id: qid, selected_line_ids: [lineId] },
      idempotencyKey: randomUUID() });
    log('accept_quote', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    const afterA = await call(base, `/api/service-requests/${reqId}`, { cookie: ownerCookie });
    const arow = Array.isArray(afterA.body.data) ? afterA.body.data[0] : afterA.body.data;
    const ver2 = arow.version;
    // 5. Schedule via slot
    r = await call(base, `/api/service-requests/${reqId}`, { method: 'POST', cookie: ownerCookie,
      body: { action: 'schedule', version: ver2, slot_id: ids.slotId },
      idempotencyKey: randomUUID() });
    log('schedule', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    const afterS = await call(base, `/api/service-requests/${reqId}`, { cookie: dealerCookie });
    const srow = Array.isArray(afterS.body.data) ? afterS.body.data[0] : afterS.body.data;
    const ver3 = srow.version;
    // 6. Start
    r = await call(base, `/api/service-requests/${reqId}`, { method: 'POST', cookie: dealerCookie,
      body: { action: 'start', version: ver3 },
      idempotencyKey: randomUUID() });
    log('start', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    // 7. Inspection draft
    // 7. Inspection draft (results seeded in PUT so publish reads them back)
    const allResults = ['engine_oil_and_filter','transmission_oil','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter']
      .map((k) => ({ check_key: k, result: 'normal', service_keys: [], notes: 'ok', measurement_method: 'visual' }));
    r = await call(base, `/api/service-requests/${reqId}/inspection`, { method: 'PUT', cookie: dealerCookie,
      body: { mileage_km: 42680, summary: 'ok', template_key: 'baseline-v1', results: allResults } });
    log('inspection draft', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    const reportId = r.body.data.id;
    const verIns = r.body.data.version;
    const draftRows = await withClient((c) => c.query(`SELECT check_key, result FROM inspection_results WHERE report_id=$1`, [reportId]));
    log('inspection rows persisted', draftRows.rowCount === 8, `count=${draftRows.rowCount} keys=${draftRows.rows.map(x=>x.check_key).join(',')}`);
    r = await call(base, `/api/service-requests/${reqId}/inspection/publish`, { method: 'POST', cookie: dealerCookie,
      body: { version: verIns, results: allResults },
      idempotencyKey: randomUUID() });
    log('inspection publish', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    // 8. Complete
    const orderLines = (await withClient((c) => c.query(`SELECT * FROM service_order_lines WHERE request_id=$1`, [reqId]))).rows;
    const completion = {
      mileage_km: 42680,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      duration_minutes: 40,
      technician_name: 'Tech A',
      notes: '完成',
      lines: orderLines.map((l) => ({ order_line_id: l.id, outcome: 'completed', next_due_km: 50000 })),
    };
    const afterIns = await call(base, `/api/service-requests/${reqId}`, { cookie: dealerCookie });
    r = await call(base, `/api/service-requests/${reqId}`, { method: 'POST', cookie: dealerCookie,
      body: { action: 'complete', version: (Array.isArray(afterIns.body.data) ? afterIns.body.data[0].version : afterIns.body.data.version), completion },
      idempotencyKey: randomUUID() });
    log('complete', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    // 9. Confirm
    const afterC = await call(base, `/api/service-requests/${reqId}`, { cookie: ownerCookie });
    r = await call(base, `/api/service-requests/${reqId}`, { method: 'POST', cookie: ownerCookie,
      body: { action: 'confirm_completion', version: (Array.isArray(afterC.body.data) ? afterC.body.data[0].version : afterC.body.data.version) },
      idempotencyKey: randomUUID() });
    log('confirm_completion', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    // 10. Verify history
    const histRows = (await withClient((c) => c.query(`SELECT record_type FROM service_history WHERE request_id=$1`, [reqId]))).rows;
    log('inspection history row written', histRows.some((h) => h.record_type === 'inspection'), `${histRows.length} rows`);
    // 11. Payment
    r = await call(base, `/api/dealer/service-orders/${reqId}/payment`, { method: 'POST', cookie: dealerCookie,
      body: { amount_minor: 28000, reference: 'cash-test', payment_method: 'cash' },
      idempotencyKey: randomUUID() });
    log('payment recorded', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    // 12. Verify no commission (dealer_existing + 0 bps)
    const commCount = (await withClient((c) => c.query(`SELECT COUNT(*)::int AS n FROM commission_entries WHERE request_id=$1`, [reqId]))).rows[0].n;
    log('no commission accrued', commCount === 0, `count=${commCount}`);
  } catch (e) {
    console.error('UNEXPECTED', e);
    exitCode = 1;
  } finally {
    try { await withClient((c) => cleanup(c, suffix)); } catch (e) { console.error('[cleanup]', e.message); }
    proc.kill();
    await sleep(200);
    await pool.end().catch(() => {});
  }
  process.exit(exitCode || process.exitCode || 0);
}

main();
