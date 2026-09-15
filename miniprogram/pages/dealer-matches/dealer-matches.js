const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')
const enums = require('../../constants/enums.js')

Page({
  data: {
    vehicleId: '',
    vehicleLabel: '',
    serviceKey: '',
    serviceLabel: '',
    branches: [],
    sheetVisible: false,
    selectedBranch: null,
    selectedMatch: null,
    form: { message: '' },
    submitting: false,
    status: '',
    statusTone: 'info',
    dialog: { visible: false, mode: 'notice', title: '', message: '' }
  },

  onLoad(query) {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    this.setData({
      vehicleId: (query && query.vehicleId) || '',
      serviceKey: (query && query.serviceKey) || '',
      serviceLabel: (query && query.serviceName) ? decodeURIComponent(query.serviceName) : ''
    })
    if (this.data.vehicleId) this.load()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  async load() {
    try {
      const body = await api.get('/api/vehicles/' + this.data.vehicleId + '/dealer-matches')
      const branches = (body && body.branches) || []
      const vehicle = body && body.vehicle
      this.setData({
        vehicleLabel: (vehicle && (vehicle.model + (vehicle.plate ? ' · ' + vehicle.plate : ''))) || '',
        branches: branches.map(b => ({
          dealer_id: b.dealer_id,
          dealer_name: b.dealer_name,
          branch_id: b.branch_id,
          branch_name: b.branch_name,
          address: b.address,
          sponsored: b.sponsored,
          coverage: b.coverage,
          uncovered_needs: b.uncovered_needs || [],
          matches: (b.matches || []).map(m => ({
            dealer_service_item_id: m.dealer_service_item_id,
            service_item_type_key: m.service_item_type_key,
            service_name: m.service_name,
            description: m.description,
            price_min: m.price_min,
            price_max: m.price_max,
            currency: m.currency,
            match_score: m.match_score,
            match_level: m.match_level
          }))
        }))
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '載入失敗', icon: 'none' })
    }
  },

  matchLevelLabel(level) {
    return enums.matchLevelPill(level)
  },

  formatPriceRange(min, max, currency) {
    const sym = format.currencySymbol(currency || 'MOP')
    if (min && max && min !== max) return sym + ' ' + min + ' ~ ' + max
    if (min) return sym + ' ' + min
    if (max) return sym + ' ' + max
    return ''
  },

  onRequest(e) {
    const branch = e.currentTarget.dataset.branch
    const match = (branch.matches || []).find(m => m.service_item_type_key === this.data.serviceKey) || (branch.matches || [])[0]
    this.setData({
      sheetVisible: true,
      selectedBranch: branch,
      selectedMatch: match,
      form: { message: '' },
      status: ''
    })
  },

  closeSheet() { this.setData({ sheetVisible: false }) },

  onMessageInput(e) { this.setData({ 'form.message': e.detail.value }) },

  async onSubmit() {
    if (!this.data.selectedBranch || !this.data.selectedMatch) {
      this.setData({ status: '缺少必要資料', statusTone: 'error' })
      return
    }
    this.setData({ submitting: true, status: '', statusTone: 'info' })
    try {
      const body = {
        dealer_id: this.data.selectedBranch.dealer_id,
        branch_id: this.data.selectedBranch.branch_id,
        dealer_service_item_id: this.data.selectedMatch.dealer_service_item_id,
        service_ids: [this.data.selectedMatch.dealer_service_item_id],
        message: this.data.form.message || undefined,
        request_key: format.uuid()
      }
      const res = await api.post('/api/vehicles/' + this.data.vehicleId + '/service-requests', body)
      this.setData({ status: '已送出請求，等待商戶回覆', statusTone: 'ok' })
      setTimeout(() => {
        this.setData({ sheetVisible: false })
        const id = (res && res.id) || (res && res.request && res.request.id)
        if (id) {
          wx.navigateTo({ url: '/pages/request-detail/request-detail?id=' + id })
        }
      }, 600)
    } catch (e) {
      this.setData({ status: (e && e.message) || '送出失敗', statusTone: 'error' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  showDialog(opts) { this.setData({ dialog: Object.assign({ visible: true }, opts) }) },
  onDialogConfirm() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) },
  onDialogCancel() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) }
})