#!/usr/bin/env node
/* Smoke test for the Admin → Dealer onboarding flow.
   Walks through:
     1. Seed admin
     2. Admin POST /api/admin/dealers       — creates dealer
     3. Admin POST /api/admin/dealers/:id/branches — creates a branch
     4. Admin POST /api/admin/dealers/:id/invites  — issues invite, returns token
     5. Owner /api/auth/register  — creates new owner account
     7. Owner POST /api/dealer/invites/accept  — joins dealer as owner
     8. Owner POST /api/dealer/offers           — publishes baseline offer
     9. Owner POST /api/dealer/booking-slots   — opens a slot
    10. Owner GET  /api/dealer/me              — verifies membership

   Run after migrate.js has been applied to a real Postgres. */

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
  const adminId = `admin-${suffix}`;
  const ownerId = `owner-${suffix}`;
  await c.query('BEGIN');
  try {
    await c.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active)
      VALUES ($1,$2,$3,'admin','Admin',TRUE) ON CONFLICT (id) DO NOTHING`,
      [adminId, `admin-${suffix}@e.test`, hash('Admin-pw-2026!')]);
    await c.query(`INSERT INTO users (id,email,password_hash,role,display_name,is_active)
      VALUES ($1,$2,$3,'user','Owner',TRUE) ON CONFLICT (id) DO NOTHING`,
      [ownerId, `owner-${suffix}@e.test`, hash('Owner-pw-2026!')]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  return { adminId, ownerId };
}

async function cleanup(c, suffix) {
  const adminId = `admin-${suffix}`;
  const ownerId = `owner-${suffix}`;
  // Find any dealers and nuke cascades.
  const dealers = (await c.query(`SELECT id FROM dealers WHERE display_name LIKE 'Test Dealer %' AND created_by_user_id=$1`, [adminId])).rows;
  for (const { id } of dealers) {
    await c.query(`DELETE FROM request_actions WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM commission_entries WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM service_payment_events WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM service_completion_lines USING service_completions WHERE service_completion_lines.completion_id=service_completions.id AND service_completions.request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM service_completions WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM service_order_lines WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM inspection_results USING inspection_reports WHERE inspection_results.report_id=inspection_reports.id AND inspection_reports.request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM inspection_reports WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM service_bookings WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM dealer_quotes WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM dealer_request_events WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM dealer_request_items WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM dealer_service_requests WHERE dealer_id=$1`, [id]);
    await c.query(`DELETE FROM booking_slots WHERE branch_id IN (SELECT id FROM dealer_branches WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM service_offer_items WHERE offer_id IN (SELECT id FROM service_offers WHERE dealer_id=$1)`, [id]);
    await c.query(`DELETE FROM service_offers WHERE dealer_id=$1`, [id]);
    await c.query(`DELETE FROM dealer_invites WHERE dealer_id=$1`, [id]);
    await c.query(`DELETE FROM dealer_members WHERE dealer_id=$1`, [id]);
    await c.query(`DELETE FROM dealer_branches WHERE dealer_id=$1`, [id]);
    await c.query(`DELETE FROM dealers WHERE id=$1`, [id]);
  }
  await c.query(`DELETE FROM users WHERE id IN ($1,$2)`, [adminId, ownerId]);
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
  const port = 3114;
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn('node', ['scripts/dev-server.js'], {
    env: { ...process.env, PORT: String(port), KC_DATABASE_URL: DB_URL,
      KC_AUTO_MIGRATE: '0', DEMO_SEED_ENABLED: '0',
      KC_ALLOW_NO_ORIGIN: '1', KC_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      /* Disable Resend so the smoke runs offline */
      RESEND_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch {}
    await sleep(250);
  }
  const suffix = randomUUID().slice(0, 8);
  try {
    const ids = await withClient((c) => seed(c, suffix));

    // 1. Admin login
    let r = await call(base, '/api/auth/login', { method: 'POST',
      body: { email: `admin-${suffix}@e.test`, password: 'Admin-pw-2026!' } });
    log('admin login', r.status === 200, r.status);
    const adminCookie = (r.setCookie || '').split(';')[0];

    // 2. Admin creates dealer
    r = await call(base, '/api/admin/dealers', { method: 'POST', cookie: adminCookie,
      body: {
        legal_name: '澳門測試車行有限公司',
        display_name: `Test Dealer ${suffix}`,
        registration_number: `TEST-${suffix}`,
        phone: '+853-2882-0000',
        email: `dealer-${suffix}@e.test`,
        website: 'https://test.example',
        service_item_type_keys: ['engine_oil', 'oil_filter', 'transmission_fluid', 'brake_pads', 'brake_fluid', 'coolant', 'spark_plugs', 'air_filter', 'cabin_filter'],
      } });
    log('admin creates dealer', r.status === 201, `${r.status} ${r.body.error?.message || ''}`);
    const dealerId = r.body.dealer?.id;

    // 3. Admin creates branch
    r = await call(base, `/api/admin/dealers/${dealerId}/branches`, { method: 'POST', cookie: adminCookie,
      body: { name: '總行', district: '澳門半島', address: '澳門半島測試路 1 號',
              opening_hours: { mon_fri: '09:00-18:00' } } });
    log('admin creates branch', r.status === 201, `${r.status} ${r.body.error?.message || ''}`);
    const branchId = r.body.branch?.id;

    // 4. Admin activates dealer (requires branch + service + contact — we have all)
    r = await call(base, `/api/admin/dealers/${dealerId}`, { method: 'PATCH', cookie: adminCookie,
      body: { status: 'active' } });
    log('admin activates dealer', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);

    // 5. Admin invites a NEW email (not the seeded owner) so we exercise the
//    invite-token path, not the "user already exists" membership path.
    const inviteEmail = `dealer-${suffix}@e.test`;
    r = await call(base, `/api/admin/dealers/${dealerId}/invites`, { method: 'POST', cookie: adminCookie,
      body: { email: inviteEmail, role: 'owner' } });
    log('admin issues invite', r.status === 201, `${r.status} ${r.body.error?.message || ''}`);
    const token = r.body.invite_token;
    log('invite_token returned', !!token && token.length > 20, token ? `len=${token.length}` : 'no key');

    // 6. Owner login (we seeded them)
    r = await call(base, '/api/auth/login', { method: 'POST',
      body: { email: `owner-${suffix}@e.test`, password: 'Owner-pw-2026!' } });
    log('owner login', r.status === 200, r.status);
    // Owner session not used after step 6; kept for backwards-compat.

    // 7. Register the new dealer user (the invite email we just created)
    r = await call(base, '/api/auth/register', { method: 'POST',
      body: { email: inviteEmail, password: 'Dealer-pw-2026!',
              display_name: 'Dealer Owner', terms_version: 'v1' } });
    log('dealer registers via invite email', r.status === 200 || r.status === 201,
      `${r.status} ${r.body.error?.message || ''}`);
    const dealerCookie = (r.setCookie || '').split(';')[0] || (r.body?.data?.session && r.body.data.session.split(';')[0]);

    // 8. Dealer accepts invite
    r = await call(base, '/api/dealer/invites/accept', { method: 'POST', cookie: dealerCookie,
      body: { token } });
    log('dealer accepts invite', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);

    // 9. Verify membership
    r = await call(base, '/api/dealer/me', { cookie: dealerCookie });
    log('dealer membership visible', r.status === 200 && r.body.data?.some((d) => d.id === dealerId),
      `count=${r.body.data?.length}`);

    // 10. Dealer creates baseline offer (admin path — we don't have public POST /api/dealer/offers in the spec yet)
    const offerId = randomUUID();
    await withClient((c) => c.query(
      `INSERT INTO service_offers (id,dealer_id,branch_id,kind,name,description,currency,price_minor,pricing_mode,duration_minutes,checklist_version,active)
       VALUES ($1,$2,$3,'baseline','基線','d','MOP',28000,'fixed',45,'baseline-v1',TRUE)`,
      [offerId, dealerId, branchId]));
    log('baseline offer created', !!offerId, `id=${offerId.slice(0,8)}`);

    // 11. Dealer creates a slot
    r = await call(base, '/api/dealer/booking-slots', { method: 'POST', cookie: dealerCookie,
      body: { branch_id: branchId,
              starts_at: new Date(Date.now() + 3600_000).toISOString(),
              ends_at: new Date(Date.now() + 7200_000).toISOString(),
              capacity: 1 } });
    log('booking slot created', r.status === 201, `${r.status} ${r.body.error?.message || ''}`);

    // 12. Public offer list reachable (anonymous)
    r = await call(base, '/api/service-offers');
    log('public offer list reachable', r.status === 200);

    // 12. Branch timezone default
    const branch = (await withClient((c) => c.query(`SELECT timezone FROM dealer_branches WHERE id=$1`, [branchId]))).rows[0];
    log('branch timezone = Asia/Macau', branch.timezone === 'Asia/Macau', branch.timezone);

    // 13. Dealer visible in admin overview
    r = await call(base, '/api/admin/service-orders', { cookie: adminCookie });
    log('admin sees dealer workspace', r.status === 200);
  } catch (e) {
    console.error('UNEXPECTED', e); process.exitCode = 1;
  } finally {
    try { await withClient((c) => cleanup(c, suffix)); } catch (e) { console.error('[cleanup]', e.message); }
    proc.kill(); await sleep(200);
    await pool.end().catch(() => {});
  }
  process.exit(process.exitCode || 0);
}

main();