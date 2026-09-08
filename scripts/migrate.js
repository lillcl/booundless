/* Apply schema to a Postgres URL and seed if empty.
   Usage: node scripts/migrate.js [postgresql://…]
   If no URL is passed, uses KC_DATABASE_URL from .env. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.argv[2] || process.env.KC_DATABASE_URL;
if (!URL) { console.error('No DB URL'); process.exit(1); }
const SCHEMA = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

const pool = new pg.Pool({ connectionString: URL, max: 2 });
const client = await pool.connect();
try {
  console.log('Connecting…');
  await client.query(SCHEMA);
  console.log('Schema applied.');

  const seeded = await client.query("SELECT value FROM _meta WHERE key = 'seeded'");
  const count = await client.query('SELECT COUNT(*)::int AS n FROM vehicles');
  if (seeded.rowCount === 0 && count.rows[0].n === 0) {
    console.log('Seeding…');
    const { seedDefaultData } = await import('../api/_lib/db.js');
    await seedDefaultData(pool);
    console.log('Seeded.');
  } else {
    console.log(`Already seeded (${count.rows[0].n} vehicles). Skipping.`);
  }

  const r = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM vehicles)         AS vehicles,
      (SELECT COUNT(*)::int FROM reminders)        AS reminders,
      (SELECT COUNT(*)::int FROM vehicle_status)   AS status_rows
  `);
  console.log('Counts:', r.rows[0]);
} finally {
  client.release();
  await pool.end();
}
