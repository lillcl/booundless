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
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}