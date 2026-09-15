const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')
const enums = require('../../constants/enums.js')

Page({
  data: {
    id: '',
    request: null,
    acting: false,
    dialog: { visible: false, mode: 'notice', title: '', message: '' }
  },

  onLoad(query) {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    this.setData({ id: (query && query.id) || '' })
    wx.setNavigationBarTitle({ title: '請求詳情' })
  },

  onShow() {
    if (this.data.id) this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    try {
      const list = await api.get('/api/service-requests')
      const arr = Array.isArray(list) ? list : (list && list.data) || []
      const r = arr.find(x => x.id === this.data.id)
      if (!r) {
        this.showDialog({ mode: 'notice', title: '找不到請求', message: '可能已被刪除' })
        return
      }
      this.setData({ request: r })
    } catch (e) {
      this.showDialog({ mode: 'notice', title: '載入失敗', message: (e && e.message) || '' })
    }
  },

  async _act(action, extra) {
    if (!this.data.request) return
    this.setData({ acting: true })
    try {
      const body = Object.assign({ action, version: this.data.request.version || 0 }, extra || {})
      const updated = await api.post('/api/service-requests/' + this.data.id, body)
      this.setData({ request: updated.request || updated })
      wx.showToast({ title: '已更新', icon: 'success' })
    } catch (e) {
      const code = e && e.code
      if (code === 'http_409' || code === 'workflow_required') {
        wx.showToast({ title: '已有更新，請重新整理', icon: 'none' })
      } else {
        wx.showToast({ title: (e && e.message) || '操作失敗', icon: 'none' })
      }
    } finally {
      this.setData({ acting: false })
    }
  },

  onAcceptQuote() {
    const quote = (this.data.request.quotes || [])[0]
    if (!quote) return wx.showToast({ title: '沒有可接受的報價', icon: 'none' })
    this._act('accept_quote', { quote_id: quote.id })
  },

  onConfirmCompletion() {
    this._act('confirm_completion')
  },

  onCancel() {
    this.setData({ dialog: { visible: true, mode: 'confirm', title: '取消請求', message: '確定要取消此服務請求嗎？', confirmText: '取消請求' } })
  },

  async onDialogConfirm() {
    const mode = this.data.dialog.mode
    this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) })
    if (mode === 'confirm') {
      this._act('cancel')
    }
  },

  onDialogCancel() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) },
  showDialog(opts) { this.setData({ dialog: Object.assign({ visible: true }, opts) }) },

  statusLabel(key) { return enums.statusLabel(key) },
  statusTone(key) { return enums.statusPillClass(key).replace('kc-pill--', '') },
  serviceLabel(key) { return enums.SERVICE_LABEL[key] || key },
  formatDate(d) { return format.formatDate(d) },
  formatMoney(minor, currency) { return format.formatMoney(minor, currency) }
})