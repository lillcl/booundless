const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')

Page({
  data: { history: [] },

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
      const body = await api.get('/api/history/recent?limit=20')
      const list = Array.isArray(body) ? body : (body && body.data) || []
      this.setData({ history: list })
    } catch (e) {
      this.setData({ history: [] })
    }
  },

  formatDate(d) { return format.formatDate(d) }
})