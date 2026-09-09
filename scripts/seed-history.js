/* Insert service history records (idempotent).
   Used to backfill data after a schema change. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();
import pg from 'pg';

const URL = process.argv[2] || process.env.KC_DATABASE_URL;
if (!URL) { console.error('No DB URL'); process.exit(1); }

const pool = new pg.Pool({ connectionString: URL, max: 2 });
const client = await pool.connect();

const rows = [
  ['h-toyota-1', 'toyota', '2026-06-12T10:00:00Z', 'oil',    '機油及機油隔', '5W-30 全合成',  'MOP 980',   38420],
  ['h-toyota-2', 'toyota', '2026-02-03T14:30:00Z', 'filter', '塵格',        '原廠件',        'MOP 230',   34200],
  ['h-toyota-3', 'toyota', '2025-08-19T09:00:00Z', 'tire',   '輪胎調位',    '前後對調',      'MOP 280',   28800],
  ['h-bmw-1',    'bmw',    '2026-05-21T11:00:00Z', 'oil',    '機油及機油隔', '5W-40 LL-04',   'MOP 1,180', 28200],
  ['h-bmw-2',    'bmw',    '2025-11-04T15:00:00Z', 'filter', '空氣濾芯',     '原廠件',        'MOP 420',   22100],
  ['h-bmw-3',    'bmw',    '2025-04-22T10:30:00Z', 'brake',  '煞車油',       'DOT 5.1',       'MOP 680',   17600],
  ['h-tesla-1',  'tesla',  '2025-11-12T13:00:00Z', 'tire',   '輪胎調位',     '前後對調+四輪平衡', 'MOP 380',   12000],
  ['h-tesla-2',  'tesla',  '2025-06-08T16:00:00Z', 'inspect','底盤檢查',     '底盤+煞車+冷卻液', 'MOP 1,500', 9600],
];

try {
  for (const r of rows) {
    await client.query(
      `INSERT INTO service_history (id, vehicle_id, performed_at, kind, title, notes, cost, mileage_km)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         performed_at = EXCLUDED.performed_at,
         title        = EXCLUDED.title,
         notes        = EXCLUDED.notes,
         cost         = EXCLUDED.cost,
         mileage_km   = EXCLUDED.mileage_km`,
      r,
    );
  }
  const c = await client.query('SELECT COUNT(*)::int AS n FROM service_history');
  console.log(`Inserted/updated ${rows.length} service history rows. Total in DB: ${c.rows[0].n}.`);
} finally {
  client.release();
  await pool.end();
}
