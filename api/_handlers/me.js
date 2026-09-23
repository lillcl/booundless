/* User self-service: profile, data export, account deletion.
   GET    /api/me           — current user (auth required)
   GET    /api/me/export    — JSON document of everything tied to this user
   DELETE /api/me           — soft-delete + anonymise audit log
   All routes require a valid session cookie (SameSite=Strict). */

import { requireUser } from '../_lib/auth.js';
import { sendError, sendJSON } from '../_lib/http.js';
import { getDb } from '../_lib/db.js';
import { audit } from '../_lib/auth.js';

const EXPORT_VERSION = 1;

async function fetchUserRow(db, userId) {
  const r = await db.query(
    `SELECT id, email, role, display_name, is_active, created_at, updated_at
       FROM users WHERE id=$1`,
    [userId]
  );
  return r.rows[0] || null;
}

async function collectExport(db, userId) {
  const userRow = await fetchUserRow(db, userId);
  if (!userRow) return null;
  const ownerRows = (sql) => db.query(sql, [userId]);
  const vehicleRows = await ownerRows(
    `SELECT id, model, make, year, fuel_type, plate, vin, mileage_km, mileage_label,
            image, onboarding_state, onboarding_completed_at, archived_at, created_at, updated_at
       FROM vehicles WHERE created_by_user_id=$1`
  );
  const vehicleIds = vehicleRows.rows.map((v) => v.id);
  const reminderRows = await db.query(
    `SELECT r.id, r.vehicle_id, r.title, r.due_in, r.status, r.created_at
       FROM reminders r
      WHERE r.vehicle_id = ANY($1::text[])`,
    [vehicleIds]
  );
  const historyRows = await db.query(
    `SELECT id, vehicle_id, kind, title, performed_at, mileage_km, cost, notes, created_at
       FROM service_history
      WHERE vehicle_id = ANY($1::text[])`,
    [vehicleIds]
  );
  const tripRows = await db.query(
    `SELECT id, vehicle_id, title, origin, destination, start_at, status, created_at
       FROM trips WHERE created_by_user_id=$1 OR vehicle_id = ANY($2::text[])`,
    [userId, vehicleIds]
  );
  const teams = await db.query(
    `SELECT t.id, t.name, tm.role, t.created_at
       FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.user_id=$1`,
    [userId]
  );
  const prefs = await db.query(
    `SELECT maintenance_reminders, trip_updates, ai_suggestions, updated_at
       FROM user_notification_preferences WHERE user_id=$1`, [userId]
  );
  const dealerMemberships = await db.query(
    `SELECT dm.dealer_id, dm.role, dm.created_at FROM dealer_members dm WHERE dm.user_id=$1`, [userId]
  );
  const auditRows = await db.query(
    `SELECT id, action, target_type, target_id, created_at, ip
       FROM audit_log WHERE actor_user_id=$1 ORDER BY created_at DESC LIMIT 1000`, [userId]
  );

  return {
    export_version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    user: userRow,
    vehicles: vehicleRows.rows,
    reminders: reminderRows.rows,
    service_history: historyRows.rows,
    trips: tripRows.rows,
    teams: teams.rows,
    notification_preferences: prefs.rows,
    dealer_memberships: dealerMemberships.rows,
    audit_log: auditRows.rows,
  };
}

export default async function handler(req, res) {
  const url = (req.url || '').replace(/\/+$/, '');
  const user = await requireUser(req, res);
  if (!user) return;
  const db = await getDb();

  try {
    if (req.method === 'GET' && (url === '/api/me' || url === '/api/me/')) {
      const row = await fetchUserRow(db, user.id);
      if (!row) return sendError(res, 404, 'not_found', 'User no longer exists.');
      return sendJSON(res, 200, { data: row, count: 1 });
    }

    if (req.method === 'GET' && url === '/api/me/export') {
      const payload = await collectExport(db, user.id);
      if (!payload) return sendError(res, 404, 'not_found', 'User no longer exists.');
      const filename = `kc-carai-export-${user.id}-${Date.now()}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      return sendJSON(res, 200, payload);
    }

    if (req.method === 'DELETE' && (url === '/api/me' || url === '/api/me/')) {
      // Two-step confirmation: caller must send header `x-confirm-delete: yes`
      // so accidental API replays cannot wipe the account.
      if (req.headers['x-confirm-delete'] !== 'yes') {
        return sendError(res, 422, 'unprocessable', 'Confirm by sending header "X-Confirm-Delete: yes".');
      }
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        // Soft-delete the user; FKs are ON DELETE SET NULL so history stays for audit.
        await client.query('UPDATE users SET is_active=FALSE, email=$2, display_name=$3, password_hash=$4, updated_at=NOW() WHERE id=$1',
          [user.id, `deleted-${user.id}@example.invalid`, '已刪除帳號', '!deactivated']);
        // Anonymise audit_log so the actor email is not retained.
        await client.query(`UPDATE audit_log SET actor_email=$2, actor_user_id=NULL WHERE actor_user_id=$1`, [user.id, 'deleted-account']);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
      // Clear the session after commit; do not record the former email again.
      res.setHeader('Set-Cookie',
        'kc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' +
        (process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '')
      );
      await audit({ actor: { id: null, email: 'deleted-account', role: user.role }, action: 'user.self_delete', targetType: 'user', targetId: user.id });
      return sendJSON(res, 200, { data: { status: 'deactivated' }, count: 1 });
    }

    return sendError(res, 405, 'method_not_allowed', 'Method not allowed.');
  } catch (err) {
    console.error('[me]', err);
    return sendError(res, 500, 'internal_error', 'Internal error.');
  }
}
