// utils/format.js — 日期/里程/货币/数字格式化

function pad(n) { return n < 10 ? '0' + n : '' + n }

function formatDate(input, withTime) {
  if (!input) return ''
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  if (!withTime) return y + '-' + m + '-' + day
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return y + '-' + m + '-' + day + ' ' + hh + ':' + mm
}

function formatDateShort(input) {
  if (!input) return ''
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input
  if (isNaN(d.getTime())) return ''
  return (d.getMonth() + 1) + '月' + d.getDate() + '日'
}

function mileageLabel(km) {
  if (km == null || isNaN(km)) return ''
  const n = Number(km)
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 萬 km'
  return n.toLocaleString('zh-Hant') + ' km'
}

function currencySymbol(code) {
  switch ((code || '').toUpperCase()) {
    case 'MOP': return 'MOP$'
    case 'HKD': return 'HK$'
    case 'CNY': return '¥'
    default: return code || ''
  }
}

function formatMoney(minor, code) {
  if (minor == null || isNaN(minor)) return ''
  const value = (Number(minor) / 100)
  return currencySymbol(code) + ' ' + value.toFixed(2)
}

function relativeFromNow(input) {
  if (!input) return ''
  const d = typeof input === 'string' || typeof input === 'number' ? new Date(input) : input
  if (isNaN(d.getTime())) return ''
  const diff = d.getTime() - Date.now()
  const day = 24 * 60 * 60 * 1000
  if (diff <= 0) {
    const overdue = -diff
    const days = Math.floor(overdue / day)
    if (days === 0) return '今日到期'
    if (days < 30) return '已逾期 ' + days + ' 天'
    return '已逾期 ' + Math.floor(days / 30) + ' 個月'
  }
  const days = Math.ceil(diff / day)
  if (days === 0) return '今日'
  if (days === 1) return '明日'
  if (days < 30) return days + ' 天後'
  return Math.floor(days / 30) + ' 個月後'
}

function uuid() {
  // 简易 UUID v4（小程序无 crypto.randomUUID 时使用 wx.getSystemInfoSync 时间戳不可靠）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

module.exports = {
  formatDate,
  formatDateShort,
  mileageLabel,
  currencySymbol,
  formatMoney,
  relativeFromNow,
  uuid
}