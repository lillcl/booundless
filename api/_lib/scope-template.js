/* Default maintenance scope rows for a freshly onboarded vehicle.
   Picks items and intervals based on powertrain_type so the detail page
   never shows an empty list. The DB path (seed here) covers the common
   case; the AI path in handlers/vehicles.js covers edge cases where the
   template is incomplete or needs mileage-driven wear refinement. */

import { normalize } from './dealer-matcher.js';

const COMBUSTION_ROWS = [
  { service_item_type_key: 'engine_oil',              item: '機油',           interval_km: 10000, interval_months: 12 },
  { service_item_type_key: 'oil_filter',              item: '機油隔',         interval_km: 10000, interval_months: 12 },
  { service_item_type_key: 'transmission_fluid',      item: '波箱油',         interval_km: 60000, interval_months: 48 },
  { service_item_type_key: 'brake_pads',              item: '煞車皮',         interval_km: 30000, interval_months: 24 },
  { service_item_type_key: 'brake_fluid',             item: '煞車油',         interval_km: 40000, interval_months: 24 },
  { service_item_type_key: 'coolant',                 item: '冷卻液',         interval_km: 80000, interval_months: 48 },
  { service_item_type_key: 'spark_plugs',             item: '火花塞',         interval_km: 60000, interval_months: 60 },
  { service_item_type_key: 'air_filter',              item: '空氣濾芯',       interval_km: 20000, interval_months: 24 },
  { service_item_type_key: 'cabin_filter',            item: '冷氣濾芯',       interval_km: 20000, interval_months: 12 },
  { service_item_type_key: 'battery_12v',             item: '12V 電瓶',       interval_km: null,   interval_months: 48 },
  { service_item_type_key: 'tire',                    item: '輪胎',           interval_km: 30000, interval_months: 24 },
  { service_item_type_key: 'brake_caliper',           item: '煞車卡鉗保養',   interval_km: null,   interval_months: 24 },
  { service_item_type_key: 'body_chassis_inspection', item: '車身及底盤檢查', interval_km: null,   interval_months: 12 },
];

/* Pure-EV scope drops engine fluids, spark plugs, and 12V wear items that
   do not apply, but keeps transmission fluid (single-speed reduction
   gears), brake inspection (regen-heavy wear pattern), coolant (battery
   thermal management), filters, tires, and chassis checks. */
const EV_ROWS = [
  { service_item_type_key: 'transmission_fluid',      item: '波箱油',         interval_km: 60000, interval_months: 48 },
  { service_item_type_key: 'brake_pads',              item: '煞車皮',         interval_km: 30000, interval_months: 24 },
  { service_item_type_key: 'brake_fluid',             item: '煞車油',         interval_km: 40000, interval_months: 24 },
  { service_item_type_key: 'coolant',                 item: '冷卻液（電池）', interval_km: 80000, interval_months: 48 },
  { service_item_type_key: 'air_filter',              item: '空氣濾芯',       interval_km: 20000, interval_months: 24 },
  { service_item_type_key: 'cabin_filter',            item: '冷氣濾芯',       interval_km: 20000, interval_months: 12 },
  { service_item_type_key: 'battery_12v',             item: '12V 電瓶',       interval_km: null,   interval_months: 48 },
  { service_item_type_key: 'tire',                    item: '輪胎',           interval_km: 30000, interval_months: 24 },
  { service_item_type_key: 'brake_caliper',           item: '煞車卡鉗保養',   interval_km: null,   interval_months: 24 },
  { service_item_type_key: 'body_chassis_inspection', item: '車身及底盤檢查', interval_km: null,   interval_months: 12 },
];

function rowsForPowertrain(powertrain) {
  const key = normalize(powertrain);
  if (!key) return COMBUSTION_ROWS;
  if (
    key === normalize('ev') ||
    key === normalize('electric') ||
    key === normalize('bev') ||
    key === normalize('純電') ||
    key === normalize('純電動') ||
    key === normalize('纯电') ||
    key === normalize('纯电动')
  ) return EV_ROWS;
  /* Hybrid still has an engine and follows combustion schedule. */
  return COMBUSTION_ROWS;
}

/* Returns rows ready for vehicle_status INSERT. last_done_km is left null
   so the detail UI renders the empty-state copy ("—") until the owner
   records the first service. wear starts at 0 because a freshly onboarded
   vehicle has no accrued wear. */
export function defaultScopeRows(vehicle) {
  return rowsForPowertrain(vehicle?.powertrain_type).map((row, idx) => ({
    vehicle_id: vehicle.id,
    item: row.item,
    service_item_type_key: row.service_item_type_key,
    interval_km: row.interval_km,
    interval_months: row.interval_months,
    last_done_km: null,
    last_done_at: null,
    wear: 0,
    display_order: idx + 1,
  }));
}

export function defaultScopeRowKeys(powertrain) {
  return rowsForPowertrain(powertrain).map((r) => r.service_item_type_key);
}