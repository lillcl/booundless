const sse = require('../../utils/sse.js')
const auth = require('../../utils/auth.js')

let messageSeq = 0
function nextId() { return 'm-' + Date.now() + '-' + (++messageSeq) }

Page({
  data: {
    threadId: null,
    messages: [],
    draft: '',
    loading: false,
    scrollIntoView: '',
    dialog: { visible: false, mode: 'notice', title: '', message: '' }
  },

  onLoad(query) {
    if (!auth.isLoggedIn()) {
      wx.redirectTo({ url: '/pages/landing/landing' })
      return
    }
    if (query && query.preset === 'trip') {
      this.setData({ draft: '幫我規劃珠海 → 澳門一日自駕路線' })
    }
    this.pushMessage({
      id: nextId(),
      role: 'bot',
      text: '你好，我是無界啟程的 AI 助手。你可以詢問車輛保養、行程資訊或服務項目；回覆只作參考，車況和服務細節請再向專業人士或車行確認。'
    })
  },

  onInput(e) { this.setData({ draft: e.detail.value }) },

  pushMessage(msg) {
    const list = this.data.messages.concat([msg])
    this.setData({ messages: list, scrollIntoView: 'chat-end' })
  },

  replaceLast(predicate, replacer) {
    const list = this.data.messages.slice()
    for (let i = list.length - 1; i >= 0; i--) {
      if (predicate(list[i])) {
        list[i] = replacer(list[i])
        this.setData({ messages: list, scrollIntoView: 'chat-end' })
        return
      }
    }
  },

  onSend() {
    const text = (this.data.draft || '').trim()
    if (!text || this.data.loading) return
    this.setData({ draft: '', loading: true })
    this.pushMessage({ id: nextId(), role: 'user', text })

    sse.consumeAgent({
      message: text,
      threadId: this.data.threadId,
      onEvent: (ev) => this.handleEvent(ev)
    }).then((last) => {
      if (last && last.thread_id) this.setData({ threadId: last.thread_id })
      this.setData({ loading: false })
    }).catch((e) => {
      this.setData({ loading: false })
      this.pushMessage({ id: nextId(), role: 'bot', text: '（連線錯誤：' + ((e && e.message) || '稍後重試') + '）' })
    })
  },

  handleEvent(ev) {
    if (!ev || !ev.type) return
    if (ev.type === 'text') {
      this.replaceLast(m => m.role === 'bot' && m.streaming, m => Object.assign({}, m, { text: (m.text || '') + (ev.text || '') }))
      const list = this.data.messages
      const last = list[list.length - 1]
      if (!last || last.role !== 'bot' || !last.streaming) {
        this.pushMessage({ id: nextId(), role: 'bot', text: ev.text || '', streaming: true })
      }
    } else if (ev.type === 'tool_activity') {
      this.pushMessage({
        id: nextId(),
        role: 'bot',
        type: 'tool',
        toolName: ev.tool_name,
        toolStatus: ev.status,
        text: ''
      })
    } else if (ev.type === 'confirmation_required') {
      this.setData({
        dialog: {
          visible: true,
          mode: 'confirm',
          title: 'AI 請求確認',
          message: 'AI 想要執行「' + (ev.tool_name || '') + '」操作，是否同意？',
          confirmText: '同意',
          toolCallId: ev.tool_call_id
        }
      })
    } else if (ev.type === 'done') {
      this.replaceLast(m => m.streaming, m => Object.assign({}, m, { streaming: false }))
    } else if (ev.type === 'error') {
      this.pushMessage({ id: nextId(), role: 'bot', text: '（錯誤：' + (ev.message || '') + '）' })
    }
  },

  onDialogConfirm() {
    const dlg = this.data.dialog
    this.setData({ dialog: Object.assign({}, dlg, { visible: false }) })
    if (dlg.mode === 'confirm' && dlg.toolCallId) {
      // 重新发起一次 agent 调用，把 confirmation 提交
      this.setData({ loading: true })
      sse.consumeAgent({
        message: null,
        threadId: this.data.threadId,
        confirmation: { tool_call_id: dlg.toolCallId, approved: true },
        onEvent: (ev) => this.handleEvent(ev)
      }).then(() => this.setData({ loading: false }))
        .catch((e) => {
          this.setData({ loading: false })
          this.pushMessage({ id: nextId(), role: 'bot', text: '（連線錯誤：' + ((e && e.message) || '') + '）' })
        })
    }
  },

  onDialogCancel() {
    const dlg = this.data.dialog
    this.setData({ dialog: Object.assign({}, dlg, { visible: false }) })
    if (dlg.mode === 'confirm' && dlg.toolCallId) {
      this.setData({ loading: true })
      sse.consumeAgent({
        message: null,
        threadId: this.data.threadId,
        confirmation: { tool_call_id: dlg.toolCallId, approved: false },
        onEvent: (ev) => this.handleEvent(ev)
      }).then(() => this.setData({ loading: false }))
        .catch(() => this.setData({ loading: false }))
    }
  }
})
