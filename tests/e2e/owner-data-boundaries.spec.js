import 'dotenv/config';
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { login, openDb, closeDb, seedUser, seedVehicle, cleanupVehicle, cleanupUsers } from './_helpers/auth.js';

const PASSWORD = 'Pipeline-e2e-2026!';

test('recent history and trips are visible only to their vehicle owner', async ({ browser }) => {
  const suffix = randomUUID();
  const db = await openDb();
  const owner = await seedUser(db, `boundary-owner-${suffix}`, PASSWORD);
  const other = await seedUser(db, `boundary-other-${suffix}`, PASSWORD);
  const vehicleId = await seedVehicle(db, suffix, owner.userId);
  const historyId = `boundary-history-${suffix}`;
  await db.query(`INSERT INTO service_history(id,vehicle_id,performed_at,kind,title,mileage_km)
    VALUES($1,$2,NOW(),'maintenance','Private test record',42000)`, [historyId, vehicleId]);
  const ownerContext = await browser.newContext();
  const otherContext = await browser.newContext();
  const anonymousContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const otherPage = await otherContext.newPage();
  const anonymousPage = await anonymousContext.newPage();
  let tripId;
  try {
    await login(ownerPage, owner.email, PASSWORD);
    await login(otherPage, other.email, PASSWORD);
    await anonymousPage.goto('/');
    const anon = await anonymousPage.evaluate(() => fetch('/api/history/recent').then(r => r.status));
    expect(anon).toBe(401);

    const ownerHistory = await ownerPage.evaluate(() => fetch('/api/history/recent').then(r => r.json()));
    const otherHistory = await otherPage.evaluate(() => fetch('/api/history/recent').then(r => r.json()));
    expect(ownerHistory.data.some(row => row.id === historyId)).toBe(true);
    expect(otherHistory.data.some(row => row.id === historyId)).toBe(false);

    const created = await ownerPage.evaluate(async id => {
      const r = await fetch('/api/trips', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Private trip', origin: 'Macau', destination: 'Hengqin', vehicle_id: id }) });
      return { status: r.status, body: await r.json() };
    }, vehicleId);
    expect(created.status).toBe(201);
    tripId = created.body.id;

    const otherTrips = await otherPage.evaluate(() => fetch('/api/trips').then(r => r.json()));
    expect(otherTrips.data.some(row => row.id === tripId)).toBe(false);
    const crossVehicle = await otherPage.evaluate(async id => {
      const r = await fetch('/api/trips', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Intruder trip', origin: 'Macau', destination: 'Hengqin', vehicle_id: id }) });
      return r.status;
    }, vehicleId);
    expect(crossVehicle).toBe(404);
    const crossDelete = await otherPage.evaluate(id => fetch(`/api/trips/${id}`, { method: 'DELETE' }).then(r => r.status), tripId);
    expect(crossDelete).toBe(404);
  } finally {
    if (tripId) await db.query('DELETE FROM trips WHERE id=$1', [tripId]);
    await cleanupVehicle(db, vehicleId);
    await cleanupUsers(db, [owner.email, other.email]);
    await closeDb();
    await ownerContext.close();
    await otherContext.close();
    await anonymousContext.close();
  }
});
