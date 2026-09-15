const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const format = require('../../utils/format.js')
const imageUtil = require('../../utils/image.js')

Page({
  data: {
    vehicles: [],
    loaded: false,
    sheetVisible: false,
    saving: false,
    status: '',
    statusTone: 'info',
    fuelTypes: ['汽油', '柴油', '混能', '純電動', 'LPG', '其他'],
    fuelIndex: 0,
    form: { model: '', make: '', year: '', plate: '', mileage_km: '', image: '' },
    dialog: { visible: false, mode: 'notice', title: '', message: '' }
  },

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
      const body = await api.get('/api/vehicles')
      const list = Array.isArray(body) ? body : (body && body.data) || []
      this.setData({
        vehicles: list.map(v => ({
          id: v.id,
          model: v.model || v.make || '未命名',
          plate: v.plate || '',
          mileageLabel: format.mileageLabel(v.mileage_km),
          image: v.image || '',
          hint: v.team === 'family' ? '家用' : '個人'
        })),
        loaded: true
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '載入失敗', icon: 'none' })
      this.setData({ loaded: true })
    }
  },

  onVehicleTap(e) {
    const id = (e.detail && e.detail.id) || ''
    wx.navigateTo({ url: '/pages/vehicle-detail/vehicle-detail?id=' + id })
  },

  onAdd() {
    this.setData({
      sheetVisible: true,
      form: { model: '', make: '', year: '', plate: '', mileage_km: '', image: '' },
      fuelIndex: 0,
      status: ''
    })
  },

  closeSheet() { this.setData({ sheetVisible: false }) },

  onModelInput(e) { this.setData({ 'form.model': e.detail.value }) },
  onMakeInput(e) { this.setData({ 'form.make': e.detail.value }) },
  onYearInput(e) { this.setData({ 'form.year': e.detail.value }) },
  onPlateInput(e) { this.setData({ 'form.plate': e.detail.value }) },
  onMileageInput(e) { this.setData({ 'form.mileage_km': e.detail.value }) },
  onFuelChange(e) { this.setData({ fuelIndex: Number(e.detail.value) }) },

  async onPickImage() {
    try {
      const file = await imageUtil.chooseImage({ sourceType: ['album', 'camera'] })
      const dataUrl = await imageUtil.toDataUrl(file.tempFilePath, 1200)
      this.setData({ 'form.image': dataUrl })
    } catch (e) {
      // 用户取消
    }
  },

  onClearImage() { this.setData({ 'form.image': '' }) },

  async onSubmit() {
    const f = this.data.form
    if (!f.model) {
      this.setData({ status: '請填寫型號', statusTone: 'error' })
      return
    }
    this.setData({ saving: true, status: '', statusTone: 'info' })
    try {
      const body = {
        model: f.model,
        make: f.make || undefined,
        year: f.year ? Number(f.year) : undefined,
        fuel_type: this.data.fuelTypes[this.data.fuelIndex],
        plate: f.plate || undefined,
        mileage_km: f.mileage_km ? Number(f.mileage_km) : undefined,
        image: f.image || undefined
      }
      await api.post('/api/vehicles', body)
      this.setData({ status: '已新增', statusTone: 'ok' })
      await this.load()
      setTimeout(() => this.setData({ sheetVisible: false, status: '' }), 600)
    } catch (e) {
      this.setData({ status: (e && e.message) || '新增失敗', statusTone: 'error' })
    } finally {
      this.setData({ saving: false })
    }
  },

  showDialog(opts) {
    this.setData({ dialog: Object.assign({ visible: true }, opts) })
  },
  onDialogConfirm() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) },
  onDialogCancel() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) }
})