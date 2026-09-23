#!/usr/bin/env node
/* Audit-log retention: delete rows older than the configured threshold.
   Run on a Vercel cron schedule (daily) or via GitHub Actions schedule.

   Usage:
     node scripts/audit-retention.js
     KC_AUDIT_RETENTION_DAYS=180 node scripts/audit-retention.js    # override
   Defaults to 365 days. Rows older than the threshold are deleted in a
   single transaction. The script prints row counts before and after. */

import { config as loadDotenv } from 'dotenv';
loadDotenv();

import pg from 'pg';
import { getDb, closeDb } from '../api/_lib/db.js';

const DAYS = Number(process.env.KC_AUDIT_RETENTION_DAYS || 365);

async function run() {
  const db = await getDb();
  const before = await db.query('SELECT COUNT(*)::int AS c FROM audit_log');
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  const deleted = await db.query('DELETE FROM audit_log WHERE created_at < $1 RETURNING id', [cutoff]);
  const after = await db.query('SELECT COUNT(*)::int AS c FROM audit_log');
  console.log(JSON.stringify({
    retention_days: DAYS,
    cutoff,
    rows_before: before.rows[0].c,
    rows_deleted: deleted.rowCount,
    rows_after: after.rows[0].c,
  }, null, 2));
}

run()
  .catch((e) => { console.error('audit-retention failed:', e); process.exitCode = 1; })
  .finally(() => closeDb().catch(() => {}));