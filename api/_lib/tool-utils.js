import { randomUUID } from 'node:crypto';

export const MAX_TEXT = 4000;

export function text(value, name, { required = false, max = 500 } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  const result = value.trim();
  if (required && !result) throw new Error(`${name} is required`);
  if (result.length > max) throw new Error(`${name} is too long`);
  return result || null;
}

export function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

export function number(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, required = false } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return n;
}

export function object(value, name) {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

export function array(value, name, max = 20) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`${name} must be an array with at most ${max} items`);
  return value;
}

export function id(value, name = 'id') {
  const result = text(value, name, { required: true, max: 120 });
  if (!/^[\w:.\-]+$/.test(result)) throw new Error(`${name} is invalid`);
  return result;
}

export function userOwned(where = 'created_by_user_id') {
  return `((${where} = $1) OR ${where} IS NULL)`;
}

export async function getOwnedVehicle(db, userId, vehicleId) {
  const r = await db.query(
    `SELECT id, model, make, year, fuel_type, vin, plate, mileage_km, mileage_label, image, owner, team
       FROM vehicles WHERE id = $2 AND (created_by_user_id = $1 OR created_by_user_id IS NULL)`,
    [userId, vehicleId],
  );
  if (!r.rowCount) throw new Error('Vehicle not found');
  return r.rows[0];
}

export function toolResult(data, extra = {}) {
  return { ok: true, ...extra, data };
}

export function errorResult(error) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function newId() {
  return randomUUID();
}
