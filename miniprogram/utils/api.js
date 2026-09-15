// utils/api.js — 统一 API 客户端（基于 wx.request）
// 错误封装 {error:{code,message}} 与 web 端一致；成功响应解包后直接返回 data

const paths = require('../constants/api-paths.js')
const storage = require('./storage.js')

function getApp() {
  return getApp ? getApp() : null
}

function getBaseUrl() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    return (app && app.globalData && app.globalData.baseUrl) || 'https://api.booundless.com'
  } catch (e) {
    return 'https://api.booundless.com'
  }
}

function buildHeader(extra) {
  const token = storage.getToken()
  const header = {
    'Content-Type': 'application/json',
    ...(extra || {})
  }
  if (token) {
    header['Authorization'] = 'Bearer ' + token
  }
  return header
}

// 单次请求
function request({ url, method = 'GET', data, header, timeout = 30000 }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: url,
      method,
      data: data || {},
      header: buildHeader(header),
      timeout,
      success(res) {
        const status = res.statusCode
        const body = res.data
        if (status >= 200 && status < 300) {
          resolve(body)
        } else if (status === 401) {
          storage.clearSession()
          reject({ code: 'unauthorized', message: '請先登入', status, body })
        } else if (body && body.error) {
          reject({ code: body.error.code, message: body.error.message, status, body })
        } else {
          reject({ code: 'http_' + status, message: '伺服器錯誤（' + status + '）', status, body })
        }
      },
      fail(err) {
        reject({ code: 'network_error', message: '網絡異常，請稍後重試', detail: err })
      }
    })
  })
}

// 便捷方法
function join(base, path) {
  if (!path) return base
  if (path.startsWith('http')) return path
  return base.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path)
}

function fullUrl(pathOrUrl) {
  return join(getBaseUrl(), pathOrUrl)
}

module.exports = {
  request,
  fullUrl,

  get(path, opts) { return request(Object.assign({ url: fullUrl(path), method: 'GET' }, opts || {})) },
  post(path, data, opts) { return request(Object.assign({ url: fullUrl(path), method: 'POST', data: data || {} }, opts || {})) },
  patch(path, data, opts) { return request(Object.assign({ url: fullUrl(path), method: 'PATCH', data: data || {} }, opts || {})) },
  put(path, data, opts) { return request(Object.assign({ url: fullUrl(path), method: 'PUT', data: data || {} }, opts || {})) },
  delete(path, opts) { return request(Object.assign({ url: fullUrl(path), method: 'DELETE' }, opts || {})) },

  // 解包响应：后端有时返回 {data:[...]}，有时返回裸数组/对象
  unwrap(body) {
    if (!body) return body
    if (Array.isArray(body)) return body
    if (body.data !== undefined) return body.data
    return body
  },

  paths,

  getBaseUrl
}