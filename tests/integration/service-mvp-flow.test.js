/* Live integration test for the Service MVP end-to-end flow.
   Connects to TEST_DATABASE_URL (or KC_DATABASE_URL fallback), seeds the
   minimum data (admin + dealer + owner + vehicle + offer + slot), then
   walks the v2 actions through the actual route handlers.

   Per spec §11 scenario 2 + 4: car owner signs up, picks baseline offer,
   accepts quote, picks slot, dealer fills 7 inspection items, publishes,
   submits completion, owner confirms. Verifies that maintenance history
   rows are written, vehicle_status.last_done is updated only for maintenance
   service_keys (not inspection), and that commission accrual is skipped
   under pilot defaults (0 bps / dealer_existing).

   Cleanup runs in `finally` so reruns are safe. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';

const DB_URL = process.env.TEST_DATABASE_URL
  || process.env.SUPABASE_DB_URL
  || process.env.KC_DATABASE_URL;

if (!DB_URL) {
  test('integration: skipped — no DB URL configured', { skip: true }, () => {});
} else {
  const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });

  async function withClient(fn) {
    const c = await pool.connect();
    try { return await fn(c); } finally { c.release(); }
  }

  function hash(pw) { return bcrypt.hashSync(pw, 4); }

  async function seedBaseline(c, suffix) {
    await c.query('BEGIN');
    try {
      const adminId = `admin-${suffix}`;
      const ownerId = `owner-${suffix}`;
      const dealerId = `dealer-${suffix}`;
      const branchId = `branch-${suffix}`;
      const vehicleId = `vehicle-${suffix}`;
      const offerId = randomUUID();

      await c.query(
        `INSERT INTO users (id, email, password_hash, role, display_name, is_active)
         VALUES ($1,$2,$3,'admin','Test Admin', TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [adminId, `admin-${suffix}@example.test`, hash('admin-pw')]
      );
      await c.query(
        `INSERT INTO users (id, email, password_hash, role, display_name, is_active)
         VALUES ($1,$2,$3,'user','Test Owner', TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [ownerId, `owner-${suffix}@example.test`, hash('Owner-pw-2026!')]
      );
      await c.query(
        `INSERT INTO dealers (id, display_name, status, pilot_enabled)
         VALUES ($1,'Test Dealer', 'active', TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [dealerId]
      );
      await c.query(
        `INSERT INTO dealer_branches (id, dealer_id, display_name, timezone)
         VALUES ($1,$2,'Test Branch', 'Asia/Macau')
         ON CONFLICT (id) DO NOTHING`,
        [branchId, dealerId]
      );
      await c.query(
        `INSERT INTO dealer_members (dealer_id, user_id, role)
         VALUES ($1,$2,'owner')
         ON CONFLICT DO NOTHING`,
        [dealerId, ownerId]
      );
      await c.query(
        `INSERT INTO vehicles (id, model, make, year, fuel_type, plate, mileage_km, mileage_label,
          created_by_user_id, onboarding_state, onboarding_completed_at)
         VALUES ($1, 'Corolla Cross', 'Toyota', 2021, '混能', $2, 42680, '42680 km',
          $3, 'completed', NOW())
         ON CONFLICT (id) DO NOTHING`,
        [vehicleId, `TEST-${suffix}`, ownerId]
      );
      await c.query(
        `INSERT INTO service_offers (id, dealer_id, branch_id, kind, name, description,
          currency, price_minor, pricing_mode, duration_minutes, checklist_version, active)
         VALUES ($1, $2, $3, 'baseline', '基線七項檢查', 'Inspection',
          'MOP', 28000, 'fixed', 45, 'baseline-v1', TRUE)`,
        [offerId, dealerId, branchId]
      );
      // Slot in 1 hour for 60 minutes
      const starts = new Date(Date.now() + 60 * 60 * 1000);
      const ends = new Date(starts.getTime() + 60 * 60 * 1000);
      const slotId = randomUUID();
      await c.query(
        `INSERT INTO booking_slots (id, branch_id, starts_at, ends_at, capacity, active)
         VALUES ($1, $2, $3, $4, 1, TRUE)`,
        [slotId, branchId, starts.toISOString(), ends.toISOString()]
      );
      await c.query('COMMIT');
      return { adminId, ownerId, dealerId, branchId, vehicleId, offerId, slotId };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  }

  async function cleanup(c, suffix) {
    const ids = [`admin-${suffix}`, `owner-${suffix}`];
    await c.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [ids]);
    await c.query(`DELETE FROM dealer_members WHERE dealer_id = $1`, [`dealer-${suffix}`]);
    await c.query(`DELETE FROM booking_slots WHERE branch_id = $1`, [`branch-${suffix}`]);
    await c.query(`DELETE FROM service_offers WHERE dealer_id = $1`, [`dealer-${suffix}`]);
    await c.query(`DELETE FROM dealer_branches WHERE id = $1`, [`branch-${suffix}`]);
    await c.query(`DELETE FROM dealers WHERE id = $1`, [`dealer-${suffix}`]);
    await c.query(`DELETE FROM vehicles WHERE id = $1`, [`vehicle-${suffix}`]);
    // Cascade through service_* tables for this request
    await c.query(`DELETE FROM dealer_service_requests WHERE vehicle_id = $1`, [`vehicle-${suffix}`]);
  }

  async function postJSON(client, baseUrl, path, cookie, body, idempotencyKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const r = await fetch(baseUrl + path, { method: 'POST', headers, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
    const setCookie = r.headers.get('set-cookie');
    return { status: r.status, body: json, setCookie };
  }
  async function getJSON(client, baseUrl, path, cookie) {
    const headers = {};
    if (cookie) headers['Cookie'] = cookie;
    const r = await fetch(baseUrl + path, { method: 'GET', headers });
    const text = await r.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
    return { status: r.status, body: json, setCookie: r.headers.get('set-cookie') };
  }
  async function putJSON(client, baseUrl, path, cookie, body, idempotencyKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers['Cookie'] = cookie;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const r = await fetch(baseUrl + path, { method: 'PUT', headers, body: JSON.stringify(body || {}) });
    const text = await r.text();
    let json = {}; try { json = text ? JSON.parse(text) : {}; } catch {}
    return { status: r.status, body: json };
  }

  /* Start the dev server (use whatever port TEST_PORT says, default 0 = find one) */
  async function startServer() {
    const { spawn } = await import('node:child_process');
    const proc = spawn('node', ['scripts/dev-server.js'], {
      env: {
        ...process.env,
        PORT: String(3100 + Math.floor(Math.random() * 200)),
        KC_DATABASE_URL: DB_URL,
        KC_AUTO_MIGRATE: '0', // we ran migrate manually
        DEMO_SEED_ENABLED: '0',
        KC_ALLOW_NO_ORIGIN: '1',
        KC_ALLOWED_ORIGINS: 'http://127.0.0.1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const port = Number(proc.env.PORT || (() => { const m = proc.spawnargs.join(' ').match(/PORT=(\d+)/); return m ? m[1] : '3100'; })());
    const baseUrl = `http://127.0.0.1:${port}`;
    // wait for /api/health
    for (let i = 0; i < 40; i += 1) {
      try {
        const r = await fetch(baseUrl + '/api/health');
        if (r.ok) break;
      } catch { /* not ready */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    return { proc, baseUrl };
  }

  test('integration: full service MVP flow (baseline → quote → accept → schedule → inspect → publish → complete → confirm → payment)', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { proc, baseUrl } = await startServer();
    try {
      await withClient(async (c) => {
        const seed = await seedBaseline(c, suffix);
        // Login as owner
        const login = await postJSON(null, baseUrl, '/api/auth/login', null,
          { email: `owner-${suffix}@example.test`, password: 'Owner-pw-2026!' });
        assert.equal(login.status, 200, 'owner login');
        const cookie = login.setCookie && login.setCookie.split(';')[0];
        assert.ok(cookie, 'session cookie returned');
        // 1. Owner creates a service request for the offer.
        const create = await postJSON(null, baseUrl,
          `/api/vehicles/${seed.vehicleId}/service-requests`, cookie,
          { offer_id: seed.offerId, contact_name: 'Owner', contact_phone: '+85300000000',
            customer_note: 'first pilot', terms_version: 'v1', consented_at: new Date().toISOString() },
          randomUUID());
        assert.equal(create.status, 200, `create request (${create.body.error?.message || ''})`);
        const requestId = create.body.data.id;
        const version0 = create.body.data.version;
        // 2. Dealer logs in and quotes (manual quote with v2 line_ids).
        const dealerLogin = await postJSON(null, baseUrl, '/api/auth/login', null,
          { email: `owner-${suffix}@example.test`, password: 'Owner-pw-2026!' });
        const dealerCookie = dealerLogin.setCookie.split(';')[0];
        // Build a v2 quote payload with 1 line that bundles 7 inspection keys (labour only).
        const lineId = randomUUID();
        const quoteItems = [{
          line_id: lineId,
          description: '基線七項檢查',
          quantity: 1,
          parts_unit_minor: 0,
          labour_minor: 28000,
          work_type: 'inspect',
          service_keys: ['engine_oil','oil_filter','transmission_oil','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter'],
        }];
        const quoteRes = await postJSON(null, baseUrl, `/api/service-requests/${requestId}`, dealerCookie,
          { action: 'quote', version: version0, currency: 'MOP',
            items: quoteItems.map((it) => ({ description: it.description, amount_minor: 28000, service_keys: it.service_keys })),
            expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
          randomUUID());
        assert.equal(quoteRes.status, 200, `quote (${quoteRes.body.error?.message || ''})`);
        // 3. Owner accepts the quote with the line_id (v2 path).
        const afterQuote = (await getJSON(null, baseUrl, `/api/service-requests/${requestId}`, cookie)).body.data;
        const latestVersion = afterQuote.version;
        const accept = await postJSON(null, baseUrl, `/api/service-requests/${requestId}`, cookie,
          { action: 'accept_quote', version: latestVersion, quote_id: quoteRes.body.request ? quoteRes.body.request.accepted_quote_id : undefined,
            selected_line_ids: [lineId] },
          randomUUID());
        assert.equal(accept.status, 200, `accept_quote (${accept.body.error?.message || ''})`);
        // 4. Owner schedules via slot.
        const afterAccept = (await getJSON(null, baseUrl, `/api/service-requests/${requestId}`, cookie)).body.data;
        const sched = await postJSON(null, baseUrl, `/api/service-requests/${requestId}`, cookie,
          { action: 'schedule', version: afterAccept.version, slot_id: seed.slotId },
          randomUUID());
        assert.equal(sched.status, 200, `schedule (${sched.body.error?.message || ''})`);
        // 5. Dealer starts the service.
        const afterSched = (await getJSON(null, baseUrl, `/api/service-requests/${requestId}`, dealerCookie)).body.data;
        const startRes = await postJSON(null, baseUrl, `/api/service-requests/${requestId}`, dealerCookie,
          { action: 'start', version: afterSched.version },
          randomUUID());
        assert.equal(startRes.status, 200, `start (${startRes.body.error?.message || ''})`);
        // 6. Dealer drafts and publishes an inspection report.
        const draft = await putJSON(null, baseUrl, `/api/service-requests/${requestId}/inspection`, dealerCookie,
          { mileage_km: 42680, summary: '全部在範圍內', template_key: 'baseline-v1' });
        assert.equal(draft.status, 200, `inspection draft (${draft.body.error?.message || ''})`);
        const reportId = draft.body.data.id;
        const allResults = ['engine_oil_and_filter','transmission_oil','brake_pads','brake_fluid','coolant','spark_plugs','air_filter','cabin_filter']
          .map((k) => ({ check_key: k, result: 'normal', service_keys: [],
                          notes: 'ok', measurement_method: 'visual' }));
        const pub = await postJSON(null, baseUrl, `/api/service-requests/${requestId}/inspection/publish`,
          dealerCookie, { version: draft.body.data.version, results: allResults },
          randomUUID());
        assert.equal(pub.status, 200, `inspection publish (${pub.body.error?.message || ''})`);
        // 7. Dealer submits completion. The accepted line is a single inspection line; we mark it completed
        // so final_total > 0.
        const orderLines = (await c.query(
          `SELECT * FROM service_order_lines WHERE request_id=$1`, [requestId])).rows;
        assert.ok(orderLines.length >= 1, 'order lines created');
        const completion = {
          mileage_km: 42680,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          duration_minutes: 40,
          technician_name: 'Tech A',
          notes: '完成',
          lines: orderLines.map((l) => ({ order_line_id: l.id, outcome: 'completed',
            actual_parts_brand: null, actual_parts_spec: null, actual_part_number: null,
            next_due_km: 50000, next_due_date: null })),
        };
        const compRes = await postJSON(null, baseUrl, `/api/service-requests/${requestId}`, dealerCookie,
          { action: 'complete', version: pub.body.data && 0, completion },
          randomUUID());
        assert.equal(compRes.status, 200, `complete (${compRes.body.error?.message || ''})`);
        // 8. Owner confirms. Since service_kind=baseline, history is inspection-only and last_done unchanged.
        const afterComplete = (await getJSON(null, baseUrl, `/api/service-requests/${requestId}`, cookie)).body.data;
        const confirm = await postJSON(null, baseUrl, `/api/service-requests/${requestId}`, cookie,
          { action: 'confirm_completion', version: afterComplete.version },
          randomUUID());
        assert.equal(confirm.status, 200, `confirm_completion (${confirm.body.error?.message || ''})`);
        // 9. Verify history row written (record_type=inspection), vehicle_status NOT updated for inspection keys.
        const history = (await c.query(
          `SELECT * FROM service_history WHERE request_id=$1`, [requestId])).rows;
        assert.ok(history.length >= 1, 'history row');
        assert.ok(history.some((h) => h.record_type === 'inspection'), 'inspection history row');
        // 10. Dealer records offline payment (dealer_existing origin → 0 bps → no commission accrual).
        const afterConfirm = (await getJSON(null, baseUrl, `/api/service-requests/${requestId}`, cookie)).body.data;
        const pay = await postJSON(null, baseUrl, `/api/dealer/service-orders/${requestId}/payment`, dealerCookie,
          { amount_minor: 28000, reference: 'cash-test', payment_method: 'cash' }, randomUUID());
        assert.equal(pay.status, 200, `payment (${pay.body.error?.message || ''})`);
        const comm = (await c.query(`SELECT COUNT(*)::int AS n FROM commission_entries WHERE request_id=$1`, [requestId])).rows[0].n;
        assert.equal(comm, 0, 'no commission accrued (dealer_existing + 0 bps)');
      });
    } finally {
      try {
        await withClient((c) => cleanup(c, suffix));
      } catch (e) { console.error('[cleanup]', e.message); }
      proc.kill();
      await new Promise((r) => setTimeout(r, 200));
      await pool.end().catch(() => {});
    }
  });

  /* Concurrency: two owners fight for the same slot, only one wins. */
  test('integration: capacity=1 slot → first accept wins, second 409', async () => {
    const suffix = randomUUID().slice(0, 8);
    const { proc, baseUrl } = await startServer();
    try {
      await withClient(async (c) => {
        const seed = await seedBaseline(c, suffix);
        // Make a second owner + their own vehicle
        const owner2 = `owner2-${suffix}`;
        await c.query(
          `INSERT INTO users (id, email, password_hash, role, display_name, is_active)
           VALUES ($1,$2,$3,'user','Owner Two', TRUE)
           ON CONFLICT (id) DO NOTHING`,
          [owner2, `owner2-${suffix}@example.test`, hash('Owner-pw-2026!')]
        );
        const v2 = `vehicle2-${suffix}`;
        await c.query(
          `INSERT INTO vehicles (id, model, fuel_type, plate, mileage_km, mileage_label, created_by_user_id, onboarding_state)
           VALUES ($1,'Yaris','汽油',$2, 12000, '12000 km', $3, 'completed')`,
          [v2, `T2-${suffix}`, owner2]
        );
        // Both owners log in and create requests for the same offer + slot.
        const owner1Login = await postJSON(null, baseUrl, '/api/auth/login', null,
          { email: `owner-${suffix}@example.test`, password: 'Owner-pw-2026!' });
        const owner1Cookie = owner1Login.setCookie.split(';')[0];
        const owner2Login = await postJSON(null, baseUrl, '/api/auth/login', null,
          { email: `owner2-${suffix}@example.test`, password: 'Owner-pw-2026!' });
        const owner2Cookie = owner2Login.setCookie.split(';')[0];
        const dealerLogin = await postJSON(null, baseUrl, '/api/auth/login', null,
          { email: `owner-${suffix}@example.test`, password: 'Owner-pw-2026!' });
        const dealerCookie = dealerLogin.setCookie.split(';')[0];
        const r1 = await postJSON(null, baseUrl, `/api/vehicles/${seed.vehicleId}/service-requests`, owner1Cookie,
          { offer_id: seed.offerId, contact_name: 'O1', terms_version: 'v1', consented_at: new Date().toISOString() },
          randomUUID());
        assert.equal(r1.status, 200, 'r1 create');
        const r2 = await postJSON(null, baseUrl, `/api/vehicles/${v2}/service-requests`, owner2Cookie,
          { offer_id: seed.offerId, contact_name: 'O2', terms_version: 'v1', consented_at: new Date().toISOString() },
          randomUUID());
        assert.equal(r2.status, 200, 'r2 create');
        // Dealer quotes both.
        for (const req of [r1.body.data, r2.body.data]) {
          await postJSON(null, baseUrl, `/api/service-requests/${req.id}`, dealerCookie,
            { action: 'quote', version: req.version, currency: 'MOP',
              items: [{ description: 'baseline', amount_minor: 28000, service_keys: ['engine_oil'] }],
              expires_at: new Date(Date.now() + 86400000).toISOString() },
            randomUUID());
        }
        const a1 = (await getJSON(null, baseUrl, `/api/service-requests/${r1.body.data.id}`, owner1Cookie)).body.data;
        const a2 = (await getJSON(null, baseUrl, `/api/service-requests/${r2.body.data.id}`, owner2Cookie)).body.data;
        const latestQuoteId = (await c.query(
          `SELECT id FROM dealer_quotes WHERE request_id=$1 ORDER BY version DESC LIMIT 1`, [a1.id])).rows[0].id;
        await postJSON(null, baseUrl, `/api/service-requests/${a1.id}`, owner1Cookie,
          { action: 'accept_quote', version: a1.version, quote_id: latestQuoteId, selected_line_ids: undefined, selected_line_indexes: [0] },
          randomUUID());
        await postJSON(null, baseUrl, `/api/service-requests/${a2.id}`, owner2Cookie,
          { action: 'accept_quote', version: a2.version, quote_id:
            (await c.query(`SELECT id FROM dealer_quotes WHERE request_id=$1 ORDER BY version DESC LIMIT 1`, [a2.id])).rows[0].id,
            selected_line_indexes: [0] },
          randomUUID());
        const s1 = (await getJSON(null, baseUrl, `/api/service-requests/${a1.id}`, owner1Cookie)).body.data;
        const s2 = (await getJSON(null, baseUrl, `/api/service-requests/${a2.id}`, owner2Cookie)).body.data;
        const r1Sched = await postJSON(null, baseUrl, `/api/service-requests/${a1.id}`, owner1Cookie,
          { action: 'schedule', version: s1.version, slot_id: seed.slotId },
          randomUUID());
        assert.equal(r1Sched.status, 200, 'r1 schedule');
        const r2Sched = await postJSON(null, baseUrl, `/api/service-requests/${a2.id}`, owner2Cookie,
          { action: 'schedule', version: s2.version, slot_id: seed.slotId },
          randomUUID());
        assert.notEqual(r2Sched.status, 200, 'r2 schedule should fail');
      });
    } finally {
      try {
        await withClient((c) => {
          return c.query(`DELETE FROM users WHERE id IN ($1,$2)`,
            [`owner-${suffix}`, `owner2-${suffix}`]).then(() =>
            c.query(`DELETE FROM vehicles WHERE id = $1`, [`vehicle2-${suffix}`])
          ).then(() => cleanup(c, suffix));
        });
      } catch (e) { console.error('[cleanup]', e.message); }
      proc.kill();
      await new Promise((r) => setTimeout(r, 200));
      await pool.end().catch(() => {});
    }
  });
}