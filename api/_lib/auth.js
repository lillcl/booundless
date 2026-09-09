/* Auth helpers: bcrypt password hashing, JWT sessions, role gates, audit log.
   Serverless-friendly (pure JS deps, no native build). */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';

const COOKIE_NAME = 'kc_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const s = process.env.KC_JWT_SECRET;
  if (!s) throw new Error('KC_JWT_SECRET is not set');
  return new TextEncoder().encode(s);
}

/* ── Password hashing ── */
export function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/* ── Session JWT ── */
export async function signSession(user) {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function verifySession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

/* ── Cookies ── */
export function setSessionCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ];
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function readSessionToken(req) {
  const cookie = req.headers?.cookie || '';
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.slice(COOKIE_NAME.length + 1)) : null;
}

/* ── User lookup + role gates ── */
export async function readSession(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const claims = await verifySession(token);
  if (!claims) return null;
  const db = await getDb();
  const r = await db.query(
    'SELECT id, email, role, display_name, is_active FROM users WHERE id = $1',
    [claims.id],
  );
  if (r.rowCount === 0 || !r.rows[0].is_active) return null;
  return r.rows[0];
}

export async function requireUser(req, res) {
  const user = await readSession(req);
  if (!user) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'Sign in required' } }));
    return null;
  }
  return user;
}

export async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: { code: 'forbidden', message: 'Admin only' } }));
    return null;
  }
  return user;
}

/* ── Audit log ── */
export async function audit({ actor, action, targetType, targetId, payload, req }) {
  try {
    const db = await getDb();
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || req?.socket?.remoteAddress
      || null;
    const ua = req?.headers?.['user-agent'] || null;
    const r = await db.query(
      `INSERT INTO audit_log
         (actor_user_id, actor_email, action, target_type, target_id, payload, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        actor?.id || null,
        actor?.email || (action === 'auth.failed' ? payload?.email : 'anonymous'),
        action,
        targetType || null,
        targetId || null,
        JSON.stringify(payload || {}),
        ip,
        ua,
      ],
    );
    return r.rows[0]; // { id (uuid), created_at }
  } catch (e) {
    /* Audit failures must not break the calling action. */
    console.error('[audit] failed:', e.message);
    return null;
  }
}
