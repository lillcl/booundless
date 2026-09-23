/* Inspection checklist templates (T3 — baseline + second-opinion v1).
   Versioned code-defined templates. Per spec §5.3: Admin can start/stop an
   offer but cannot modify a published checklist inline — versioned config
   only. Pure functions; no DB. */

export const INSPECTION_TEMPLATES = Object.freeze({
  'baseline-v1': Object.freeze({
    key: 'baseline-v1',
    label: '七項基線檢查',
    applies_to: { fuel_type: ['汽油', '柴油', '混能', '插電混能'] },
    items: Object.freeze([
      Object.freeze({ check_key: 'engine_oil_and_filter', label: '機油及機油隔', service_keys: ['engine_oil', 'oil_filter'] }),
      Object.freeze({ check_key: 'transmission_oil', label: '波箱油', service_keys: ['transmission_oil'] }),
      Object.freeze({ check_key: 'brake_pads', label: '煞車皮', service_keys: ['brake_pads'] }),
      Object.freeze({ check_key: 'brake_fluid', label: '煞車油', service_keys: ['brake_fluid'] }),
      Object.freeze({ check_key: 'coolant', label: '冷卻液', service_keys: ['coolant'] }),
      Object.freeze({ check_key: 'spark_plugs', label: '火花塞', service_keys: ['spark_plugs'] }),
      Object.freeze({ check_key: 'air_filter', label: '空氣濾芯', service_keys: ['air_filter'] }),
      Object.freeze({ check_key: 'cabin_filter', label: '冷氣濾芯', service_keys: ['cabin_filter'] }),
    ]),
  }),
  'baseline-ev-v1': Object.freeze({
    key: 'baseline-ev-v1',
    label: '電動車基線檢查',
    applies_to: { fuel_type: ['電動'] },
    items: Object.freeze([
      Object.freeze({ check_key: 'brake_fluid', label: '煞車油', service_keys: ['brake_fluid'] }),
      Object.freeze({ check_key: 'coolant', label: '冷卻液', service_keys: ['coolant'] }),
      Object.freeze({ check_key: 'cabin_filter', label: '冷氣濾芯', service_keys: ['cabin_filter'] }),
      Object.freeze({ check_key: 'tire_condition', label: '輪胎狀態', service_keys: [] }),
    ]),
  }),
  'second-opinion-v1': Object.freeze({
    key: 'second-opinion-v1',
    label: '第二意見檢查',
    applies_to: { any: true },
    items: Object.freeze([
      Object.freeze({ check_key: 'engine_oil_and_filter', label: '機油及機油隔', service_keys: ['engine_oil', 'oil_filter'] }),
      Object.freeze({ check_key: 'transmission_oil', label: '波箱油', service_keys: ['transmission_oil'] }),
      Object.freeze({ check_key: 'brake_pads', label: '煞車皮', service_keys: ['brake_pads'] }),
      Object.freeze({ check_key: 'brake_fluid', label: '煞車油', service_keys: ['brake_fluid'] }),
      Object.freeze({ check_key: 'coolant', label: '冷卻液', service_keys: ['coolant'] }),
      Object.freeze({ check_key: 'spark_plugs', label: '火花塞', service_keys: ['spark_plugs'] }),
      Object.freeze({ check_key: 'air_filter', label: '空氣濾芯', service_keys: ['air_filter'] }),
      Object.freeze({ check_key: 'cabin_filter', label: '冷氣濾芯', service_keys: ['cabin_filter'] }),
    ]),
  }),
});

const VALID_RESULTS = Object.freeze(['unknown', 'normal', 'recommended', 'urgent', 'not_applicable']);
const VALID_UNITS = Object.freeze(['mm', 'percent', 'other']);

export function listTemplates() {
  return Object.values(INSPECTION_TEMPLATES).map((t) => ({
    key: t.key,
    label: t.label,
    items: t.items.map((i) => ({ check_key: i.check_key, label: i.label })),
  }));
}

export function getTemplate(key) {
  return INSPECTION_TEMPLATES[key] || null;
}

/* Pick the right template for a vehicle by fuel_type. EV uses baseline-ev-v1
   unless caller overrides; non-EV uses baseline-v1; second_opinion uses
   second-opinion-v1. */
export function templateFor({ kind, fuel_type }) {
  if (kind === 'second_opinion') return INSPECTION_TEMPLATES['second-opinion-v1'];
  if (kind === 'baseline') {
    if (fuel_type === '電動') return INSPECTION_TEMPLATES['baseline-ev-v1'];
    return INSPECTION_TEMPLATES['baseline-v1'];
  }
  return null;
}

/* Validate a single inspection_result row against the template. */
export function validateResultRow(template, row) {
  if (!template) throw new Error('Unknown template');
  const item = template.items.find((i) => i.check_key === row.check_key);
  if (!item) throw new Error(`check_key "${row.check_key}" not in template`);
  if (!VALID_RESULTS.includes(row.result)) throw new Error('Invalid result');
  if (row.measurement_value != null && row.measurement_unit == null) {
    throw new Error('measurement_value requires measurement_unit');
  }
  if (row.measurement_unit != null && !VALID_UNITS.includes(row.measurement_unit)) {
    throw new Error('Invalid measurement_unit');
  }
  if (row.result === 'not_applicable' && (row.notes == null || row.notes.length < 1)) {
    throw new Error('not_applicable requires a reason in notes');
  }
  if (typeof row.notes === 'string' && row.notes.length > 2000) throw new Error('notes too long');
  if (typeof row.recommended_action === 'string' && row.recommended_action.length > 1000) throw new Error('recommended_action too long');
  if (row.next_due_km != null && row.next_due_km < 0) throw new Error('next_due_km must be >= 0');
  const keys = Array.isArray(row.service_keys) ? row.service_keys : [];
  if (keys.length > 30) throw new Error('too many service_keys');
  if (keys.some((k) => typeof k !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(k))) throw new Error('invalid service_key');
  return { check_key: row.check_key, service_keys: [...new Set(keys)], result: row.result,
    measurement_value: row.measurement_value ?? null, measurement_unit: row.measurement_unit ?? null,
    measurement_method: row.measurement_method ?? null, notes: row.notes ?? null,
    recommended_action: row.recommended_action ?? null, next_due_km: row.next_due_km ?? null,
    next_due_date: row.next_due_date ?? null };
}

/* Spec §5.3: publish requires every template item to have a result row.
   Returns the normalised rows; throws on missing/duplicate. */
export function normaliseResultsForPublish(template, rows) {
  if (!Array.isArray(rows)) throw new Error('results must be an array');
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.check_key)) throw new Error(`Duplicate result for ${row.check_key}`);
    seen.add(row.check_key);
    out.push(validateResultRow(template, row));
  }
  for (const item of template.items) {
    if (!seen.has(item.check_key)) throw new Error(`Missing result for ${item.check_key}`);
  }
  return out;
}