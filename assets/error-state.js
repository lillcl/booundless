/* Reusable error / empty / loading UI helper.
   Loaded as a plain script tag before app.js; exposes `window.errorState` with
   renderers for the error states called out in the prod-readiness checklist:
     loading | empty | unauthorized | forbidden | not_found | network |
     server | validation | rate_limited | offline
   All renderers take a host element + an optional context object and replace
   the host's contents with a `.route-state` or `.empty-state` block. */

(function () {
  var SCENARIOS = {
    loading: { eyebrow: 'LOADING', title: '載入中…', desc: '正在為您準備資料,請稍候。' },
    empty: { eyebrow: 'EMPTY', title: '目前沒有資料', desc: '等您建立第一筆紀錄後就會顯示在這裡。' },
    unauthorized: { eyebrow: 'SIGN IN REQUIRED', title: '請先登入', desc: '登入後即可使用此功能。' },
    forbidden: { eyebrow: 'ACCESS DENIED', title: '沒有權限', desc: '您沒有存取此內容的權限。' },
    not_found: { eyebrow: 'NOT FOUND', title: '找不到頁面', desc: '連結可能已更改或輸入有誤。' },
    network: { eyebrow: 'NETWORK ERROR', title: '網路連不上', desc: '請確認網路後重試。', retry: true },
    server: { eyebrow: 'SERVER ERROR', title: '伺服器暫時無法回應', desc: '工程團隊已收到通知,請稍候再試。', retry: true, fallback: true },
    validation: { eyebrow: 'INVALID INPUT', title: '資料格式不正確', desc: '請檢查輸入後重新送出。' },
    rate_limited: { eyebrow: 'TOO MANY REQUESTS', title: '操作太頻繁', desc: '請稍候 30 秒再試。' },
    offline: { eyebrow: 'OFFLINE', title: '目前離線', desc: '請連上網路後繼續使用。', retry: true },
  };

  function action(label, href, kind) {
    var a = document.createElement('a');
    a.className = kind === 'secondary' ? 'landing__primary landing__primary--ghost' : 'landing__primary';
    a.href = href || '#';
    a.textContent = label;
    return a;
  }

  function render(host, state, ctx) {
    if (!host) return;
    var cfg = SCENARIOS[state] || SCENARIOS.server;
    var code = (ctx && ctx.code) || state || 'error';
    var message = (ctx && ctx.message) || cfg.desc;
    var titleOverride = ctx && ctx.title;
    var html = ''
      + '<div class="wrap"><div class="route-state" data-error-state="' + esc(code) + '">'
      +   '<span class="sheet__eyebrow">' + esc(cfg.eyebrow) + '</span>'
      +   '<h1>' + esc(titleOverride || cfg.title) + '</h1>'
      +   '<p>' + esc(message) + '</p>'
      +   '<div class="route-state__actions">';
    html += '<a class="landing__primary" href="#/landing">返回首頁</a>';
    if (cfg.retry) {
      html += '<a class="landing__primary landing__primary--ghost" href="javascript:location.reload()">重試</a>';
    }
    if (cfg.fallback) {
      html += '<a class="landing__primary landing__primary--ghost" href="/error.html?status=500&code=server">完整錯誤頁</a>';
    }
    html += '</div></div></div>';
    host.innerHTML = html;
    host.setAttribute('data-error-state', code);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fromApiError(host, err) {
    if (!err) return render(host, 'server');
    if (err.code === 'unauthorized') return render(host, 'unauthorized');
    if (err.code === 'forbidden') return render(host, 'forbidden');
    if (err.code === 'not_found') return render(host, 'not_found');
    if (err.code === 'rate_limited') return render(host, 'rate_limited');
    if (err.code === 'unprocessable' || err.code === 'validation') return render(host, 'validation', { message: err.message });
    return render(host, 'server', { message: err.message });
  }

  window.errorState = {
    render: render,
    fromApiError: fromApiError,
    scenarios: SCENARIOS,
  };
})();