import { resolveAssistantRoute } from '../shared/assistant-routes.js';

const THREAD_KEY = 'kc_assistant_thread';
const MESSAGES_KEY = 'kc_assistant_messages';
const MAX_SAVED_MESSAGES = 30;
const MASCOT_URL = '/assets/mascot/jiezai-assistant.webp';

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
    return Array.isArray(value) ? value.slice(-MAX_SAVED_MESSAGES).filter((item) => ['user', 'assistant'].includes(item?.role) && typeof item.text === 'string') : [];
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
      <div class="assistant-messages" role="log" aria-live="polite" aria-relevant="additions text"></div>
      <div class="assistant-status" role="status" aria-live="polite"></div>
      <form class="assistant-composer">
        <textarea maxlength="4000" rows="1" aria-label="輸入問題" placeholder="問車輛、維修或琴澳同行…"></textarea>
        <button class="assistant-send" type="submit">送出</button>
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
  let threadId = localStorage.getItem(THREAD_KEY) || null;
  let messages = safeLoadMessages();
  let isBusy = false;

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
    const copy = createElement('p', '', '我可以帶你使用網站，亦可查找已核對的車輛、維修及琴澳同行資料。登入後還可以查看你的車輛紀錄。');
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
    const actions = createElement('div', 'assistant-confirm__actions');
    const approve = createElement('button', '', '確認執行'); approve.type = 'button'; approve.dataset.assistantApprove = 'true';
    const cancel = createElement('button', '', '取消'); cancel.type = 'button'; cancel.dataset.assistantCancel = 'true';
    actions.append(approve, cancel); card.append(actions); messagesRoot.append(card); scrollToEnd();
    approve.addEventListener('click', () => submitConfirmation(event.tool_call_id, true, card));
    cancel.addEventListener('click', () => submitConfirmation(event.tool_call_id, false, card));
  }

  function setBusy(busy, label = '') {
    isBusy = busy;
    sendButton.disabled = busy;
    input.disabled = busy;
    status.dataset.busy = String(busy);
    status.textContent = label;
  }

  async function consumeResponse(response, assistantBubble) {
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/event-stream')) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || `AI 助手暫時無法回覆 (${response.status})`);
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
        if (event.type === 'text') {
          answer += event.text || '';
          renderAssistantText(assistantBubble, answer);
          scrollToEnd();
        } else if (event.type === 'tool_activity' && event.status === 'completed') {
          if (event.tool_name === 'search_site_knowledge') addSources(event.output?.data);
          if (event.tool_name === 'suggest_navigation') addNavigation(event.output?.data);
        } else if (event.type === 'confirmation_required') {
          addConfirmation(event);
        } else if (event.type === 'done') {
          if (event.result?.thread_id) {
            threadId = event.result.thread_id;
            localStorage.setItem(THREAD_KEY, threadId);
          }
          if (!answer && event.result?.text) {
            answer = event.result.text;
            renderAssistantText(assistantBubble, answer);
          }
        } else if (event.type === 'error') throw new Error(event.message || 'AI 助手暫時無法回覆');
      }
      if (done) break;
    }
    const finalText = answer || assistantBubble.textContent || '已完成。';
    renderAssistantText(assistantBubble, finalText);
    messages.push({ role: 'assistant', text: finalText });
    saveMessages(messages);
  }

  async function request(body, placeholder = '界仔正在整理資料…') {
    setBusy(true, '正在查閱資料');
    const bubble = addMessage('assistant', placeholder, { persist: false });
    try {
      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stream: true, thread_id: threadId, page_context: pageContext(), ...body }),
      });
      await consumeResponse(response, bubble);
    } catch (error) {
      const message = error?.message || 'AI 助手暫時無法回覆，請稍後再試。';
      renderAssistantText(bubble, message);
      messages.push({ role: 'assistant', text: message });
      saveMessages(messages);
    } finally { setBusy(false, ''); input.focus(); }
  }

  async function sendMessage(value) {
    const text = String(value ?? input.value).trim();
    if (!text || isBusy) return;
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

  launcher.addEventListener('click', () => {
    root.classList.add('is-open'); launcher.setAttribute('aria-expanded', 'true'); panel.removeAttribute('inert'); input.focus(); scrollToEnd();
  });
  close.addEventListener('click', () => { root.classList.remove('is-open'); launcher.setAttribute('aria-expanded', 'false'); launcher.focus(); });
  form.addEventListener('submit', (event) => { event.preventDefault(); sendMessage(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && root.classList.contains('is-open')) close.click(); });
  addWelcome();
  for (const message of messages) addMessage(message.role, message.text, { persist: false });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildAssistant, { once: true });
else buildAssistant();
