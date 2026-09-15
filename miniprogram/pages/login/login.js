const auth = require('../../utils/auth.js')

Page({
  data: {
    devMode: false,
    email: '',
    password: '',
    loading: false,
    status: '',
    statusTone: 'info',
    dialog: { visible: false, mode: 'notice', title: '', message: '' }
  },

  onLoad() {
    try {
      const app = getApp()
      this.setData({ devMode: !!(app && app.globalData && app.globalData.__DEV__) })
    } catch (e) {}
  },

  onEmailInput(e) { this.setData({ email: e.detail.value }) },
  onPasswordInput(e) { this.setData({ password: e.detail.value }) },

  async onEmailLogin() {
    if (!this.data.email || !this.data.password) return
    this.setData({ loading: true, status: '', statusTone: 'info' })
    try {
      await auth.loginWithEmail(this.data.email, this.data.password)
      wx.switchTab({ url: '/pages/home/home' })
    } catch (e) {
      this.setData({ status: (e && e.message) || '登入失敗', statusTone: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async onWechatLogin() {
    this.setData({ loading: true, status: '', statusTone: 'info' })
    try {
      // 抓取用户资料（如有），传给服务端做头像/昵称绑定
      let profile = {}
      try {
        const res = await new Promise((resolve, reject) => {
          wx.getUserProfile({
            desc: '用於完善您的帳戶資料',
            success: resolve,
            fail: () => resolve(null) // 用户拒绝时静默
          })
        })
        if (res && res.userInfo) {
          profile = {
            nickname: res.userInfo.nickName,
            avatar_url: res.userInfo.avatarUrl,
            gender: res.userInfo.gender
          }
        }
      } catch (e) {}

      await auth.loginWithWechat(profile)
      wx.switchTab({ url: '/pages/home/home' })
    } catch (e) {
      const msg = (e && e.message) || '微信登入失敗'
      this.setData({ status: msg, statusTone: 'error' })
      this.showDialog({ mode: 'notice', title: '登入失敗', message: msg })
    } finally {
      this.setData({ loading: false })
    }
  },

  showDialog(opts) {
    this.setData({ dialog: Object.assign({ visible: true }, opts) })
  },
  onDialogConfirm() {
    this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) })
  },
  onDialogCancel() {
    this.setData({ dialog: Object.assign({}, this.data.dialog, { visible: false }) })
  },

  onAbout() {
    wx.navigateTo({ url: '/pages/about/about' })
  }
})