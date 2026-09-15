const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const imageUtil = require('../../utils/image.js')

Page({
  data: {
    imagePath: '',
    loading: false,
    result: null,
    status: ''
  },

  onLoad() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
  },

  async onPick() {
    try {
      const file = await imageUtil.chooseImage({ sourceType: ['album', 'camera'] })
      this.setData({ imagePath: file.tempFilePath, result: null, status: '' })
    } catch (e) {
      // 用户取消
    }
  },

  async onIdentify() {
    if (!this.data.imagePath) return
    this.setData({ loading: true, status: '壓縮並上傳中...' })
    try {
      const dataUrl = await imageUtil.toDataUrl(this.data.imagePath, 1200)
      this.setData({ status: 'AI 識別中...' })
      const body = await api.post('/api/ai', {
        mode: 'vehicle-image',
        image: dataUrl
      })
      const result = (body && body.vehicle) || body || {}
      this.setData({ result, status: '' })
    } catch (e) {
      this.setData({ status: (e && e.message) || '識別失敗，請稍後重試' })
    } finally {
      this.setData({ loading: false })
    }
  }
})