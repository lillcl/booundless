import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { calculateCheckoutTotals, compatibilityFor, ORDER_TRANSITIONS } from '../api/_handlers/shop.js';
import { resolveHandler } from '../api/index.js';
import { SHOP_CATALOG } from '../db/shop-catalog.js';

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

test('full catalogue contains every requested product family with structured metadata', () => {
  assert.equal(SHOP_CATALOG.length, 101);
  for (const name of ['全合成機油','OBD-II Scanner','Type 2 充電線','摩托車輪胎','長途 / 北上應急套裝']) {
    assert.ok(SHOP_CATALOG.some((product) => product.name === name), `missing ${name}`);
  }
  assert.ok(SHOP_CATALOG.every((product) => product.tags.length && product.vehicle_types.length && product.powertrains.length));
});

test('ninety supplied catalogue illustrations map to distinct products and real sheets', () => {
  const illustrated = SHOP_CATALOG.filter((product) => product.image_url.startsWith('/assets/shop-catalog/sheet-'));
  assert.equal(illustrated.length, 90);
  assert.equal(new Set(illustrated.map((product) => product.slug)).size, 90);
  for (const product of illustrated) {
    assert.ok(existsSync(new URL(`../${product.image_url.slice(1)}`, import.meta.url)), product.slug);
    assert.match(product.image_position, /^(0|50|100)% (0|50|100)%$/);
  }
  assert.equal(SHOP_CATALOG.find((product) => product.slug === 'oil-filter').image_url, '/assets/shop-catalog/sheet-1.png');
  assert.equal(SHOP_CATALOG.find((product) => product.slug === 'type2-charging-cable').image_url, '/assets/shop-catalog/sheet-9.png');
  assert.equal(SHOP_CATALOG.find((product) => product.slug === 'hybrid-coolant').image_url.startsWith('/assets/shop-catalog/'), false);
});

test('Vehicle Passport compatibility excludes combustion products from EVs', () => {
  const oil = SHOP_CATALOG.find((product) => product.slug === 'full-synthetic-engine-oil');
  const type2 = SHOP_CATALOG.find((product) => product.slug === 'type2-charging-cable');
  const ev = { make: 'Audi', model: 'Q4 e-tron', year: 2023, fuel_type: 'EV', vehicle_class: 'passenger' };
  assert.equal(compatibilityFor(oil, ev).status, 'incompatible');
  assert.notEqual(compatibilityFor(type2, ev).status, 'incompatible');
});
