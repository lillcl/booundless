const api = require('../../utils/api.js')

function unwrapList(body) {
  if (!body) return []
  if (Array.isArray(body)) return body
  if (body.data !== undefined) return Array.isArray(body.data) ? body.data : []
  return []
}

Page({
  data: { videos: [] },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    try {
      const body = await api.get('/api/videos')
      this.setData({ videos: unwrapList(body) })
    } catch (e) {
      this.setData({ videos: [] })
    }
  },

  formatDuration(seconds) {
    const s = Number(seconds) || 0
    const mm = Math.floor(s / 60)
    const ss = s % 60
    return mm + ':' + (ss < 10 ? '0' + ss : ss)
  },

  onVideoTap(e) {
    const url = e.currentTarget.dataset.url
    if (!url) {
      wx.showToast({ title: '影片連結不可用', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '連結已複製', icon: 'success' })
    })
  }
})