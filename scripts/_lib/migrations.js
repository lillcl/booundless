/* Migration ledger: a small table that records which schema slices have been
   applied. Replaces the prior "trust _meta.schema_version" pattern so that
   additive slices can land independently without forcing every cold start to
   re-run DDL.

   Production path (per spec §12): request handlers never execute this module.
   Operators run `node scripts/migrate.js` before deploys and again on each
   deploy via the CI deploy job. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, '..', '..', 'db');
const ADVISORY_LOCK_KEY = 42420260921;

const BASE_SCHEMA_FILE = 'schema.sql';
const MVP_SCHEMA_FILE = 'service-mvp-schema.sql';

// Additive slices applied after the base schema. Order MUST match
// api/_lib/db.js applySchema() so referential dependencies are satisfied.
const ADDITIVE_SLICES = [
  'marketing-schema.sql',
  'merchant-v2-schema.sql',
  'workflow-schema.sql',
  'scope-ai-schema.sql',
  'shop-schema.sql',
  'vehicle-sharing-schema.sql',
];

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sha256 TEXT NOT NULL,
    duration_ms INTEGER
  );
`;

function fileHash(path) {
  // Not cryptographic — used only as a tamper-evidence marker. node:crypto
  // would inflate the deploy surface; a 64-bit FNV-1a is enough to spot drift.
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const data = readFileSync(path);
  for (const byte of data) {
    h ^= BigInt(byte);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16);
}

async function ensureLedger(client) {
  await client.query(LEDGER_DDL);
}

async function getApplied(client) {
  const r = await client.query('SELECT name, sha256 FROM schema_migrations ORDER BY applied_at');
  return new Map(r.rows.map((row) => [row.name, row.sha256]));
}

export async function runMigrations({ connectionString, verbose = true } = {}) {
  const url = connectionString
    || process.env.SUPABASE_DB_URL
    || process.env.KC_DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or KC_DATABASE_URL is required for migrations.');

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();
  const log = (...args) => { if (verbose) console.log(...args); };

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureLedger(client);
    const applied = await getApplied(client);

    const slices = [];
    if (existsSync(join(SCHEMA_DIR, BASE_SCHEMA_FILE))) {
      slices.push({ name: BASE_SCHEMA_FILE, path: join(SCHEMA_DIR, BASE_SCHEMA_FILE), required: true });
    }
    for (const name of ADDITIVE_SLICES) {
      const path = join(SCHEMA_DIR, name);
      if (existsSync(path)) slices.push({ name, path, required: true });
    }
    if (existsSync(join(SCHEMA_DIR, MVP_SCHEMA_FILE))) {
      slices.push({ name: MVP_SCHEMA_FILE, path: join(SCHEMA_DIR, MVP_SCHEMA_FILE), required: true });
    }
    // Any future additive slices live in db/migrations/*.sql
    const extraDir = join(SCHEMA_DIR, 'migrations');
    if (existsSync(extraDir)) {
      for (const f of readdirSync(extraDir).filter((n) => n.endsWith('.sql')).sort()) {
        slices.push({ name: `migrations/${f}`, path: join(extraDir, f), required: true });
      }
    }

    const report = [];
    for (const slice of slices) {
      const hash = fileHash(slice.path);
      const previous = applied.get(slice.name);
      if (previous === hash) {
        report.push({ name: slice.name, status: 'unchanged' });
        continue;
      }
      if (previous && previous !== hash) {
        report.push({ name: slice.name, status: 'changed', previous, current: hash });
        throw new Error(`Schema drift on ${slice.name}: applied sha256 ${previous} but file now hashes ${hash}. Roll the file forward in a new additive slice, do NOT edit in place.`);
      }
      log(`[migrate] applying ${slice.name}`);
      const t0 = Date.now();
      await client.query(readFileSync(slice.path, 'utf8'));
      const duration = Date.now() - t0;
      await client.query(
        'INSERT INTO schema_migrations (name, sha256, duration_ms) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = NOW(), duration_ms = EXCLUDED.duration_ms',
        [slice.name, hash, duration]
      );
      report.push({ name: slice.name, status: 'applied', duration_ms: duration });
    }
    await client.query('COMMIT');
    log('[migrate] done', JSON.stringify(report, null, 2));
    return { ok: true, report };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function readinessCheck({ connectionString, expectedSlices } = {}) {
  const url = connectionString
    || process.env.SUPABASE_DB_URL
    || process.env.KC_DATABASE_URL;
  if (!url) throw new Error('SUPABASE_DB_URL or KC_DATABASE_URL is required for readiness check.');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(LEDGER_DDL);
    const r = await client.query('SELECT name, sha256 FROM schema_migrations');
    const applied = new Map(r.rows.map((row) => [row.name, row.sha256]));
    const missing = (expectedSlices || [BASE_SCHEMA_FILE, ...ADDITIVE_SLICES, MVP_SCHEMA_FILE]).filter((s) => !applied.has(s));
    return { ok: missing.length === 0, applied: [...applied.keys()], missing };
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations().catch((e) => { console.error('[migrate] failed:', e); process.exit(1); });
}