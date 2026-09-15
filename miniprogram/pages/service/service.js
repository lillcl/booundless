const api = require('../../utils/api.js')
const auth = require('../../utils/auth.js')
const enums = require('../../constants/enums.js')

function unwrapList(body) {
  if (!body) return []
  if (Array.isArray(body)) return body
  if (body.data !== undefined) return Array.isArray(body.data) ? body.data : []
  return []
}

const CATEGORY_LABELS = {
  maintenance: '保養',
  repair: '維修',
  inspection: '檢查',
  tires: '輪胎',
  other: '其他'
}

Page({
  data: {
    vehicles: [],
    vehicleLabels: [],
    vehicleIndex: 0,
    selectedVehicleId: '',
    groupedTypes: []
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
      const [typesBody, vehiclesBody] = await Promise.all([
        api.get('/api/service-item-types'),
        api.get('/api/vehicles').catch(() => null)
      ])
      const types = unwrapList(typesBody)
      const vehicles = unwrapList(vehiclesBody)

      // 按 category 分组
      const groups = {}
      for (const t of types) {
        const cat = t.category || 'other'
        if (!groups[cat]) groups[cat] = []
        const label = (t.display_names && t.display_names['zh-Hant']) || enums.SERVICE_LABEL[t.key] || t.key
        groups[cat].push({ key: t.key, label })
      }
      const grouped = Object.keys(groups).map(cat => ({
        category: cat,
        categoryLabel: CATEGORY_LABELS[cat] || cat,
        items: groups[cat]
      }))

      this.setData({
        groupedTypes: grouped,
        vehicles,
        vehicleLabels: ['（不綁定）'].concat(vehicles.map(v => v.model + (v.plate ? ' · ' + v.plate : '')))
      })
    } catch (e) {
      wx.showToast({ title: (e && e.message) || '載入失敗', icon: 'none' })
    }
  },

  onVehicleChange(e) {
    const idx = Number(e.detail.value)
    const vehicle = idx === 0 ? null : this.data.vehicles[idx - 1]
    this.setData({
      vehicleIndex: idx,
      selectedVehicleId: vehicle ? vehicle.id : ''
    })
  },

  onItemTap(e) {
    const key = e.currentTarget.dataset.key
    const name = e.currentTarget.dataset.name
    if (!this.data.selectedVehicleId) {
      wx.showToast({ title: '請先選擇車輛', icon: 'none' })
      return
    }
    wx.navigateTo({
      url: '/pages/dealer-matches/dealer-matches?vehicleId=' + this.data.selectedVehicleId + '&serviceKey=' + key + '&serviceName=' + encodeURIComponent(name)
    })
  }
})