// utils/storage.js — 命名空间化的本地存储
const PREFIX = 'kc_mp_'
const TOKEN_KEY = PREFIX + 'token'
const USER_KEY = PREFIX + 'user'

function safeGet(key) {
  try {
    return wx.getStorageSync(key)
  } catch (e) {
    return null
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (e) {
    console.warn('storage set failed', key, e)
    return false
  }
}

function safeRemove(key) {
  try { wx.removeStorageSync(key) } catch (e) {}
}

module.exports = {
  getToken() { return safeGet(TOKEN_KEY) },
  setToken(token) { return safeSet(TOKEN_KEY, token) },
  getUser() { return safeGet(USER_KEY) },
  setUser(user) { return safeSet(USER_KEY, user) },
  clearSession() {
    safeRemove(TOKEN_KEY)
    safeRemove(USER_KEY)
  },
  get(key, fallback) {
    const v = safeGet(PREFIX + key)
    return v === null || v === undefined ? fallback : v
  },
  set(key, value) { return safeSet(PREFIX + key, value) },
  remove(key) { safeRemove(PREFIX + key) }
}