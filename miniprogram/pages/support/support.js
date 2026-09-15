const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    form: { subject: '', message: '' },
    sending: false,
    status: '',
    statusTone: 'info'
  },

  onLoad() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
  },

  onSubjectInput(e) { this.setData({ 'form.subject': e.detail.value }) },
  onMessageInput(e) { this.setData({ 'form.message': e.detail.value }) },

  async onSubmit() {
    if (!this.data.form.subject || !this.data.form.message) return
    this.setData({ sending: true, status: '', statusTone: 'info' })
    try {
      await api.post('/api/profile/support', this.data.form)
      this.setData({ form: { subject: '', message: '' }, status: '已送出，感謝你的回饋', statusTone: 'ok' })
    } catch (e) {
      this.setData({ status: (e && e.message) || '送出失敗', statusTone: 'error' })
    } finally {
      this.setData({ sending: false })
    }
  }
})