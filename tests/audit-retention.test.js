/* Smoke test for the audit-retention SQL semantics. Verifies the script uses
   the right default (365 days) and respects the KC_AUDIT_RETENTION_DAYS env
   override by parsing the source. This avoids needing a live Postgres. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../scripts/audit-retention.js', import.meta.url)), 'utf8');

test('audit-retention: defaults to 365 days when KC_AUDIT_RETENTION_DAYS unset', () => {
  assert.match(source, /const DAYS = Number\(process\.env\.KC_AUDIT_RETENTION_DAYS \|\| 365\)/);
});

test('audit-retention: deletes by created_at cutoff', () => {
  assert.match(source, /DELETE FROM audit_log WHERE created_at < \$1/);
});

test('audit-retention: prints rows_before / rows_deleted / rows_after JSON', () => {
  assert.match(source, /rows_before/);
  assert.match(source, /rows_deleted/);
  assert.match(source, /rows_after/);
});

test('audit-retention: closes the pool on completion', () => {
  assert.match(source, /closeDb\(\)/);
});