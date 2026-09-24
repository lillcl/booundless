/* Shared browser/DB helpers for the BOOUNDLESS e2e specs. Each spec still
 * owns its own fixtures (randomUUID() suffixed ids) and cleanup, but the
 * navigation, login, logout, and seeding helpers live here so the suite
 * does not drift.
 */

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { getDb } from '../../../api/_lib/db.js';
import { hashPassword } from '../../../api/_lib/auth.js';

export async function login(page, email, password) {
  await page.goto('/#/login');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 15_000 });
}

export async function signup(page, name, email, password) {
  await page.goto('/#/register');
  await page.locator('#registerName').fill(name);
  await page.locator('#registerEmail').fill(email);
  await page.locator('#registerPassword').fill(password);
  await page.locator('#registerPasswordConfirm').fill(password);
  await page.getByRole('button', { name: '建立帳號並登入' }).click();
  await expect(page).toHaveURL(/#\/home$/, { timeout: 15_000 });
}

export async function logout(page) {
  /* Close any open modal that may intercept clicks on the topbar signout. */
  await page.evaluate(() => {
    document.querySelectorAll('.vp-reader.is-open').forEach((el) => el.remove());
    document.querySelectorAll('.vp-editor.is-open').forEach((el) => el.remove());
    document.body.style.overflow = '';
  });
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await page.goto('/#/landing');
  await expect(page.locator('.kc-topbar')).toBeVisible({ timeout: 5_000 });
}

export async function retryDeadlock(operation) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (error?.code !== '40P01' || attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
}

/* ── DB seeding helpers ──────────────────────────────────────────────── */

export async function seedDealerWithStaff(db, suffix, password, staffRole = 'staff', displayName = `可信車商 ${suffix.slice(0, 8)}`) {
  const dealerId = `d-pipe-${suffix}`;
  const staffId = `u-staff-${suffix}`;
  const passwordHash = await hashPassword(password);
  const staffEmail = `staff-${suffix}@example.test`;
  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name)
     VALUES ($1,$2,$3,'user','Pipeline Dealer Staff')`,
    [staffId, staffEmail, passwordHash],
  );
  await db.query(
    `INSERT INTO dealers(id,display_name,legal_name,status,created_by_user_id)
     VALUES ($1,$2,$2,'active',$3)`,
    [dealerId, displayName, staffId],
  );
  await db.query(
    `INSERT INTO dealer_members(dealer_id,user_id,role) VALUES ($1,$2,$3)`,
    [dealerId, staffId, staffRole],
  );
  return { dealerId, staffId, staffEmail, staffRole, dealerDisplayName: displayName };
}

export async function seedUser(db, suffix, password, role = 'user', displayName = 'Test User') {
  const userId = `u-${suffix}`;
  const email = `${role}-${suffix}@example.test`;
  await db.query(
    `INSERT INTO users(id,email,password_hash,role,display_name)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, email, await hashPassword(password), role, displayName],
  );
  return { userId, email };
}

export async function seedVehicle(db, suffix, ownerId) {
  const vehicleId = `v-${suffix}`;
  await retryDeadlock(() => db.query(
    `INSERT INTO vehicles
       (id,model,make,year,fuel_type,onboarding_state,plate,mileage_km,mileage_label,image,owner,team,created_by_user_id,updated_by_user_id)
     VALUES ($1,'Corolla','Toyota',2021,'燃油','ready',$2,42000,'42,000 km','/assets/vehicle-placeholder.svg','Test Owner','personal',$3,$3)`,
    [vehicleId, `MX-${suffix.slice(0, 6)}`, ownerId],
  ));
  await retryDeadlock(() => db.query(
    `INSERT INTO vehicle_status
       (vehicle_id,item,service_item_type_key,interval_km,interval_months,wear,display_order,source)
     VALUES ($1,'機油及機油隔','oil_filter',10000,12,0,1,'template')`,
    [vehicleId],
  ));
  return vehicleId;
}

export async function cleanupVehicle(db, vehicleId) {
  if (!vehicleId) return;
  await retryDeadlock(() => db.query(`DELETE FROM service_history WHERE vehicle_id = $1`, [vehicleId]));
  await retryDeadlock(() => db.query(`DELETE FROM vehicle_status WHERE vehicle_id = $1`, [vehicleId]));
  await retryDeadlock(() => db.query(`DELETE FROM vehicle_dealer_grants WHERE vehicle_id = $1`, [vehicleId]));
  await retryDeadlock(() => db.query(`DELETE FROM vehicle_needs WHERE vehicle_id = $1`, [vehicleId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_service_requests WHERE vehicle_id = $1`, [vehicleId]));
  await retryDeadlock(() => db.query(`DELETE FROM vehicles WHERE id = $1`, [vehicleId]));
}

export async function cleanupDealer(db, dealerId) {
  if (!dealerId) return;
  await retryDeadlock(() => db.query(`DELETE FROM dealer_request_items WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id = $1)`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_request_events WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id = $1)`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_quotes WHERE request_id IN (SELECT id FROM dealer_service_requests WHERE dealer_id = $1)`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_service_requests WHERE dealer_id = $1`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_item_fitments WHERE dealer_service_item_id IN (SELECT id FROM dealer_service_items WHERE dealer_id = $1)`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_branch_services WHERE branch_id IN (SELECT id FROM dealer_branches WHERE dealer_id = $1)`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_service_items WHERE dealer_id = $1`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_package_items WHERE package_id IN (SELECT id FROM dealer_service_packages WHERE dealer_id = $1)`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_service_packages WHERE dealer_id = $1`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_branches WHERE dealer_id = $1`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealer_members WHERE dealer_id = $1`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM vehicle_item_matches WHERE dealer_id = $1`, [dealerId]));
  await retryDeadlock(() => db.query(`DELETE FROM dealers WHERE id = $1`, [dealerId]));
}

export async function cleanupUsers(db, emails) {
  if (!emails?.length) return;
  await retryDeadlock(() => db.query(`DELETE FROM audit_log WHERE actor_email = ANY($1::text[])`, [emails]));
  await retryDeadlock(() => db.query(`DELETE FROM user_notification_preferences WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))`, [emails]));
  await retryDeadlock(() => db.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]));
}

/* Convenience: open a fresh DB connection for a spec. */
export async function openDb() {
  return await getDb();
}
export { closeDb } from '../../../api/_lib/db.js';