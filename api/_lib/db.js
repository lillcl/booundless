/* Postgres connection + auto-apply schema + auto-seed.
   Single shared pool per process. */

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _pool = null;

function resolveDatabaseUrl() {
  /* Supabase is the configured cloud database for this deployment. Keep
     KC_DATABASE_URL as an explicit fallback for local Postgres. */
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  if (process.env.KC_DATABASE_URL) return process.env.KC_DATABASE_URL;
  /* Local Postgres defaults — matches the database created in the README. */
  return 'postgresql://kc_app:kc_dev_password@127.0.0.1:5432/kc_carai';
}

function resolveSchemaPath() {
  return join(__dirname, '..', '..', 'db', 'schema.sql');
}

async function applySchema(pool) {
  const sql = readFileSync(resolveSchemaPath(), 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

async function rowCount(pool, table) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function archiveLegacyDemoVehicles(pool) {
  /* Keep old seed rows for referential integrity, but remove them from every
     current user/admin/agent view. The public /demo page owns the only demo
     vehicle now. */
  await pool.query(`UPDATE vehicles
    SET archived_at = NOW(), updated_at = NOW()
    WHERE id IN ('bmw', 'tesla') AND archived_at IS NULL`);
}

async function seedDefaultData(pool) {
  const now = new Date().toISOString();

  await pool.query(`
    INSERT INTO vehicles (id, model, make, year, fuel_type, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at)
    VALUES
      ('toyota', 'Toyota Corolla Cross', 'Toyota', 2021, 'Hybrid', 'MA-23-88', 42680, '42,680 km', '/assets/vehicle-toyota.jpg', 'Demo', 'demo', $1, $1)
    ON CONFLICT (id) DO NOTHING
  `, [now]);

  /* Backfill identity fields for legacy seeded rows created before dealer
     matching was introduced. User-entered values are left untouched. */
  await pool.query(`UPDATE vehicles SET make='Toyota',year=2021,fuel_type='Hybrid' WHERE id='toyota' AND make IS NULL`);

  await pool.query(`
    INSERT INTO reminders (id, vehicle_id, kind, title, due_in, icon, status, created_at, updated_at)
    VALUES
      ('r-toyota-oil', 'toyota', 'oil',   'Corolla Cross · 機油及機油隔', '約 1,320 km 後', 'oil',   'upcoming', $1, $1)
  `, [now]);

  /* Maintenance spec per vehicle. wear is 0..100 — at 100 the item is due. */
  const statusRows = [
    /* Toyota Corolla Cross — 2021, 1.8 Hybrid, 42,680 km */
    ['toyota', '機油及機油隔', 10000, 12, 38680, '2026-06-12', 60, 1],
    ['toyota', '煞車油',        40000, 24, 27000, '2024-08-04', 70, 2],
    ['toyota', '煞車皮',        50000, null, 18000, '2024-02-18', 50, 3],
    ['toyota', '波箱油',        80000, 48, 12000, '2023-05-09', 38, 4],
    ['toyota', '冷卻液',       100000, 48, 22000, '2024-04-02', 21, 5],
    ['toyota', '火星塞',       100000, 60, 18000, '2024-02-18', 25, 6],
    ['toyota', '空氣濾芯',      20000, 12, 34200, '2026-02-03', 42, 7],
    ['toyota', '冷氣濾芯',      20000, 12, 22000, '2024-04-02', 99, 8],
    ['toyota', '12V 電瓶',     null,   48, null,  '2022-09-14', 88, 9],
  ];

  for (const [vid, item, ikm, im, ldkm, ld, wear, ord] of statusRows) {
    await pool.query(
      `INSERT INTO vehicle_status
        (vehicle_id, item, interval_km, interval_months, last_done_km, last_done_at, wear, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [vid, item, ikm, im, ldkm, ld, wear, ord],
    );
  }

  /* Service history (recent completed jobs). Used by the home page "最近" list
     and the detail page "保養紀錄" section. */
  const historyRows = [
    ['h-toyota-1', 'toyota', '2026-06-12T10:00:00Z', 'oil', '機油及機油隔', '5W-30 全合成', 'MOP 980', 38420],
    ['h-toyota-2', 'toyota', '2026-02-03T14:30:00Z', 'filter', '塵格', '原廠件', 'MOP 230', 34200],
    ['h-toyota-3', 'toyota', '2025-08-19T09:00:00Z', 'tire', '輪胎調位', '前後對調', 'MOP 280', 28800],
  ];
  for (const row of historyRows) {
    await pool.query(`INSERT INTO service_history
      (id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, row);
  }

  await pool.query(
    "INSERT INTO _meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
  );
}

export async function getDb() {
  if (_pool) return _pool;

  const url = resolveDatabaseUrl();
  const isSupabase = /supabase\.(co|com)$/i.test(new URL(url).hostname) || /pooler\.supabase\.com$/i.test(new URL(url).hostname);
  _pool = new pg.Pool({
    connectionString: url,
    max: 4,
    ...(isSupabase ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  try {
    await applySchema(_pool);
    const seeded = await _pool.query("SELECT value FROM _meta WHERE key = 'seeded'");
    const count = await rowCount(_pool, 'vehicles');
    if (seeded.rowCount === 0 && count === 0) await seedDefaultData(_pool);
    await archiveLegacyDemoVehicles(_pool);
    return _pool;
  } catch (error) {
    const failedPool = _pool;
    _pool = null;
    await failedPool.end().catch(() => {});
    throw error;
  }
}

export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
