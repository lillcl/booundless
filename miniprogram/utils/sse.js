// utils/sse.js — 处理 /api/agent 的 text/event-stream 流式响应
// 微信小程序 wx.request 不暴露 onChunkReceived；此处用 enableChunked + onChunkReceived 解析事件。
// 若平台不支持降级为普通 POST，返回整段 text。

const api = require('./api.js')

function consumeAgent({ message, threadId, confirmation, onEvent, signal }) {
  return new Promise((resolve, reject) => {
    const baseUrl = api.getBaseUrl()
    const token = require('./storage.js').getToken()
    const header = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream'
    }
    if (token) header['Authorization'] = 'Bearer ' + token

    const body = {
      message,
      thread_id: threadId,
      confirmation,
      stream: true
    }

    const task = wx.request({
      url: baseUrl.replace(/\/$/, '') + '/api/agent',
      method: 'POST',
      data: body,
      header,
      enableChunked: true,
      responseType: 'arraybuffer',
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const text = decodeArrayBuffer(res.data)
            const events = parseEvents(text)
            let last = null
            for (const ev of events) {
              try {
                const parsed = JSON.parse(ev.data)
                last = parsed
                if (onEvent) onEvent(parsed)
              } catch (e) {}
            }
            resolve(last)
          } catch (e) {
            reject({ code: 'parse_error', message: '回應解析失敗', detail: e })
          }
        } else if (res.statusCode === 401) {
          reject({ code: 'unauthorized', message: '請先登入' })
        } else {
          let errBody
          try { errBody = JSON.parse(decodeArrayBuffer(res.data)) } catch (e) { errBody = null }
          reject({ code: (errBody && errBody.error && errBody.error.code) || 'http_' + res.statusCode, message: (errBody && errBody.error && errBody.error.message) || '請求失敗' })
        }
      },
      fail(err) {
        reject({ code: 'network_error', message: '網絡異常', detail: err })
      }
    })

    if (signal && typeof signal === 'function') {
      // 透传取消能力（小程序 wx.request 不支持 abort，这里仅占位）
    }
    return task
  })
}

function decodeArrayBuffer(ab) {
  if (!ab) return ''
  if (typeof ab === 'string') return ab
  // wx.request 在 enableChunked + arraybuffer 时，回包可能是 arraybuffer 或字符串
  try {
    const bytes = new Uint8Array(ab)
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return decodeURIComponent(escape(s))
  } catch (e) {
    return ''
  }
}

function parseEvents(raw) {
  // SSE 事件以 \n\n 分隔，每个事件多行 "key: value"
  const out = []
  const chunks = raw.split(/\n\n/)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const lines = chunk.split(/\n/)
    const ev = { event: 'message', data: '' }
    for (const line of lines) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const k = line.slice(0, idx).trim()
      const v = line.slice(idx + 1).trim()
      if (k === 'event') ev.event = v
      else if (k === 'data') ev.data = (ev.data ? ev.data + '\n' : '') + v
    }
    if (ev.data) out.push(ev)
  }
  return out
}

module.exports = { consumeAgent, parseEvents }