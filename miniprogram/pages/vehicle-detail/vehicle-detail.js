const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')
const enums = require('../../constants/enums.js')

Page({
  data: {
    id: '',
    vehicle: null,
    statusItems: [],
    attentionCount: 0,
    history: [],
    dialog: { visible: false, mode: 'notice', title: '', message: '' }
  },

  onLoad(query) {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    const id = (query && query.id) || ''
    this.setData({ id })
    wx.setNavigationBarTitle({ title: '車輛詳情' })
  },

  onShow() {
    if (this.data.id) this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    try {
      const [vehicle, status, history] = await Promise.all([
        api.get('/api/vehicles/' + this.data.id),
        api.get('/api/vehicles/' + this.data.id + '/status'),
        api.get('/api/vehicles/' + this.data.id + '/history')
      ])

      const v = vehicle && vehicle.id ? vehicle : (vehicle && vehicle.data) || {}
      const items = (status && status.items) || []
      const hist = Array.isArray(history) ? history : (history && history.data) || []

      this.setData({
        vehicle: {
          id: v.id,
          model: v.model || v.make || '未命名',
          plate: v.plate || '',
          mileageLabel: format.mileageLabel(v.mileage_km),
          year: v.year,
          fuel_type: v.fuel_type,
          image: v.image || ''
        },
        statusItems: items.map(it => ({
          item: it.item,
          label: enums.SERVICE_LABEL[it.service_item_type_key] || it.item,
          wear: it.wear || 0
        })),
        attentionCount: (status && status.attention_count) || items.filter(i => i.wear >= enums.WEAR_ATTENTION).length,
        history: hist.map(h => ({
          id: h.id,
          title: h.title || h.kind || '服務',
          dateLabel: format.formatDate(h.performed_at),
          kind: h.kind,
          mileage_km: h.mileage_km,
          notes: h.notes || ''
        }))
      })
    } catch (e) {
      this.showDialog({ mode: 'notice', title: '載入失敗', message: (e && e.message) || '請稍後重試' })
    }
  },

  onRequestService() {
    if (!this.data.id) return
    wx.navigateTo({ url: '/pages/dealer-matches/dealer-matches?vehicleId=' + this.data.id })
  },

  onOpenAiChat() {
    wx.navigateTo({ url: '/pages/ai-chat/ai-chat?vehicleId=' + this.data.id })
  },

  showDialog(opts) { this.setData({ dialog: Object.assign({ visible: true }, opts) }) },
  onDialogConfirm() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) },
  onDialogCancel() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) }
})