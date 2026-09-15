const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    prefs: {
      maintenance_reminders: true,
      trip_updates: true,
      ai_suggestions: true
    },
    saving: false,
    status: '',
    statusTone: 'info'
  },

  onLoad() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    this.load()
  },

  async load() {
    try {
      const body = await api.get('/api/profile/notifications')
      this.setData({ prefs: Object.assign({}, this.data.prefs, body || {}) })
    } catch (e) {}
  },

  onToggle(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['prefs.' + key]: e.detail.value })
  },

  async onSave() {
    this.setData({ saving: true, status: '', statusTone: 'info' })
    try {
      await api.patch('/api/profile/notifications', this.data.prefs)
      this.setData({ status: '已儲存', statusTone: 'ok' })
    } catch (e) {
      this.setData({ status: (e && e.message) || '儲存失敗', statusTone: 'error' })
    } finally {
      this.setData({ saving: false })
    }
  }
})