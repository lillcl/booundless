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

    const db = await getDb();
    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      /* Constant-time-ish: still run a hash so timing does not betray existence. */
      await hashPassword(password);
      await audit({ action: 'auth.register.conflict', payload: { email, reason: 'email_taken' }, req });
      return sendError(res, 409, 'conflict', 'Email already in use');
    }

    const id = `u-${randomUUID()}`;
    const password_hash = await hashPassword(password);
    const r = await db.query(
      `INSERT INTO users (id, email, password_hash, role, display_name)
       VALUES ($1, $2, $3, 'user', $4)
       RETURNING id, email, role, display_name, is_active`,
      [id, email, password_hash, display_name],
    );
    const user = r.rows[0];
    const token = await signSession(user);
    setSessionCookie(res, token);
    await audit({
      actor: { id: user.id, email: user.email },
      action: 'auth.register',
      targetType: 'user',
      targetId: user.id,
      payload: { email: user.email, display_name: user.display_name },
      req,
    });
    return sendJSON(res, 201, { user: userPayload(user) });
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
