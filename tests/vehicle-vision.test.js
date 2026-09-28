import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVehicleVision } from '../api/_lib/vehicle-vision.js';

test('normalizes a readable vehicle photo without inventing hidden details', () => {
  const result = normalizeVehicleVision({
    make: ' Tesla ', model: ' Model Y ', body_color: '白色',
    vehicle_class: 'light_passenger', fuel_type: '純電',
    plate: 'm hy 2266 e', year: null, vin: '',
    confidence: { make: 'high', model: 'high', plate: 'medium' },
  });
  assert.equal(result.make, 'Tesla');
  assert.equal(result.model, 'Model Y');
  assert.equal(result.body_color, '白色');
  assert.equal(result.plate, 'M HY 2266 E');
  assert.equal(result.year, null);
  assert.equal(result.vin, '');
  assert.equal(result.confidence.plate, 'medium');
});

test('rejects unsupported fields and impossible model output', () => {
  const result = normalizeVehicleVision({
    vehicle_class: 'spaceship', fuel_type: 'diesel-electric',
    year: 1800, vin: 'not-a-vin', confidence: { plate: 'certain' },
  });
  assert.equal(result.vehicle_class, '');
  assert.equal(result.fuel_type, '');
  assert.equal(result.year, null);
  assert.equal(result.vin, '');
  assert.equal(result.confidence.plate, 'low');
  assert.equal(normalizeVehicleVision(null).model, '');
});

test('prevents a conflicting brand for an unambiguous Tesla model name', () => {
  const result = normalizeVehicleVision({
    make: 'Honda', model: 'Model Y', confidence: { make: 'high', model: 'high' },
  });
  assert.equal(result.make, 'Tesla');
  assert.equal(result.confidence.make, 'medium');
});
