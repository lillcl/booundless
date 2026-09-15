// utils/auth.js — 微信登录 / 邮箱登录 / 登出
const api = require('./api.js')
const storage = require('./storage.js')

function getApp() {
  try { return getApp() } catch (e) { return null }
}

async function silentWxCode(forceFresh) {
  try {
    const app = getApp()
    if (!forceFresh && app && app.globalData && app.globalData.wxCode) {
      return app.globalData.wxCode
    }
  } catch (e) {}
  return new Promise((resolve, reject) => {
    wx.login({
      success(res) { resolve(res.code) },
      fail(err) { reject(err) }
    })
  })
}

// 微信登录：wx.login → /api/auth/wechat → JWT
async function loginWithWechat(extra) {
  const code = await silentWxCode(true)
  const body = await api.post('/api/auth/wechat', Object.assign({ code: code }, extra || {}))
  if (body && body.token) {
    storage.setToken(body.token)
    storage.setUser(body.user || null)
    try {
      const app = getApp()
      if (app && app.globalData) app.globalData.user = body.user || null
    } catch (e) {}
  }
  return body
}

// 邮箱 + 密码登录（开发期或服务端未启用微信登录时使用）
async function loginWithEmail(email, password) {
  const body = await api.post('/api/auth/login', { email, password })
  if (body && body.token) {
    storage.setToken(body.token)
    storage.setUser(body.user || null)
    try {
      const app = getApp()
      if (app && app.globalData) app.globalData.user = body.user || null
    } catch (e) {}
  }
  return body
}

async function logout() {
  try { await api.post('/api/auth/logout', {}) } catch (e) {}
  storage.clearSession()
  try {
    const app = getApp()
    if (app && app.globalData) app.globalData.user = null
  } catch (e) {}
}

function getProfile() {
  return api.get('/api/auth/me').then(res => {
    if (res && res.user) storage.setUser(res.user)
    return res
  })
}

function isLoggedIn() {
  return !!storage.getToken()
}

module.exports = {
  silentWxCode,
  loginWithWechat,
  loginWithEmail,
  logout,
  getProfile,
  isLoggedIn
}