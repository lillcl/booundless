/* Postgres connection + auto-apply schema + auto-seed.
   Single shared pool per process. */

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let _pool = null;

function resolveDatabaseUrl() {
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

async function seedDefaultData(pool) {
  const now = new Date().toISOString();

  await pool.query(`
    INSERT INTO vehicles (id, model, plate, mileage_km, mileage_label, image, owner, team, created_at, updated_at)
    VALUES
      ('toyota', 'Toyota Corolla Cross', 'MA-23-88', 42680, '42,680 km', '/assets/vehicle-toyota.jpg', 'Isaac', 'isaac', $1, $1),
      ('bmw',    'BMW 320i',            'MP-81-26', 31200, '31,200 km', '/assets/vehicle-bmw.jpg',    'Isaac', 'company', $1, $1),
      ('tesla',  'Tesla Model Y',       'MZ-18-54', 18540, '18,540 km', '/assets/vehicle-tesla.jpg',  'Isaac', 'family', $1, $1)
  `, [now]);

  await pool.query(`
    INSERT INTO reminders (id, vehicle_id, kind, title, due_in, icon, status, created_at, updated_at)
    VALUES
      ('r-toyota-oil', 'toyota', 'oil',   'Corolla Cross · 機油及機油隔', '約 1,320 km 後', 'oil',   'upcoming', $1, $1),
      ('r-bmw-brake',  'bmw',    'brake', 'BMW 320i · 煞車油',           '約 1 個月內',   'brake', 'upcoming', $1, $1)
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
    /* BMW 320i — 2019, 2.0 Turbo, 31,200 km */
    ['bmw',    '機油及機油隔', 10000, 12, 28200, '2026-05-21', 30, 1],
    ['bmw',    '煞車油',        40000, 24, 12000, '2024-03-15', 95, 2],
    ['bmw',    '煞車皮',        45000, null, 12000, '2024-03-15', 42, 3],
    ['bmw',    '波箱油',        60000, 48, null,  null,         52, 4],
    ['bmw',    '冷卻液',        80000, 48, null,  '2023-04-10', 39, 5],
    ['bmw',    '火星塞',        40000, 48, null,  '2023-04-10', 78, 6],
    ['bmw',    '空氣濾芯',      20000, 12, 21000, '2025-11-04', 51, 7],
    ['bmw',    '冷氣濾芯',      20000, 12, 21000, '2025-11-04', 51, 8],
    ['bmw',    '12V 電瓶',     null,   48, null,  '2022-08-19', 92, 9],
    /* Tesla Model Y — 2023, Electric, 18,540 km */
    ['tesla',  '輪胎',          15000, 6,  12000, '2025-11-12', 44, 1],
    ['tesla',  '12V 電瓶',     null,   48, null,  '2023-06-10', 71, 2],
    ['tesla',  '煞車油',        40000, 24, null,  '2023-06-10', 32, 3],
    ['tesla',  '煞車卡鉗保養',  20000, 12, 12000, '2025-11-12', 28, 4],
    ['tesla',  'HEPA 濾芯',     20000, 24, null,  null,         93, 5],
    ['tesla',  '冷卻液（驅動單元）', 80000, 96, null, '2023-06-10', 4, 6],
    ['tesla',  '車身及底盤檢查', null,   12, null,  '2024-09-22', 65, 7],
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
  const insertHistory = db.prepare(`
    INSERT INTO service_history (id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  /* Toyota Corolla Cross */
  insertHistory.run('h-toyota-1', 'toyota', '2026-06-12T10:00:00Z', 'oil',     '機油及機油隔', '5W-30 全合成',  'MOP 980',  38420);
  insertHistory.run('h-toyota-2', 'toyota', '2026-02-03T14:30:00Z', 'filter',  '塵格',        '原廠件',        'MOP 230',  34200);
  insertHistory.run('h-toyota-3', 'toyota', '2025-08-19T09:00:00Z', 'tire',    '輪胎調位',    '前後對調',      'MOP 280',  28800);

  /* BMW 320i */
  insertHistory.run('h-bmw-1',    'bmw',    '2026-05-21T11:00:00Z', 'oil',     '機油及機油隔', '5W-40 LL-04',   'MOP 1,180', 28200);
  insertHistory.run('h-bmw-2',    'bmw',    '2025-11-04T15:00:00Z', 'filter',  '空氣濾芯',     '原廠件',        'MOP 420',  22100);
  insertHistory.run('h-bmw-3',    'bmw',    '2025-04-22T10:30:00Z', 'brake',   '煞車油',       'DOT 5.1',       'MOP 680',  17600);

  /* Tesla Model Y */
  insertHistory.run('h-tesla-1',  'tesla',  '2025-11-12T13:00:00Z', 'tire',    '輪胎調位',     '前後對調+四輪平衡', 'MOP 380',  12000);
  insertHistory.run('h-tesla-2',  'tesla',  '2025-06-08T16:00:00Z', 'inspect', '底盤檢查',     '底盤+煞車+冷卻液', 'MOP 1,500', 9600);

  await pool.query(
    "INSERT INTO _meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
  );
}

export async function getDb() {
  if (_pool) return _pool;

  const url = resolveDatabaseUrl();
  _pool = new pg.Pool({ connectionString: url, max: 4 });

  await applySchema(_pool);

  const seeded = await _pool.query("SELECT value FROM _meta WHERE key = 'seeded'");
  const count = await rowCount(_pool, 'vehicles');
  if (seeded.rowCount === 0 && count === 0) {
    await seedDefaultData(_pool);
  }

  return _pool;
}

export async function closeDb() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
