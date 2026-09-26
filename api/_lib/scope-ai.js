/* AI extension of the default maintenance scope. Called by the vehicle
   create handler and the /scope/generate handler AFTER the template
   rows have been inserted. Failures are caught here so callers never
   need a try/catch around the call — the worst case is that no AI
   extras are added and the template-only scope is returned. */

import { askAI } from './ai.js';
import { defaultScopeRows } from './scope-template.js';

/* Mirror of db/schema.sql:325-339 — service_item_types.key values.
   Kept in code (not joined from the DB) so the helper stays cheap and
   deterministic; any new key requires a coordinated code change. */
const KNOWN_KEYS = new Set([
  'engine_oil', 'oil_filter', 'transmission_fluid', 'brake_pads',
  'brake_fluid', 'coolant', 'spark_plugs', 'air_filter', 'cabin_filter',
  'battery_12v', 'tire', 'brake_caliper', 'body_chassis_inspection',
]);

const MAX_EXTRA_ROWS = 8;
const MAX_ITEM_LEN = 40;

const SYSTEM_PROMPT = `你是無界啟程 BOOUNDLESS 的保養資料助手。使用繁體中文。
車輛資料的 fuel_type、powertrain_type、make、model、year 描述一台特定車輛。
已知範本已經包含基本的保養項目，請只列出「範本沒有、但這台車輛真正需要」的額外項目。
只輸出 JSON 陣列，不要任何說明文字、Markdown 或程式碼區塊。
每個元素的格式：{"item":"顯示名稱","service_item_type_key":null 或已知 key,"interval_km":number 或 null,"interval_months":number 或 null}
規則：
- item 必須是 1-40 字、繁體中文、貼近台港澳常用名稱
- service_item_type_key 若不確定請留 null（不要亂猜）
- interval_km 與 interval_months 至少要有一個
- 最多 8 個項目
- 不要重複範本已有的項目（例如不要再列機油、煞車皮、輪胎等）`;

function templateItemLabels(vehicle) {
  return defaultScopeRows(vehicle).map((r) => String(r.item || '').trim().toLowerCase());
}

/* Maintenance vocabulary tokens that don't add topical signal. Stripping
   them before fingerprinting keeps "DPF 檢查" and "DPF 強制再生" on the
   same topic, while "燃油濾清器更換" and "燃油濾芯更換" still collide on
   "燃油濾" even though "清器/芯" differ. */
const STOP_TOKENS = new Set([
  '檢查', '更換', '清潔', '補充', '系統', '保養', '維護', '再生', '強制',
  '定期', '項目', '相關', '與', '及', '或',
]);

function tokenize(label) {
  const cleaned = String(label || '').replace(/[()（）\[\]【】·•,，.。!！?？\s]+/g, ' ').trim();
  if (!cleaned) return [];
  /* Extract 2-character CJK tokens and any Latin/digit runs. */
  const tokens = [];
  const cjk = cleaned.match(/[㐀-鿿]{2,}/g) || [];
  for (const run of cjk) {
    for (let i = 0; i + 2 <= run.length; i += 1) tokens.push(run.slice(i, i + 2));
  }
  const latin = cleaned.match(/[A-Za-z0-9]+/g) || [];
  for (const t of latin) tokens.push(t.toLowerCase());
  return tokens.filter((t) => !STOP_TOKENS.has(t));
}

function fingerprint(label) {
  const tokens = tokenize(label);
  return Array.from(new Set(tokens)).sort().join('|');
}

/* Exported so handlers can dedupe against fingerprints without re-running
   the helper's full validation pipeline. */
export { fingerprint };

function isDuplicateLabel(label, existingLabels) {
  const needle = String(label || '').trim().toLowerCase();
  if (!needle) return true;
  const needleTokens = tokenize(label);
  if (needleTokens.length === 0) return false;
  const needleFp = fingerprint(label);
  for (const hay of existingLabels) {
    if (!hay) continue;
    if (hay.includes(needle) || needle.includes(hay)) return true;
    /* Fingerprint equality after stop-token stripping. */
    if (needleFp && fingerprint(hay) === needleFp) return true;
    /* Token-set overlap ≥ 50% of the smaller set. Catches "DPF 檢查" vs
       "DPF 強制再生" and "燃油濾清器更換" vs "燃油濾芯更換". */
    const hayTokens = tokenize(hay);
    if (!hayTokens.length) continue;
    const needleSet = new Set(needleTokens);
    const haySet = new Set(hayTokens);
    let shared = 0;
    for (const t of needleSet) if (haySet.has(t)) shared += 1;
    const smaller = Math.min(needleSet.size, haySet.size);
    if (smaller >= 2 && shared / smaller >= 0.5) return true;
  }
  return false;
}

function coerceIntervalKm(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1000 || n > 500000) return null;
  return Math.round(n);
}

function coerceIntervalMonths(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 240) return null;
  return Math.round(n);
}

function validateRow(raw, templateLabels) {
  if (!raw || typeof raw !== 'object') return null;
  const item = String(raw.item || '').trim();
  if (!item || item.length > MAX_ITEM_LEN) return null;
  if (isDuplicateLabel(item, templateLabels)) return null;

  const interval_km = coerceIntervalKm(raw.interval_km);
  const interval_months = coerceIntervalMonths(raw.interval_months);
  if (interval_km == null && interval_months == null) return null;

  let key = raw.service_item_type_key == null ? null : String(raw.service_item_type_key).trim().toLowerCase();
  if (key && !KNOWN_KEYS.has(key)) key = null;

  return {
    item,
    service_item_type_key: key || null,
    interval_km,
    interval_months,
  };
}

function parseJsonArray(text) {
  const cleaned = String(text || '').replace(/^```json\s*|\s*```$/g, '').trim();
  if (!cleaned) return [];
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function suggestExtraScope(vehicle) {
  if (!vehicle || !vehicle.powertrain_type) return [];
  const templateLabels = templateItemLabels(vehicle);
  const payload = {
    make: vehicle.make || null,
    model: vehicle.model || null,
    year: vehicle.year || null,
    fuel_type: vehicle.fuel_type || null,
    powertrain_type: vehicle.powertrain_type || null,
    vehicle_class: vehicle.vehicle_class || null,
    mileage_km: Number.isFinite(Number(vehicle.mileage_km)) ? Number(vehicle.mileage_km) : null,
    already_in_scope: templateLabels,
  };
  try {
    const { text } = await askAI({
      system: SYSTEM_PROMPT,
      user: JSON.stringify(payload),
      temperature: 0.2,
      maxTokens: 900,
    });
    const raw = parseJsonArray(text);
    const accepted = [];
    for (const row of raw) {
      if (accepted.length >= MAX_EXTRA_ROWS) break;
      const valid = validateRow(row, templateLabels);
      if (valid) accepted.push(valid);
    }
    if (accepted.length) {
      console.log('[scope-ai] inserted', accepted.length, 'extra rows for vehicle', vehicle.id, '(', vehicle.make, vehicle.model, ')');
    }
    return accepted;
  } catch (e) {
    console.warn('[scope-ai] skipped for vehicle', vehicle && vehicle.id, e && e.message);
    return [];
  }
}
