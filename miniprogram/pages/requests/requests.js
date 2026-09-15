const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')
const enums = require('../../constants/enums.js')

function unwrapList(body) {
  if (!body) return []
  if (Array.isArray(body)) return body
  if (body.data !== undefined) return Array.isArray(body.data) ? body.data : []
  return []
}

Page({
  data: {
    tabIndex: 0,
    requests: [],
    filtered: []
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    try {
      const body = await api.get('/api/service-requests')
      const list = unwrapList(body)
      this.setData({
        requests: list.map(r => ({
          id: r.id,
          status: r.status,
          dealer_name: r.dealer_display_name || r.dealer_name || '',
          vehicle_model: r.vehicle_model || '',
          service_item_type_key: r.service_item_type_key,
          created_at: r.created_at,
          scheduled_at: r.scheduled_at,
          latest_quote: r.quotes && r.quotes[0] ? format.formatMoney(r.quotes[0].total_minor, r.quotes[0].currency) : ''
        }))
      })
      this.applyFilter()
    } catch (e) {
      this.setData({ requests: [], filtered: [] })
    }
  },

  applyFilter() {
    const active = ['new', 'quoted', 'accepted', 'scheduled']
    const closed = ['completed', 'cancelled', 'declined']
    let list = this.data.requests
    if (this.data.tabIndex === 0) list = list.filter(r => active.includes(r.status))
    else if (this.data.tabIndex === 1) list = list.filter(r => closed.includes(r.status))
    this.setData({ filtered: list })
  },

  onTab(e) {
    this.setData({ tabIndex: Number(e.currentTarget.dataset.idx) })
    this.applyFilter()
  },

  onItemTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/request-detail/request-detail?id=' + id })
  },

  statusLabel(key) { return enums.statusLabel(key) },
  statusTone(key) { return enums.statusPillClass(key).replace('kc-pill--', '') },
  serviceLabel(key) { return enums.SERVICE_LABEL[key] || key },
  formatDate(d) { return format.formatDate(d) }
})