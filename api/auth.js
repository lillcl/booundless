/* POST /api/auth/login — { email, password } → 200 + Set-Cookie
   POST /api/auth/logout — clears cookie
   GET  /api/auth/me — returns current user or 401
   Only POST login and POST logout mutate; both write to audit_log. */

import {
  verifyPassword, signSession, setSessionCookie, clearSessionCookie,
  readSession, audit,
} from './_lib/auth.js';
import { sendError, sendJSON, onlyMethod, readBody } from './_lib/http.js';
import { getDb } from './_lib/db.js';

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
