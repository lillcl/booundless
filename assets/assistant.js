import { resolveAssistantRoute } from '../shared/assistant-routes.js';

const THREAD_KEY = 'kc_assistant_thread';
const MESSAGES_KEY = 'kc_assistant_messages';
const USER_KEY = 'kc_assistant_user';
const MAX_SAVED_MESSAGES = 30;
const MASCOT_URL = '/assets/mascot/jiezai-assistant.webp';

function friendlyAssistantError(value) {
  const message = String(value || '');
  if (/tool result['’]s tool id|invalid params|\(2013\)|internal server error/i.test(message)) {
    return '界仔剛才未能完成工具查詢，請再試一次。';
  }
  return message || 'AI 助手暫時無法回覆，請稍後再試。';
}

function pageContext() {
  const isGuide = location.pathname === '/guide' || location.pathname.endsWith('/qinao-guide.html');
  const hash = location.hash || '';
  return {
    path: isGuide ? '/guide' : location.pathname,
    hash,
    route: isGuide ? 'guide' : hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'landing',
    section: isGuide ? hash.replace(/^#/, '') : '',
    title: document.title,
    locale: document.documentElement.lang || 'zh-Hant',
  };
}

function safeLoadMessages() {
  try {
    const value = JSON.parse(localStorage.getItem(MESSAGES_KEY) || '[]');
    return Array.isArray(value) ? value.slice(-MAX_SAVED_MESSAGES)
      .filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item.text === 'string')
      .map((item) => item.role === 'assistant' ? { ...item, text: friendlyAssistantError(item.text) } : item) : [];
  } catch { return []; }
}

function saveMessages(messages) {
  try { localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-MAX_SAVED_MESSAGES))); } catch { /* storage is optional */ }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function renderAssistantText(element, value) {
  const fragment = document.createDocumentFragment();
  const appendInline = (parent, line) => {
    let cursor = 0;
    for (const match of line.matchAll(/\*\*(.+?)\*\*/g)) {
      parent.append(document.createTextNode(line.slice(cursor, match.index)));
      parent.append(createElement('strong', '', match[1]));
      cursor = match.index + match[0].length;
    }
    parent.append(document.createTextNode(line.slice(cursor)));
  };
  for (const rawLine of String(value || '').split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) { fragment.append(document.createElement('br')); continue; }
    const isBullet = /^[-•]\s+/.test(line);
    const row = createElement('span', isBullet ? 'assistant-text-line assistant-text-line--bullet' : 'assistant-text-line');
    appendInline(row, line.replace(/^#{1,4}\s+/, '').replace(/^[-•]\s+/, ''));
    fragment.append(row);
  }
  element.replaceChildren(fragment);
}

function buildAssistant() {
  if (document.querySelector('.booundless-assistant')) return;
  const root = createElement('aside', 'booundless-assistant');
  root.setAttribute('aria-label', '界仔 AI 助手');
  root.innerHTML = `
    <button class="assistant-launcher" type="button" aria-label="開啟界仔 AI 助手" aria-expanded="false">
      <span class="assistant-launcher__label">問界仔</span>
      <img src="${MASCOT_URL}" alt="">
    </button>
    <section class="assistant-panel" role="dialog" aria-modal="false" aria-labelledby="assistantTitle">
      <header class="assistant-header">
        <img class="assistant-header__avatar" src="${MASCOT_URL}" alt="">
        <div><b id="assistantTitle">界仔 · AI 車主助手</b><small>車輛、維修與琴澳同行</small></div>
        <button class="assistant-close" type="button" aria-label="關閉 AI 助手">×</button>
      </header>
      <div class="assistant-access"><span class="assistant-quota" role="status">正在確認登入狀態…</span><a class="assistant-login" href="/#/login" hidden>登入使用界仔</a><button class="assistant-new" type="button" aria-label="開始新對話">新對話</button></div>
      <div class="assistant-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="assistant-status" role="status" aria-live="polite"></div>
      <form class="assistant-composer">
        <textarea maxlength="4000" rows="1" aria-label="輸入問題" placeholder="問車輛、維修或琴澳同行…"></textarea>
        <button class="assistant-send" type="submit">送出</button>
        <button class="assistant-stop" type="button" hidden>停止</button>
      </form>
    </section>`;
  document.body.append(root);

  const launcher = root.querySelector('.assistant-launcher');
  const panel = root.querySelector('.assistant-panel');
  const close = root.querySelector('.assistant-close');
  const messagesRoot = root.querySelector('.assistant-messages');
  const form = root.querySelector('.assistant-composer');
  const input = form.querySelector('textarea');
  const sendButton = form.querySelector('.assistant-send');
  const status = root.querySelector('.assistant-status');
  const quotaLabel = root.querySelector('.assistant-quota');
  const loginLink = root.querySelector('.assistant-login');
  const stopButton = root.querySelector('.assistant-stop');
  let threadId = localStorage.getItem(THREAD_KEY) || null;
  let messages = [];
  let isBusy = false;
  let userId = null;
  let quota = null;
  let accessReady = false;
  let activeRequest = null;
  let resetTimer = null;

  function updateAccess() {
    const available = accessReady && userId && (quota?.unlimited || quota?.remaining > 0);
    input.disabled = isBusy || !available;
    sendButton.disabled = isBusy || !available;
    root.querySelectorAll('.assistant-quick-prompts button').forEach((button) => { button.disabled = isBusy || !available; });
    loginLink.hidden = !accessReady || Boolean(userId);
    quotaLabel.textContent = !accessReady ? '正在確認登入狀態…' : !userId ? '登入後使用 · 每個帳戶每日最多 5 次' : quota?.unlimited ? '管理員 · 提問次數不限' : quota ? `今日剩餘 ${quota.remaining}／${quota.limit} 次 · 澳門時間 00:00 重置` : '暫時未能取得今日額度，請稍後再試。';
  }

  function updateQuota(value) {
    if (!value) return;
    quota = value;
    clearTimeout(resetTimer);
    const wait = Date.parse(value.resets_at) - Date.now();
    if (wait > 0) resetTimer = setTimeout(() => refreshAccess(), Math.min(wait + 100, 86400100));
    updateAccess();
  }

  async function refreshAccess() {
    try {
      const response = await fetch('/api/agent', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.status !== 401 && !response.ok) throw new Error('Access check failed');
      const nextUser = response.ok ? data.user_id : null;
      const previous = localStorage.getItem(USER_KEY);
      if (previous !== nextUser) {
        localStorage.removeItem(THREAD_KEY); localStorage.removeItem(MESSAGES_KEY);
        threadId = null;
      }
      if (nextUser) localStorage.setItem(USER_KEY, nextUser);
      else localStorage.removeItem(USER_KEY);
      if (userId !== nextUser || !accessReady) {
        messagesRoot.replaceChildren(); messages = nextUser ? safeLoadMessages() : [];
        addWelcome();
        for (const message of messages) addMessage(message.role, message.text, { persist: false });
      }
      userId = nextUser; accessReady = true; quota = data.quota || null;
      updateQuota(quota); updateAccess();
    } catch {
      accessReady = true; quota = null; updateAccess();
      status.textContent = '暫時未能連線，請重新開啟界仔再試。';
    }
  }

  function scrollToEnd() { messagesRoot.scrollTop = messagesRoot.scrollHeight; }

  function addMessage(role, text, { persist = true } = {}) {
    const row = createElement('div', `assistant-message assistant-message--${role === 'user' ? 'user' : 'assistant'}`);
    if (role !== 'user') {
      const avatar = createElement('img', 'assistant-message__avatar');
      avatar.src = MASCOT_URL;
      avatar.alt = '';
      row.append(avatar);
    }
    const bubble = createElement('div', 'assistant-bubble');
    if (role === 'user') bubble.textContent = text;
    else renderAssistantText(bubble, text);
    row.append(bubble);
    messagesRoot.append(row);
    if (persist) {
      messages.push({ role, text });
      saveMessages(messages);
    }
    scrollToEnd();
    return bubble;
  }

  function addWelcome() {
    const welcome = createElement('div', 'assistant-welcome');
    const heading = createElement('b', '', '你好，我是界仔。');
    const copy = createElement('p', '', '登入後，我可以帶你使用網站、查找車輛維修與琴澳同行資料，以及查看你的車輛紀錄。一般帳戶每日最多 5 次 AI 使用，管理員不設提問次數上限。');
    welcome.append(heading, copy);
    const prompts = createElement('div', 'assistant-quick-prompts');
    const context = pageContext();
    const values = context.path === '/guide'
      ? ['橫琴單牌車和澳車北上有甚麼分別？', '北上維修報價要問甚麼？', '帶我去出發前檢查']
      : ['點樣新增第一架車？', '維修報價要問清楚甚麼？', '橫琴單牌車和澳車北上有甚麼分別？'];
    for (const value of values) {
      const button = createElement('button', '', value);
      button.type = 'button';
      button.addEventListener('click', () => sendMessage(value));
      prompts.append(button);
    }
    messagesRoot.append(welcome, prompts);
  }

  function addSources(items) {
    if (!Array.isArray(items) || !items.length) return;
    const card = createElement('div', 'assistant-tool');
    card.append(createElement('b', '', `已查閱 ${items.length} 個 BOOUNDLESS 資料來源`));
    const list = createElement('div', 'assistant-sources');
    for (const item of items.slice(0, 4)) {
      if (resolveAssistantRoute(item.route_key)?.href !== item.url) continue;
      const link = createElement('a', 'assistant-source');
      link.href = item.url;
      const title = createElement('span', '', item.title || item.source || '資料來源');
      const verified = createElement('small', '', item.verified_at ? `資料核對：${item.verified_at}` : 'BOOUNDLESS 已核對內容');
      link.append(title, verified);
      list.append(link);
    }
    card.append(list);
    messagesRoot.append(card);
    scrollToEnd();
  }

  function addNavigation(value) {
    const route = resolveAssistantRoute(value?.route_key);
    if (!route || route.href !== value?.href) return;
    const card = createElement('div', 'assistant-tool');
    card.append(createElement('b', '', value.reason || '相關頁面'));
    const button = createElement('button', 'assistant-action', `${route.label}  →`);
    button.type = 'button';
    button.addEventListener('click', () => { location.href = route.href; });
    card.append(button);
    messagesRoot.append(card);
    scrollToEnd();
  }

  function addConfirmation(event) {
    const card = createElement('div', 'assistant-confirm');
    card.append(createElement('p', '', event.message || `界仔準備執行 ${event.tool_name}，請確認。`));
    const fields = { model: '車款', make: '品牌', year: '年份', fuel_type: '動力', plate: '車牌', vin: '車架號', mileage_km: '公里數', vehicle_id: '車輛', title: '名稱', performed_at: '維修日期', kind: '類型', notes: '備註', cost: '費用', origin: '起點', destination: '目的地', start_at: '出發日期', distance_km: '距離（公里）', duration_min: '時間（分鐘）', maintenance_reminders: '保養提醒', trip_updates: '行程更新', ai_suggestions: 'AI 建議', subject: '主題', message: '內容' };
    const details = createElement('dl', 'assistant-confirm__details');
    for (const [key, value] of Object.entries(event.input || {})) {
      details.append(createElement('dt', '', fields[key] || key), createElement('dd', '', typeof value === 'boolean' ? (value ? '開啟' : '關閉') : typeof value === 'object' ? JSON.stringify(value) : String(value)));
    }
    card.append(details);
    const actions = createElement('div', 'assistant-confirm__actions');
    const approve = createElement('button', '', '確認執行'); approve.type = 'button'; approve.dataset.assistantApprove = 'true';
    const cancel = createElement('button', '', '取消'); cancel.type = 'button'; cancel.dataset.assistantCancel = 'true';
    actions.append(approve, cancel); card.append(actions); messagesRoot.append(card); scrollToEnd();
    approve.addEventListener('click', () => submitConfirmation(event.tool_call_id, true, card));
    cancel.addEventListener('click', () => submitConfirmation(event.tool_call_id, false, card));
  }

  function setBusy(busy, label = '') {
    isBusy = busy;
    stopButton.hidden = !busy;
    updateAccess();
    status.dataset.busy = String(busy);
    status.textContent = label;
  }

  async function consumeResponse(response, assistantBubble) {
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const payload = await response.json().catch(() => ({}));
      if (payload.quota) updateQuota(payload.quota);
      if (response.status === 401) await refreshAccess();
      const error = new Error(payload?.error?.message || `AI 助手暫時無法回覆 (${response.status})`);
      error.code = payload?.error?.code;
      error.requestId = payload?.error?.request_id;
      error.threadId = payload?.error?.thread_id;
      throw error;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const chunks = buffer.split(/\n\n/);
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((part) => part.startsWith('data:'));
        if (!line) continue;
        const event = JSON.parse(line.slice(5).trim());
        if (event.type === 'quota') {
          updateQuota(event.quota);
        } else if (event.type === 'text') {
          answer += event.text || '';
          renderAssistantText(assistantBubble, answer);
          scrollToEnd();
        } else if (event.type === 'tool_activity' && event.status === 'completed') {
          if (event.tool_name === 'search_site_knowledge') addSources(event.output?.data);
          if (event.tool_name === 'suggest_navigation') addNavigation(event.output?.data);
        } else if (event.type === 'confirmation_required') {
          addConfirmation(event);
        } else if (event.type === 'done') {
          updateQuota(event.result?.quota);
          if (event.result?.thread_id) {
            threadId = event.result.thread_id;
            localStorage.setItem(THREAD_KEY, threadId);
          }
          if (!answer && event.result?.text) {
            answer = event.result.text;
            renderAssistantText(assistantBubble, answer);
          }
        } else if (event.type === 'progress') {
          setBusy(true, event.message || '正在核對回覆');
        } else if (event.type === 'error') {
          const error = new Error(event.message || '界仔未能完成這次處理。');
          error.code = event.code; error.requestId = event.request_id; error.threadId = event.thread_id;
          throw error;
        }
      }
      if (done) break;
    }
    const finalText = answer || assistantBubble.textContent || '已完成。';
    renderAssistantText(assistantBubble, finalText);
    messages.push({ role: 'assistant', text: finalText });
    saveMessages(messages);
  }

  async function request(body, placeholder = '界仔正在整理資料…') {
    const controller = new AbortController();
    activeRequest = controller;
    setBusy(true, '正在查閱資料');
    const bubble = addMessage('assistant', placeholder, { persist: false });
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true, request_id: crypto.randomUUID(), thread_id: threadId, page_context: pageContext(), ...body }),
        signal: controller.signal,
      });
      await consumeResponse(response, bubble);
    } catch (error) {
      if (error.code === 'thread_not_found') { threadId = null; localStorage.removeItem(THREAD_KEY); }
      if (error.threadId) { threadId = error.threadId; localStorage.setItem(THREAD_KEY, threadId); }
      const message = error.name === 'AbortError' ? '已停止回覆。本次 AI 使用已計入今日額度。' : `${friendlyAssistantError(error?.message)}${error.requestId ? `\n查詢編號：${error.requestId.slice(0, 8)}` : ''}`;
      renderAssistantText(bubble, message);
      messages.push({ role: 'assistant', text: message });
      saveMessages(messages);
    } finally { activeRequest = null; setBusy(false, ''); await refreshAccess(); if (!input.disabled) input.focus(); }
  }

  async function sendMessage(value) {
    const text = String(value ?? input.value).trim();
    if (!text || isBusy || !userId || (!quota?.unlimited && !quota?.remaining)) return;
    input.value = '';
    addMessage('user', text);
    await request({ message: text });
  }

  async function submitConfirmation(toolCallId, approved, card) {
    if (!toolCallId || !threadId || isBusy) return;
    card.querySelectorAll('button').forEach((button) => { button.disabled = true; });
    await request({ confirmation: { tool_call_id: toolCallId, approved } }, approved ? '正在執行已確認的操作…' : '正在取消操作…');
    card.remove();
  }

  launcher.addEventListener('click', async () => {
    root.classList.add('is-open'); launcher.setAttribute('aria-expanded', 'true'); panel.removeAttribute('inert'); await refreshAccess(); if (!input.disabled) input.focus(); scrollToEnd();
  });
  root.querySelector('.assistant-new').addEventListener('click', () => {
    if (isBusy) return;
    threadId = null; messages = []; localStorage.removeItem(THREAD_KEY); localStorage.removeItem(MESSAGES_KEY);
    messagesRoot.replaceChildren(); addWelcome(); updateAccess();
  });
  stopButton.addEventListener('click', () => activeRequest?.abort());
  window.addEventListener('hashchange', () => { if (!isBusy && root.classList.contains('is-open')) refreshAccess(); });
  close.addEventListener('click', () => { root.classList.remove('is-open'); launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); });
  form.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && root.classList.contains('is-open')) close.click(); });
  addWelcome();
  updateAccess();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildAssistant, { once: true });
else buildAssistant();
