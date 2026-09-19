import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateCheckoutTotals, ORDER_TRANSITIONS } from '../api/_handlers/shop.js';
import { resolveHandler } from '../api/index.js';

test('shop checkout totals use integer minor units', () => {
  assert.deepEqual(calculateCheckoutTotals([
    { price_minor: 39800, quantity: 2 },
    { price_minor: 8800, quantity: 1 },
  ], 'pickup'), { subtotalMinor: 88400, deliveryMinor: 0, totalMinor: 88400 });
  assert.deepEqual(calculateCheckoutTotals([{ price_minor: 16800, quantity: 1 }], 'delivery'), {
    subtotalMinor: 16800, deliveryMinor: 3000, totalMinor: 19800,
  });
  assert.throws(() => calculateCheckoutTotals([{ price_minor: 10.5, quantity: 1 }]));
});

test('shop order status transitions are terminal after completion or cancellation', () => {
  assert.equal(ORDER_TRANSITIONS.pending.has('confirmed'), true);
  assert.equal(ORDER_TRANSITIONS.pending.has('completed'), false);
  assert.equal(ORDER_TRANSITIONS.completed.size, 0);
  assert.equal(ORDER_TRANSITIONS.cancelled.size, 0);
});

test('shop API routes resolve to one server handler', () => {
  assert.equal(resolveHandler('/api/shop/products'), resolveHandler('/api/shop/cart'));
  assert.equal(resolveHandler('/api/admin/shop/orders'), resolveHandler('/api/shop/products'));
});

test('shop tables enable RLS and revoke browser-facing roles', () => {
  const schema = readFileSync(new URL('../db/shop-schema.sql', import.meta.url), 'utf8');
  for (const table of ['shop_products','shop_carts','shop_orders','shop_inventory_movements']) {
    assert.match(schema, new RegExp(`['"]${table}['"]`));
  }
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /REVOKE ALL ON TABLE %I FROM anon/);
  assert.match(schema, /REVOKE ALL ON TABLE %I FROM authenticated/);
});
