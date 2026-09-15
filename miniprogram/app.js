// app.js — 全局入口
const api = require('./utils/api.js')
const auth = require('./utils/auth.js')
const storage = require('./utils/storage.js')

App({
  globalData: {
    // 修改此处为你的 API 域名（须 HTTPS、备案、并在小程序后台「开发 → 服务器域名」加入白名单）
    baseUrl: 'https://api.booundless.com',
    // 微信小程序 AppID（替换为你在微信公众平台注册的真实 AppID）
    appId: 'wxYOUR_APPID_HERE',
    // 是否为开发模式（true 时支持邮箱+密码登录，便于本地无 AppID 调试）
    __DEV__: true,
    // 当前用户缓存
    user: null,
    // 当前所选车辆（用于跨页面传递）
    currentVehicleId: null,
    // 设计 token（在 app.wxss 中也同步定义一份）
    tokens: {
      brand: '#073568',
      accent: '#c89b4b',
      ink: '#1a2233',
      muted: '#5b6675',
      line: '#e5e0d6',
      soft: '#f5f3ef',
      card: '#ffffff',
      green: '#1f7a5a',
      greenBg: '#e6f4ec',
      amber: '#b8730e',
      amberBg: '#fbeed8',
      red: '#a83a3a',
      redBg: '#f6e1e1'
    }
  },

  async onLaunch() {
    // 静默获取微信 code（不弹窗），用于后续登录
    try {
      const loginRes = await new Promise((resolve, reject) => {
        wx.login({ success: resolve, fail: reject })
      })
      this.globalData.wxCode = loginRes.code
    } catch (e) {
      console.warn('wx.login 失败', e)
    }

    // 恢复本地 token + 用户信息
    const token = storage.getToken()
    const user = storage.getUser()
    if (token) this.globalData.user = user

    // 后台静默校验 token
    if (token) {
      api.get('/api/auth/me').then(res => {
        this.globalData.user = res.user
        storage.setUser(res.user)
      }).catch(() => {
        // token 过期或无效
        storage.clearSession()
        this.globalData.user = null
      })
    }
  },

  onShow() {},

  onError(err) {
    console.error('[app] onError', err)
  }
})