/* Apply the app's schema outside request handling.
   Usage: node scripts/migrate.js [--seed-demo]
   Uses SUPABASE_DB_URL or KC_DATABASE_URL.
   Per spec §12: production request path MUST NOT execute DDL/seed. Run this
   script via CI/CD before deploy. The migration runner is ledger-aware
   (scripts/_lib/migrations.js) — re-running it on a healthy DB is a no-op. */
import 'dotenv/config';
import { runMigrations } from './_lib/migrations.js';
import { seedShopCatalog } from '../db/shop-catalog.js';
import pg from 'pg';

const seedDemo = process.argv.includes('--seed-demo');

const result = await runMigrations({ verbose: true });
if (!result.ok) throw new Error('migration failed');

if (seedDemo) {
  const url = process.env.SUPABASE_DB_URL || process.env.KC_DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or KC_DATABASE_URL required to seed demo data');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [42420260921]);
    await seedShopCatalog(client);
    if (process.env.KC_DEMO_SEED !== '0' && process.env.DEMO_SEED_ENABLED !== '0') {
      const seeded = await client.query("SELECT value FROM _meta WHERE key='seeded'");
      const count = await client.query('SELECT COUNT(*)::int AS n FROM vehicles');
      if (!seeded.rowCount && count.rows[0].n === 0) {
        const { seedDefaultData } = await import('../api/_lib/db.js');
        await seedDefaultData(client);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
