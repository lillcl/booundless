const auth = require('../../utils/auth.js')

Page({
  onEnter() {
    // 直接进入主页（首页已在 tabBar 注册）
    wx.switchTab({ url: '/pages/home/home' })
  },

  onLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  onLoad() {
    // 已登录则跳过
    if (auth.isLoggedIn()) {
      wx.switchTab({ url: '/pages/home/home' })
    }
  }
})