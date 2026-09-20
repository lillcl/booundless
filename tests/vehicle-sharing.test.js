import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveHandler } from '../api/index.js';

test('vehicle sharing routes resolve to their server-side authorization handlers', () => {
  assert.equal(resolveHandler('/api/dealers')?.name, 'handler');
  assert.equal(resolveHandler('/api/dealer/vehicles')?.name, 'handler');
  assert.equal(resolveHandler('/api/dealer/vehicles/example/history')?.name, 'handler');
  assert.equal(resolveHandler('/api/vehicles/example/dealer-access')?.name, 'handler');
});

test('vehicle dealer grants are protected from browser-facing database roles', () => {
  const sql = readFileSync(new URL('../db/vehicle-sharing-schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE vehicle_dealer_grants ENABLE ROW LEVEL SECURITY/i);
  assert.match(sql, /REVOKE ALL ON vehicle_dealer_grants FROM anon/i);
  assert.match(sql, /REVOKE ALL ON vehicle_dealer_grants FROM authenticated/i);
  assert.match(sql, /UNIQUE \(vehicle_id, dealer_id\)/i);
});

