// Scoped additive rollout: do not rewrite the base-schema ledger or readiness
// marker when an older deployment is still serving traffic.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const name = 'migrations/2026_10_assistant_policy_usage.sql';
const sql = readFileSync(new URL(`../db/${name}`, import.meta.url), 'utf8');
let hash = 0xcbf29ce484222325n;
for (const byte of Buffer.from(sql)) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
const fingerprint = hash.toString(16);
const url = process.env.SUPABASE_DB_URL || process.env.DIRECT_URL;
if (!url || ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname)) throw new Error('Configured production database required; use integration tests for local migrations');
const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('SELECT pg_advisory_xact_lock($1)', [42420260921]);
  const previous = (await client.query('SELECT sha256 FROM schema_migrations WHERE name=$1', [name])).rows[0];
  if (previous && previous.sha256 !== fingerprint) throw new Error('Assistant migration drift; do not overwrite applied SQL');
  if (!previous) {
    const started = Date.now();
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(name,sha256,duration_ms) VALUES($1,$2,$3)', [name, fingerprint, Date.now() - started]);
  }
  await client.query('SELECT usage_key,questions,tokens_used,tokens_reserved FROM app_private.agent_usage_days LIMIT 0');
  await client.query('SELECT request_id,lease_expires_at FROM app_private.agent_requests LIMIT 0');
  await client.query('SELECT scope_decision,latency_ms FROM agent_runs LIMIT 0');
  await client.query('COMMIT');
  console.log(JSON.stringify({ ok: true, migration: name, status: previous ? 'unchanged' : 'applied', existing_readiness_marker_preserved: true }));
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally { client.release(); await pool.end(); }
