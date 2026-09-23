/* Service-MVP shared UI utilities (T7).
   Pure DOM helpers + i18n for the service-order surfaces. No business rules.
   Loaded by every service-*.js module via <script defer>. */

(function () {
  'use strict';

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k === 'dataset') Object.assign(node.dataset, props[k]);
      else if (k.startsWith('on') && typeof props[k] === 'function') node.addEventListener(k.slice(2), props[k]);
      else if (k === 'html') node.innerHTML = props[k];
      else if (k === 'text') node.textContent = props[k];
      else if (k === 'value') node.value = props[k];
      else if (k === 'checked') node.checked = !!props[k];
      else node.setAttribute(k, props[k]);
    });
    if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function fmtMinor(amountMinor, currency) {
    var cur = currency || 'MOP';
    if (typeof amountMinor !== 'number' || Number.isNaN(amountMinor)) return cur + ' -';
    return cur + ' ' + (amountMinor / 100).toFixed(2);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    // Display in Asia/Macau per spec §5.7
    try {
      return d.toLocaleString('zh-Hant-HK', { timeZone: 'Asia/Macau', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return d.toISOString(); }
  }

  function shortRef(id) { return (id || '').slice(0, 8); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Submit a form/mutation. The only allowed fetch for service writes must
     carry Idempotency-Key per spec §6; we generate a UUID once per click. */
  function callApi(method, path, body, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    var init = { method: method, headers: headers, credentials: 'same-origin' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { status: r.status, ok: r.ok, body: j };
      });
    });
  }

  function uuidV4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    var hex = [];
    for (var i = 0; i < 16; i++) hex.push((bytes[i] + 0x100).toString(16).slice(1));
    return hex.slice(0,4).join('') + '-' + hex.slice(4,6).join('') + '-' + hex.slice(6,8).join('') + '-' + hex.slice(8,10).join('') + '-' + hex.slice(10,16).join('');
  }

  /* Render a localized state badge. */
  function statusBadge(state) {
    var map = {
      new: ['待報價', '#5b6b80'],
      quoted: ['待車主批准', '#1999be'],
      accepted: ['已批准', '#1999be'],
      scheduled: ['已預約', '#073568'],
      in_progress: ['施工中', '#073568'],
      completion_submitted: ['待車主確認', '#073568'],
      completed: ['已完成', '#0a7a3a'],
      cancelled: ['已取消', '#5b6b80'],
      declined: ['已婉拒', '#5b6b80'],
      disputed: ['爭議中', '#b23a32'],
      paid: ['已收款', '#0a7a3a'],
      unpaid: ['未收款', '#5b6b80'],
    };
    var entry = map[state] || [state || '—', '#5b6b80'];
    return el('span', { class: 'svc-badge', style: 'background:' + entry[1] + ';color:#fff;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;' }, entry[0]);
  }

  window.svcUI = { el: el, fmtMinor: fmtMinor, fmtDate: fmtDate, shortRef: shortRef,
                   esc: esc, callApi: callApi, uuidV4: uuidV4, statusBadge: statusBadge };
})();