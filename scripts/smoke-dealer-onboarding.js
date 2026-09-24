#!/usr/bin/env node
/* Smoke test for the dealer self-registration flow (Phase 7).
   Walks through:
     1. Anonymous POST /api/auth/register with dealer:{} → user + dealer + branch + member (owner)
     2. New owner GET /api/dealer/me → returns the dealer
     3. Owner POST /api/dealer/booking-slots → opens a slot
     4. Admin PATCH status=suspended → owner's session /api/auth/me blocked (is_active=false)
     5. Admin PATCH status=active → owner restored
     6. Admin POST /api/admin/dealers/:id/members adds an existing user as manager
     7. Admin DELETE removes that membership
     8. Invite endpoints return 404 (dealer_invites table gone)
     9. Public offer list reachable (anonymous)

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

async function cleanup(c, ownerEmail, adminEmail) {
  const dealerRows = (await c.query(`SELECT id FROM dealers WHERE display_name LIKE 'Self Reg Smoke %'`)).rows;
  for (const { id } of dealerRows) {
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
    await c.query(`DELETE FROM dealer_members WHERE dealer_id=$1`, [id]);
    await c.query(`DELETE FROM dealer_branches WHERE dealer_id=$1`, [id]);
    await c.query(`DELETE FROM dealers WHERE id=$1`, [id]);
  }
  await c.query(`DELETE FROM users WHERE email IN ($1,$2)`, [ownerEmail, adminEmail]);
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
  const port = 3115;
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn('node', ['scripts/dev-server.js'], {
    env: { ...process.env, PORT: String(port), KC_DATABASE_URL: DB_URL,
      KC_AUTO_MIGRATE: '0', DEMO_SEED_ENABLED: '0',
      KC_ALLOW_NO_ORIGIN: '1', KC_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
      RESEND_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) break; } catch {}
    await sleep(250);
  }
  const ownerEmail = `selfreg-${randomUUID().slice(0,8)}@e.test`;
  const adminEmail = `admin-selfreg-${randomUUID().slice(0,8)}@e.test`;
  try {
    /* Seed an admin and a manager candidate user. */
    await withClient((c) => c.query(
      `INSERT INTO users (id,email,password_hash,role,display_name,is_active)
       VALUES ($1,$2,$3,'admin','Admin',TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [`admin-${randomUUID().slice(0,8)}`, adminEmail, bcrypt.hashSync('Admin-pw-2026!', 4)],
    ));
    await withClient((c) => c.query(
      `INSERT INTO users (id,email,password_hash,role,display_name,is_active)
       VALUES ($1,$2,$3,'user','Manager',TRUE)
       ON CONFLICT (id) DO NOTHING`,
      [`mgr-${randomUUID().slice(0,8)}`, `mgr-${randomUUID().slice(0,8)}@e.test`, bcrypt.hashSync('Manager-pw-2026!', 4)],
    ));

    // 1. Anonymous self-registers with dealer payload
    let r = await call(base, '/api/auth/register', { method: 'POST', body: {
      email: ownerEmail,
      password: 'Owner-pw-2026!',
      display_name: 'Self Reg Owner',
      terms_version: 'v1',
      dealer: {
        display_name: 'Self Reg Smoke Workshop',
        legal_name: 'Self Reg Ltd',
        registration_number: 'SR-' + randomUUID().slice(0,8),
        phone: '+853-2882-0000',
        email: ownerEmail,
        branch_name: '澳門店',
        branch_address: '澳門半島測試路 1 號',
        branch_district: '澳門半島',
      },
    }});
    log('anonymous self-register', r.status === 201, `${r.status} ${r.body.error?.message || ''}`);
    log('dealer_id returned', !!r.body.dealer_id && r.body.dealer_id.startsWith('dealer-'), r.body.dealer_id);
    const dealerId = r.body.dealer_id;
    const ownerCookie = (r.setCookie || '').split(';')[0];

    // 2. New owner can read /api/dealer/me
    r = await call(base, '/api/dealer/me', { cookie: ownerCookie });
    log('owner sees own dealer', r.status === 200 && r.body.data?.some((d) => d.id === dealerId), `count=${r.body.data?.length}`);

    // 3. Verify the dealer row exists with status='active' and member=owner
    const dealerRow = (await withClient((c) => c.query(`SELECT status FROM dealers WHERE id=$1`, [dealerId]))).rows[0];
    log('dealer.status = active', dealerRow?.status === 'active', dealerRow?.status);
    const memberRow = (await withClient((c) => c.query(`SELECT role FROM dealer_members WHERE dealer_id=$1`, [dealerId]))).rows[0];
    log('dealer_members.role = owner', memberRow?.role === 'owner', memberRow?.role);

    // 4. Owner can open a booking slot
    const branchId = (await withClient((c) => c.query(`SELECT id FROM dealer_branches WHERE dealer_id=$1`, [dealerId]))).rows[0].id;
    r = await call(base, '/api/dealer/booking-slots', { method: 'POST', cookie: ownerCookie, body: {
      branch_id: branchId,
      starts_at: new Date(Date.now() + 3600_000).toISOString(),
      ends_at: new Date(Date.now() + 7200_000).toISOString(),
      capacity: 1,
    }});
    log('booking slot created', r.status === 201, `${r.status} ${r.body.error?.message || ''}`);

    // 5. Admin login
    const adminLogin = await call(base, '/api/auth/login', { method: 'POST', body: { email: adminEmail, password: 'Admin-pw-2026!' } });
    log('admin login', adminLogin.status === 200, adminLogin.status);
    const adminCookie = (adminLogin.setCookie || '').split(';')[0];

    // 6. Admin suspends dealer → owner's users.is_active should flip to false
    r = await call(base, `/api/admin/dealers/${dealerId}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'suspended' } });
    log('admin suspends dealer', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    log('member_flip reports inactive', r.body.member_flip?.is_active === false && r.body.member_flip?.count >= 1, JSON.stringify(r.body.member_flip));
    const ownerActiveAfterSuspend = (await withClient((c) => c.query(`SELECT is_active FROM users WHERE email=$1`, [ownerEmail]))).rows[0].is_active;
    log('owner users.is_active = false after suspend', ownerActiveAfterSuspend === false, String(ownerActiveAfterSuspend));

    // 7. Owner session now blocked at /api/auth/me (requireUser returns 401 when is_active=false)
    r = await call(base, '/api/auth/me', { cookie: ownerCookie });
    log('suspended owner /api/auth/me returns 401', r.status === 401, r.status);

    // 8. Admin reactivates → owner is_active flips back
    r = await call(base, `/api/admin/dealers/${dealerId}`, { method: 'PATCH', cookie: adminCookie, body: { status: 'active' } });
    log('admin reactivates dealer', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    log('member_flip reports active', r.body.member_flip?.is_active === true && r.body.member_flip?.count >= 1, JSON.stringify(r.body.member_flip));
    const ownerActiveAfterReactivate = (await withClient((c) => c.query(`SELECT is_active FROM users WHERE email=$1`, [ownerEmail]))).rows[0].is_active;
    log('owner users.is_active = true after reactivate', ownerActiveAfterReactivate === true, String(ownerActiveAfterReactivate));

    // 9. Admin edits dealer field
    r = await call(base, `/api/admin/dealers/${dealerId}`, { method: 'PATCH', cookie: adminCookie, body: { phone: '+853-9999-0000' } });
    log('admin edits phone', r.status === 200 && r.body.dealer.phone === '+853-9999-0000', r.body.dealer?.phone);
    /* Reset status to active so the deactivate-via-self path doesn't flip later. */

    // 10. Admin adds an existing user as manager via members endpoint
    const managerCandidate = (await withClient((c) => c.query(`SELECT id, email FROM users WHERE email LIKE 'mgr-%@e.test' ORDER BY created_at DESC LIMIT 1`))).rows[0];
    r = await call(base, `/api/admin/dealers/${dealerId}/members`, { method: 'POST', cookie: adminCookie, body: { email: managerCandidate.email, role: 'manager' } });
    log('admin adds existing user as manager', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    const membersAfterAdd = (await withClient((c) => c.query(`SELECT COUNT(*)::int AS n FROM dealer_members WHERE dealer_id=$1`, [dealerId]))).rows[0].n;
    log('dealer_members has 2 rows after add', membersAfterAdd === 2, `count=${membersAfterAdd}`);

    // 11. Admin removes the manager (not last owner)
    r = await call(base, `/api/admin/dealers/${dealerId}/members/${managerCandidate.id}`, { method: 'DELETE', cookie: adminCookie });
    log('admin removes manager', r.status === 200, `${r.status} ${r.body.error?.message || ''}`);
    const membersAfterRemove = (await withClient((c) => c.query(`SELECT COUNT(*)::int AS n FROM dealer_members WHERE dealer_id=$1`, [dealerId]))).rows[0].n;
    log('dealer_members has 1 row after remove', membersAfterRemove === 1, `count=${membersAfterRemove}`);

    // 12. Admin cannot remove the sole owner
    const ownerRow = (await withClient((c) => c.query(`SELECT user_id FROM dealer_members WHERE dealer_id=$1 AND role='owner'`, [dealerId]))).rows[0];
    r = await call(base, `/api/admin/dealers/${dealerId}/members/${ownerRow.user_id}`, { method: 'DELETE', cookie: adminCookie });
    log('admin cannot remove last owner', r.status === 422 && r.body.error?.code === 'last_owner', `${r.status} ${r.body.error?.code || ''}`);

    // 13. Admin tries to add a non-existent user as member
    const nobodyEmail = `nobody-${randomUUID().slice(0,8)}@e.test`;
    r = await call(base, `/api/admin/dealers/${dealerId}/members`, { method: 'POST', cookie: adminCookie, body: { email: nobodyEmail, role: 'manager' } });
    log('admin add nonexistent user without password returns 422', r.status === 422, `${r.status} ${r.body.error?.message || ''}`);

    r = await call(base, `/api/admin/dealers/${dealerId}/members`, { method: 'POST', cookie: adminCookie, body: { email: nobodyEmail, role: 'staff', password: 'Temp-pw-2026!', display_name: '新人小幫手' } });
    log('admin add nonexistent user with password creates account', r.status === 200 && r.body.user_created === true && !!r.body.temporary_password, `${r.status} user_created=${r.body.user_created}`);
    log('admin add nonexistent user sets member role', r.body?.membership?.role === 'staff', `role=${r.body?.membership?.role}`);

    // cleanup the created user so the rest of the suite stays green
    const newUser = (await withClient((c) => c.query(`SELECT id FROM users WHERE email=$1`, [nobodyEmail]))).rows[0];
    if (newUser) await call(base, `/api/admin/dealers/${dealerId}/members/${newUser.id}`, { method: 'DELETE', cookie: adminCookie });

    // 14. Old invite endpoints return 404
    r = await call(base, `/api/admin/dealers/${dealerId}/invites`, { method: 'POST', cookie: adminCookie, body: { email: 'x@y.test' } });
    log('old admin/dealers/:id/invites returns 404', r.status === 404, r.status);
    r = await call(base, '/api/dealer/invites/accept', { method: 'POST', cookie: ownerCookie, body: { token: 'deadbeef'.repeat(6) } });
    log('old dealer/invites/accept returns 404', r.status === 404, r.status);
    r = await call(base, '/api/dealer/invites/register', { method: 'POST', body: { token: 'a'.repeat(48), password: 'Long-test-password-2026' } });
    log('old dealer/invites/register returns 404', r.status === 404, r.status);

    // 15. Public offer list reachable
    r = await call(base, '/api/service-offers');
    log('public offer list reachable', r.status === 200);

    // 16. Duplicate self-register fails
    r = await call(base, '/api/auth/register', { method: 'POST', body: {
      email: ownerEmail,
      password: 'Another-pw-2026!',
      terms_version: 'v1',
      dealer: { display_name: 'Dup', branch_name: 'Dup', branch_address: 'Dup' },
    }});
    log('duplicate self-register returns 409', r.status === 409, r.status);

    // 17. dealer_invites table no longer exists
    const stillExists = (await withClient((c) => c.query(`SELECT to_regclass('public.dealer_invites') AS reg`))).rows[0].reg;
    log('dealer_invites table dropped', !stillExists, String(stillExists));
  } catch (e) {
    console.error('UNEXPECTED', e); process.exitCode = 1;
  } finally {
    try { await withClient((c) => cleanup(c, ownerEmail, adminEmail)); } catch (e) { console.error('[cleanup]', e.message); }
    proc.kill(); await sleep(200);
    await pool.end().catch(() => {});
  }
  process.exit(process.exitCode || 0);
}

main();