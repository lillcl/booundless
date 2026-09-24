/* POST /api/auth/login — { email, password } → 200 + Set-Cookie
   POST /api/auth/register — { email, password, display_name? } → 201 + Set-Cookie
   POST /api/auth/logout — clears cookie
   GET  /api/auth/me — returns current user or 401
   Only POST login, POST register and POST logout mutate; both register and
   login write to audit_log. */

import { randomUUID } from 'node:crypto';
import {
  hashPassword, verifyPassword, signSession, setSessionCookie, clearSessionCookie,
  readSession, audit,
} from '../_lib/auth.js';
import { sendError, sendJSON, onlyMethod, readBody } from '../_lib/http.js';
import { getDb } from '../_lib/db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72; // bcrypt input cap

function field(value, max = 500) {
  if (value == null || value === '') return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
}

function userPayload(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    display_name: u.display_name,
  };
}

export default async function handler(req, res) {
  const url = req.url || '';

  /* GET /api/auth/me — current session */
  if (req.method === 'GET' && /^\/api\/auth\/me\/?$/.test(url)) {
    const user = await readSession(req);
    if (!user) return sendError(res, 401, 'unauthorized', 'Not signed in');
    return sendJSON(res, 200, { user });
  }

  /* POST /api/auth/logout */
  if (req.method === 'POST' && /^\/api\/auth\/logout\/?$/.test(url)) {
    const user = await readSession(req);
    clearSessionCookie(res);
    if (user) await audit({ actor: user, action: 'auth.logout', req });
    return sendJSON(res, 200, { ok: true });
  }

  /* POST /api/auth/register */
  if (req.method === 'POST' && /^\/api\/auth\/register\/?$/.test(url)) {
    const body = await readBody(req);
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const display_name = body?.display_name
      ? String(body.display_name).trim().slice(0, 80) || null
      : null;
    const terms_version = body?.terms_version ? String(body.terms_version).trim().slice(0, 40) || null : null;
    const dealerPayload = body?.dealer && typeof body.dealer === 'object' ? body.dealer : null;

    if (!email || !EMAIL_RE.test(email)) {
      return sendError(res, 422, 'unprocessable', 'Valid email required');
    }
    if (password.length < PASSWORD_MIN) {
      return sendError(res, 422, 'unprocessable', `Password must be at least ${PASSWORD_MIN} characters`);
    }
    /* bcrypt truncates input at 72; longer passwords silently lose chars. */
    if (Buffer.byteLength(password) > PASSWORD_MAX) {
      return sendError(res, 422, 'unprocessable', `Password must be at most ${PASSWORD_MAX} bytes`);
    }

    /* Validate dealer self-registration payload up front so we don't leave a
       half-registered user on a typo. Branch address is required so the new
       dealer can immediately accept service requests at one location. */
    let dealerCreate = null;
    if (dealerPayload) {
      const legal_name = field(dealerPayload.legal_name, 200);
      const display_name_d = field(dealerPayload.display_name, 160);
      const registration_number = field(dealerPayload.registration_number, 100);
      const phone = field(dealerPayload.phone, 60);
      const website = field(dealerPayload.website, 500);
      const dealer_email = field(dealerPayload.email, 240) || email;
      const branch_name = field(dealerPayload.branch_name, 160);
      const branch_address = field(dealerPayload.branch_address, 300);
      const branch_district = field(dealerPayload.branch_district, 100);
      const branch_phone = field(dealerPayload.branch_phone, 60);
      if (!display_name_d) return sendError(res, 422, 'unprocessable', 'dealer.display_name is required');
      if (!branch_name) return sendError(res, 422, 'unprocessable', 'dealer.branch_name is required');
      if (!branch_address) return sendError(res, 422, 'unprocessable', 'dealer.branch_address is required');
      dealerCreate = { legal_name, display_name: display_name_d, registration_number, phone, email: dealer_email, website, branch_name, branch_address, branch_district, branch_phone };
    }

    const db = await getDb();
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      /* Constant-time-ish: still run a hash so timing does not betray existence. */
      await hashPassword(password);
      await audit({ action: 'auth.register.conflict', payload: { email, reason: 'email_taken' }, req });
      return sendError(res, 409, 'conflict', 'Email already in use');
    }

    const userId = `u-${randomUUID()}`;
    const password_hash = await hashPassword(password);
    const client = await db.connect();
    let user; let dealer; let branch;
    try {
      await client.query('BEGIN');
      const u = await client.query(
        `INSERT INTO users (id, email, password_hash, role, display_name, terms_version)
         VALUES ($1, $2, $3, 'user', $4, $5)
         RETURNING id, email, role, display_name, is_active, terms_version`,
        [userId, email, password_hash, display_name, terms_version],
      );
      user = u.rows[0];
      if (dealerCreate) {
        const dealerId = `dealer-${randomUUID()}`;
        const branchId = `branch-${randomUUID()}`;
        const d = await client.query(
          `INSERT INTO dealers
             (id, legal_name, display_name, registration_number, phone, email, website, status, created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8) RETURNING *`,
          [dealerId, dealerCreate.legal_name, dealerCreate.display_name, dealerCreate.registration_number,
           dealerCreate.phone, dealerCreate.email, dealerCreate.website, userId],
        );
        dealer = d.rows[0];
        const b = await client.query(
          `INSERT INTO dealer_branches (id, dealer_id, name, address, district, phone, opening_hours, timezone)
           VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 'Asia/Macau') RETURNING *`,
          [branchId, dealerId, dealerCreate.branch_name, dealerCreate.branch_address,
           dealerCreate.branch_district, dealerCreate.branch_phone],
        );
        branch = b.rows[0];
        await client.query(
          `INSERT INTO dealer_members (dealer_id, user_id, role) VALUES ($1, $2, 'owner')
           ON CONFLICT (dealer_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [dealerId, userId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    const token = await signSession(user);
    setSessionCookie(res, token);
    await audit({
      actor: { id: user.id, email: user.email },
      action: dealerCreate ? 'dealer.self_register' : 'auth.register',
      targetType: dealerCreate ? 'dealer' : 'user',
      targetId: dealerCreate ? dealer.id : user.id,
      payload: { email: user.email, display_name: user.display_name, terms_version, dealer_id: dealer?.id },
      req,
    });
    const responseBody = { user: userPayload(user) };
    if (dealerCreate) responseBody.dealer_id = dealer.id;
    return sendJSON(res, 201, responseBody);
  }

  /* POST /api/auth/login */
  if (req.method === 'POST' && /^\/api\/auth\/login\/?$/.test(url)) {
    const body = await readBody(req);
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    if (!email || !password) {
      return sendError(res, 422, 'unprocessable', 'email and password required');
    }

    const db = await getDb();
    const r = await db.query(
      'SELECT id, email, password_hash, role, display_name, is_active FROM users WHERE email = $1',
      [email],
    );
    const user = r.rows[0];

    /* Always run bcrypt to keep timing roughly constant. */
    const fakeHash = '$2b$10$abcdefghijklmnopqrstuO3dK8Y2p5mX4nQ7vZ1w6aB9cD2eF0gH';
    const ok = await verifyPassword(password, user?.password_hash || fakeHash);

    if (!user || !user.is_active || !ok) {
      await audit({ action: 'auth.failed', payload: { email, reason: !user ? 'no_user' : !user.is_active ? 'inactive' : 'bad_password' }, req });
      return sendError(res, 401, 'unauthorized', 'Invalid email or password');
    }

    const token = await signSession(user);
    setSessionCookie(res, token);
    await audit({ actor: { id: user.id, email: user.email }, action: 'auth.login', req });
    return sendJSON(res, 200, { user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name } });
  }

  sendError(res, 405, 'method_not_allowed', 'Method not allowed');
}
