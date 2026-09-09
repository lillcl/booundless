/* GET    /api/users        — list users (admin)
   POST   /api/users        — create user (admin)
   PATCH  /api/users/:id    — update role / password / display_name (admin)
   DELETE /api/users/:id    — soft-delete (admin)
   Every mutation writes to audit_log. */

import { hashPassword, requireAdmin, audit } from './_lib/auth.js';
import { sendError, sendJSON, onlyMethod, readBody } from './_lib/http.js';
import { getDb } from './_lib/db.js';

function sanitize(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    display_name: u.display_name,
    is_active: u.is_active,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

export default async function handler(req, res) {
  const url = req.url || '';

  /* Single-user operations: PATCH, DELETE */
  const idMatch = url.match(/^\/api\/users\/([^/?#]+)\/?$/);
  if (idMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const id = decodeURIComponent(idMatch[1]);
    return await handleOne(req, res, id, admin);
  }

  /* List or create */
  if (req.method === 'GET' || req.method === 'POST') {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (req.method === 'GET') return await handleList(req, res, admin);
    if (req.method === 'POST') return await handleCreate(req, res, admin);
  }

  sendError(res, 405, 'method_not_allowed', 'Method not allowed');
}

async function handleList(req, res, admin) {
  const db = await getDb();
  const r = await db.query(
    `SELECT id, email, role, display_name, is_active, created_at, updated_at
     FROM users ORDER BY created_at ASC`,
  );
  sendJSON(res, 200, { data: r.rows.map(sanitize), count: r.rowCount });
  await audit({ actor: admin, action: 'user.list', req });
}

async function handleCreate(req, res, admin) {
  const body = await readBody(req);
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  const role = body?.role === 'admin' ? 'admin' : 'user';
  const display_name = body?.display_name ? String(body.display_name).slice(0, 80) : null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendError(res, 422, 'unprocessable', 'Valid email required');
  }
  if (password.length < 6) {
    return sendError(res, 422, 'unprocessable', 'Password must be at least 6 characters');
  }

  const password_hash = await hashPassword(password);
  const id = `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const db = await getDb();
  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rowCount > 0) {
    return sendError(res, 409, 'conflict', 'Email already in use');
  }
  const r = await db.query(
    `INSERT INTO users (id, email, password_hash, role, display_name)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, display_name, is_active, created_at, updated_at`,
    [id, email, password_hash, role, display_name],
  );
  const user = r.rows[0];
  await audit({
    actor: admin,
    action: 'user.create',
    targetType: 'user',
    targetId: user.id,
    payload: { before: null, after: sanitize(user), fields_changed: ['email', 'role', 'display_name', 'password'] },
    req,
  });
  sendJSON(res, 201, { user: sanitize(user) });
}

async function handleOne(req, res, id, admin) {
  if (id === admin.id && req.method === 'DELETE') {
    return sendError(res, 422, 'unprocessable', 'Cannot delete yourself');
  }
  const db = await getDb();
  const before = await db.query(
    'SELECT id, email, role, display_name, is_active FROM users WHERE id = $1',
    [id],
  );
  if (before.rowCount === 0) return sendError(res, 404, 'not_found', `User ${id} not found`);
  const beforeUser = before.rows[0];

  if (req.method === 'DELETE') {
    await db.query('UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    await audit({
      actor: admin,
      action: 'user.delete',
      targetType: 'user',
      targetId: id,
      payload: { before: { id: beforeUser.id, email: beforeUser.email }, soft: true },
      req,
    });
    return sendJSON(res, 200, { ok: true });
  }

  /* PATCH */
  const body = await readBody(req);
  const fields = [];
  const values = [];
  const changed = [];
  let i = 1;

  if (body?.role !== undefined) {
    const role = body.role === 'admin' ? 'admin' : 'user';
    if (role !== beforeUser.role) {
      fields.push(`role = $${i++}`); values.push(role); changed.push('role');
    }
  }
  if (body?.display_name !== undefined) {
    const dn = body.display_name ? String(body.display_name).slice(0, 80) : null;
    if (dn !== beforeUser.display_name) {
      fields.push(`display_name = $${i++}`); values.push(dn); changed.push('display_name');
    }
  }
  if (body?.is_active !== undefined) {
    const act = !!body.is_active;
    if (act !== beforeUser.is_active) {
      fields.push(`is_active = $${i++}`); values.push(act); changed.push('is_active');
    }
  }
  if (body?.password) {
    if (String(body.password).length < 6) {
      return sendError(res, 422, 'unprocessable', 'Password must be at least 6 characters');
    }
    fields.push(`password_hash = $${i++}`);
    values.push(await hashPassword(String(body.password)));
    changed.push('password');
  }

  if (fields.length === 0) {
    return sendJSON(res, 200, { user: sanitize({ ...beforeUser, created_at: null, updated_at: null }) });
  }
  fields.push(`updated_at = NOW()`);
  values.push(id);
  const r = await db.query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, email, role, display_name, is_active, created_at, updated_at`,
    values,
  );
  const after = r.rows[0];
  await audit({
    actor: admin,
    action: 'user.update',
    targetType: 'user',
    targetId: id,
    payload: { before: beforeUser, after: sanitize(after), fields_changed: changed },
    req,
  });
  sendJSON(res, 200, { user: sanitize(after) });
}
