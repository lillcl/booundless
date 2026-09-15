const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')

function unwrapList(body) {
  if (!body) return []
  if (Array.isArray(body)) return body
  if (body.data !== undefined) return Array.isArray(body.data) ? body.data : []
  return []
}

const ROLE_LABELS = { owner: '擁有者', member: '成員', viewer: '觀察者' }

Page({
  data: { teams: [] },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    this.load()
  },

  async load() {
    try {
      const body = await api.get('/api/profile/teams')
      this.setData({ teams: unwrapList(body) })
    } catch (e) {
      this.setData({ teams: [] })
    }
  },

  roleLabel(r) { return ROLE_LABELS[r] || r },
  formatDate(d) { return format.formatDate(d) }
})