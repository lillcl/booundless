/* SQLite helper used by both serverless handlers (api/_lib/db.js) and the
   seed script (db/seed.js). Connects lazily; auto-creates schema if missing;
   single shared connection per process. */

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

function resolveDbPath() {
  // Default: <repo>/db/dev.db. Override with KC_DB_PATH env var.
  return process.env.KC_DB_PATH || join(__dirname, '..', '..', 'db', 'dev.db');
}

function resolveSchemaPath() {
  return join(__dirname, '..', '..', 'db', 'schema.sql');
}

function applySchema(db) {
  const sql = readFileSync(resolveSchemaPath(), 'utf8');
  db.exec(sql);
}

function rowCount(db, table) {
  return db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get().n;
}

export function getDb() {
  if (_db) return _db;

  const path = resolveDbPath();
  const isNew = !existsSync(path);
  _db = new Database(path);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  applySchema(_db);

  // Auto-seed on first run if tables are empty.
  const seededFlag = _db.prepare(
    "SELECT value FROM _meta WHERE key = 'seeded'"
  ).get();
  if (!seededFlag && rowCount(_db, 'vehicles') === 0) {
    seedDefaultData(_db);
    _db.prepare(
      "INSERT OR REPLACE INTO _meta (key, value) VALUES ('seeded', '1')"
    ).run();
  }

  return _db;
}

function seedDefaultData(db) {
  const now = new Date().toISOString();

  const insertVehicle = db.prepare(`
    INSERT INTO vehicles (id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertVehicle.run('toyota', 'Toyota Corolla Cross', 'MA-23-88', 42680, '42,680 km',
    '/assets/vehicle-toyota.jpg', 'Isaac', 'isaac', now, now);
  insertVehicle.run('bmw', 'BMW 320i', 'MP-81-26', 31200, '31,200 km',
    '/assets/vehicle-bmw.jpg', 'Isaac', 'company', now, now);
  insertVehicle.run('tesla', 'Tesla Model Y', 'MZ-18-54', 18540, '18,540 km',
    '/assets/vehicle-tesla.jpg', 'Isaac', 'family', now, now);

  const insertReminder = db.prepare(`
    INSERT INTO reminders (id, vehicle_id, kind, title, due_in, icon, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertReminder.run('r-toyota-oil', 'toyota', 'oil',
    'Corolla Cross · 機油及機油隔', '約 1,320 km 後', 'oil', 'upcoming', now, now);
  insertReminder.run('r-bmw-brake', 'bmw', 'brake',
    'BMW 320i · 煞車油', '約 1 個月內', 'brake', 'upcoming', now, now);

  /* Maintenance spec per vehicle. `wear` is 0..100 — at 100 the item is due
     for service. Display order is preserved for stable rendering. */

  const insertStatus = db.prepare(`
    INSERT INTO vehicle_status
      (vehicle_id, item, interval_km, interval_months, last_done_km, last_done_at, wear, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  /* Toyota Corolla Cross — 2021, 1.8 Hybrid, 42,680 km */
  insertStatus.run('toyota', '機油及機油隔', 10000, 12, 38680, '2026-06-12', 60, 1);
  insertStatus.run('toyota', '煞車油', 40000, 24, 27000, '2024-08-04', 70, 2);
  insertStatus.run('toyota', '煞車皮', 50000, null, 18000, '2024-02-18', 50, 3);
  insertStatus.run('toyota', '波箱油', 80000, 48, 12000, '2023-05-09', 38, 4);
  insertStatus.run('toyota', '冷卻液', 100000, 48, 22000, '2024-04-02', 21, 5);
  insertStatus.run('toyota', '火星塞', 100000, 60, 18000, '2024-02-18', 25, 6);
  insertStatus.run('toyota', '空氣濾芯', 20000, 12, 34200, '2026-02-03', 42, 7);
  insertStatus.run('toyota', '冷氣濾芯', 20000, 12, 22000, '2024-04-02', 99, 8);
  insertStatus.run('toyota', '12V 電瓶', null, 48, null, '2022-09-14', 88, 9);

  /* BMW 320i — 2019, 2.0 Turbo, 31,200 km */
  insertStatus.run('bmw', '機油及機油隔', 10000, 12, 28200, '2026-05-21', 30, 1);
  insertStatus.run('bmw', '煞車油', 40000, 24, 12000, '2024-03-15', 95, 2);
  insertStatus.run('bmw', '煞車皮', 45000, null, 12000, '2024-03-15', 42, 3);
  insertStatus.run('bmw', '波箱油', 60000, 48, null, null, 52, 4);
  insertStatus.run('bmw', '冷卻液', 80000, 48, null, '2023-04-10', 39, 5);
  insertStatus.run('bmw', '火星塞', 40000, 48, null, '2023-04-10', 78, 6);
  insertStatus.run('bmw', '空氣濾芯', 20000, 12, 21000, '2025-11-04', 51, 7);
  insertStatus.run('bmw', '冷氣濾芯', 20000, 12, 21000, '2025-11-04', 51, 8);
  insertStatus.run('bmw', '12V 電瓶', null, 48, null, '2022-08-19', 92, 9);

  /* Tesla Model Y — 2023, Electric, 18,540 km */
  insertStatus.run('tesla', '輪胎', 15000, 6, 12000, '2025-11-12', 44, 1);
  insertStatus.run('tesla', '12V 電瓶', null, 48, null, '2023-06-10', 71, 2);
  insertStatus.run('tesla', '煞車油', 40000, 24, null, '2023-06-10', 32, 3);
  insertStatus.run('tesla', '煞車卡鉗保養', 20000, 12, 12000, '2025-11-12', 28, 4);
  insertStatus.run('tesla', 'HEPA 濾芯', 20000, 24, null, null, 93, 5);
  insertStatus.run('tesla', '冷卻液（驅動單元）', 80000, 96, null, '2023-06-10', 4, 6);
  insertStatus.run('tesla', '車身及底盤檢查', null, 12, null, '2024-09-22', 65, 7);
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}