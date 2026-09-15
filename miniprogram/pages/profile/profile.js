const auth = require('../../utils/auth.js')
const storage = require('../../utils/storage.js')

Page({
  data: {
    user: {},
    dialog: { visible: false, mode: 'notice', title: '', message: '' }
  },

  onShow() {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    try {
      const app = getApp()
      const user = (app && app.globalData && app.globalData.user) || storage.getUser() || {}
      this.setData({ user })
    } catch (e) {}
  },

  onGarage() { wx.switchTab({ url: '/pages/garage/garage' }) },
  onRequests() { wx.navigateTo({ url: '/pages/requests/requests' }) },
  onHistory() { wx.navigateTo({ url: '/pages/history/history' }) },
  onNotifications() { wx.navigateTo({ url: '/pages/notifications/notifications' }) },
  onTeam() { wx.navigateTo({ url: '/pages/team/team' }) },
  onSupport() { wx.navigateTo({ url: '/pages/support/support' }) },
  onAbout() { wx.navigateTo({ url: '/pages/about/about' }) },

  onLogout() {
    this.setData({ dialog: { visible: true, mode: 'confirm', title: '登出', message: '確定要登出嗎？', confirmText: '登出' } })
  },

  async onDialogConfirm() {
    const mode = this.data.dialog.mode
    this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) })
    if (mode === 'confirm') {
      await auth.logout()
      wx.redirectTo({ url: '/pages/landing/landing' })
    }
  },

  onDialogCancel() { this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) }) }
})