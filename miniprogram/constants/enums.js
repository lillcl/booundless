// constants/enums.js — 集中枚举（与 db/schema.sql 种子 + docs/API.md 一致）

const CURRENCY = ['MOP', 'HKD', 'CNY']

const REQUEST_STATUS = {
  new: { key: 'new', label: '待報價', pill: 'amber' },
  quoted: { key: 'quoted', label: '已報價', pill: 'amber' },
  accepted: { key: 'accepted', label: '已接受', pill: 'brand' },
  scheduled: { key: 'scheduled', label: '已排期', pill: 'brand' },
  completed: { key: 'completed', label: '已完成', pill: 'muted' },
  cancelled: { key: 'cancelled', label: '已取消', pill: 'muted' },
  declined: { key: 'declined', label: '已婉拒', pill: 'muted' }
}

const REQUEST_STATUS_LIST = Object.keys(REQUEST_STATUS)

const NEED_STATE = ['confirmed', 'dismissed', 'resolved']
const NEED_URGENCY = ['routine', 'soon', 'urgent']

const USER_ROLE = ['admin', 'user']
const TEAM_ROLE = ['owner', 'member', 'viewer']
const DEALER_ROLE = ['owner', 'manager', 'staff', 'viewer']

const DEALER_STATUS = ['draft', 'active', 'suspended']
const COMPATIBILITY_MODE = ['unverified', 'restricted', 'universal']

const CONVERSION_EVENT = ['vehicle_created', 'service_request_submitted', 'booking_confirmed']

const SERVICE_KEYS = [
  'engine_oil',
  'oil_filter',
  'transmission_fluid',
  'brake_pads',
  'brake_fluid',
  'coolant',
  'spark_plugs',
  'air_filter',
  'cabin_filter',
  'battery_12v',
  'tire',
  'brake_caliper',
  'body_chassis_inspection'
]

const SERVICE_LABEL = {
  engine_oil: '機油',
  oil_filter: '機油濾芯',
  transmission_fluid: '變速箱油',
  brake_pads: '煞車皮',
  brake_fluid: '煞車油',
  coolant: '水箱冷卻液',
  spark_plugs: '火花塞',
  air_filter: '空氣濾芯',
  cabin_filter: '冷氣濾芯',
  battery_12v: '12V 電池',
  tire: '輪胎',
  brake_caliper: '煞車卡鉗',
  body_chassis_inspection: '車身底盤檢查'
}

// 纯电动车不需要这些项
const EV_EXCLUDED = new Set(['engine_oil', 'oil_filter', 'spark_plugs', 'transmission_fluid'])

const REMINDER_STATUS = ['upcoming', 'overdue']

const TRIP_STATUS = ['planned', 'ongoing', 'completed', 'cancelled']

const MATCH_LEVEL = {
  exact: { key: 'exact', label: '精確匹配', pill: 'green' },
  likely: { key: 'likely', label: '可能匹配', pill: 'amber' },
  review: { key: 'review', label: '需複核', pill: 'muted' }
}

const COMPATIBILITY_STATE = ['confirmed', 'needs_confirmation']

// 损耗阈值（与 api/_handlers/vehicles.js 一致：>=80 attention, >=100 due）
const WEAR_ATTENTION = 80
const WEAR_DUE = 100

function statusPillClass(key) {
  const def = REQUEST_STATUS[key]
  return def ? 'kc-pill--' + def.pill : 'kc-pill--muted'
}

function statusLabel(key) {
  const def = REQUEST_STATUS[key]
  return def ? def.label : key
}

function matchLevelPill(level) {
  const def = MATCH_LEVEL[level]
  return def ? def.label : level
}

module.exports = {
  CURRENCY,
  REQUEST_STATUS,
  REQUEST_STATUS_LIST,
  NEED_STATE,
  NEED_URGENCY,
  USER_ROLE,
  TEAM_ROLE,
  DEALER_ROLE,
  DEALER_STATUS,
  COMPATIBILITY_MODE,
  CONVERSION_EVENT,
  SERVICE_KEYS,
  SERVICE_LABEL,
  EV_EXCLUDED,
  REMINDER_STATUS,
  TRIP_STATUS,
  MATCH_LEVEL,
  COMPATIBILITY_STATE,
  WEAR_ATTENTION,
  WEAR_DUE,
  statusPillClass,
  statusLabel,
  matchLevelPill
}