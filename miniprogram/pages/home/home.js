const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')
const storage = require('../../utils/storage.js')

function unwrap(body) {
  if (!body) return []
  if (Array.isArray(body)) return body
  if (body.data !== undefined) return Array.isArray(body.data) ? body.data : []
  return []
}

function greeting(now) {
  const h = now.getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早安'
  if (h < 14) return '午安'
  if (h < 18) return '下午好'
  if (h < 22) return '晚上好'
  return '夜深了'
}

Page({
  data: {
    greeting: '',
    userName: '車主',
    todayLabel: '',
    weatherHint: '記得定期查看車況',
    reminders: [],
    vehicles: [],
    trips: []
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().finally(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    const now = new Date()
    this.setData({
      greeting: greeting(now),
      todayLabel: format.formatDate(now),
      userName: this._userName()
    })
    await Promise.all([
      this.loadReminders(),
      this.loadVehicles(),
      this.loadTrips()
    ])
  },

  _userName() {
    try {
      const app = getApp()
      const user = (app && app.globalData && app.globalData.user) || storage.getUser()
      if (user) {
        return user.display_name || user.nickname || (user.email || '').split('@')[0] || '車主'
      }
    } catch (e) {}
    return '車主'
  },

  async loadReminders() {
    try {
      const body = await api.get('/api/reminders')
      const list = unwrap(body)
      this.setData({
        reminders: list.slice(0, 5).map(r => ({
          id: r.id,
          title: r.title,
          vehicleLabel: r.vehicle_model || '',
          dueLabel: format.relativeFromNow(r.due_in || r.due_at || r.due_date),
          status: r.status === 'overdue' ? 'overdue' : 'upcoming'
        }))
      })
    } catch (e) {
      this.setData({ reminders: [] })
    }
  },

  async loadVehicles() {
    try {
      const body = await api.get('/api/vehicles')
      const list = unwrap(body)
      this.setData({
        vehicles: list.slice(0, 6).map(v => ({
          id: v.id,
          model: v.model,
          mileageLabel: format.mileageLabel(v.mileage_km),
          image: v.image
        }))
      })
    } catch (e) {
      this.setData({ vehicles: [] })
    }
  },

  async loadTrips() {
    try {
      const body = await api.get('/api/trips')
      const list = unwrap(body)
      this.setData({
        trips: list.slice(0, 3).map(t => ({
          id: t.id,
          origin: t.origin,
          destination: t.destination,
          distance_km: t.distance_km,
          duration_min: t.duration_min
        }))
      })
    } catch (e) {
      this.setData({ trips: [] })
    }
  },

  onAllReminders() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  onAllVehicles() {
    wx.switchTab({ url: '/pages/garage/garage' })
  },

  onAllTrips() {
    wx.switchTab({ url: '/pages/qinao/qinao' })
  },

  onVehicleTap(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/vehicle-detail/vehicle-detail?id=' + id })
  },

  onTripTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showToast({ title: '行程詳情即將推出', icon: 'none' })
  },

  onReminderTap(e) {
    const id = (e.detail && e.detail.id) || ''
    wx.showToast({ title: '提醒詳情：' + id, icon: 'none' })
  },

  onGoChat() { wx.navigateTo({ url: '/pages/ai-chat/ai-chat' }) },
  onGoImage() { wx.navigateTo({ url: '/pages/ai-image/ai-image' }) },
  onGoRequests() { wx.navigateTo({ url: '/pages/requests/requests' }) },
  onGoQinao() { wx.switchTab({ url: '/pages/qinao/qinao' }) }
})