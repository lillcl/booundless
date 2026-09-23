/* Dealer workspace (T7 dealer side).
   Routes: #/dealer
   Tabbed view: 新請求 / 待報價 / 今日預約 / 施工中 / 待批准 / 待交付
   viewer 角色:唯讀,所有寫入按鈕隱藏。

   This first slice shows the lists + status badges. Per-spec writing
   actions (quote / schedule / complete) call serviceRequestView.detail with
   the same form primitives used by the owner side. */

(function () {
  'use strict';
  var ui = window.svcUI;

  async function loadMembership() {
    var r = await ui.callApi('GET', '/api/dealer/me');
    return (r.body && r.body.data) || null;
  }

  async function loadRequests() {
    var r = await ui.callApi('GET', '/api/service-requests?limit=50');
    return (r.body && r.body.data) || [];
  }

  function summaryCard(title, count, list) {
    var card = ui.el('section', { class: 'svc-card',
      style: 'background:#fff;border:1px solid #dde5ee;border-radius:14px;padding:14px;margin-bottom:12px;' });
    card.appendChild(ui.el('h3', { style: 'margin:0 0 8px;' }, title + ' (' + count + ')'));
    if (!count) {
      card.appendChild(ui.el('p', { style: 'color:#5b6b80;margin:0;' }, '沒有項目'));
      return card;
    }
    var ul = ui.el('ul', { style: 'padding-left:18px;margin:0;' });
    list.forEach(function (r) {
      var li = ui.el('li', { style: 'margin-bottom:6px;' }, [
        ui.el('a', { href: '#/dealer/request/' + encodeURIComponent(r.id), style: 'color:#073568;text-decoration:underline;' },
          (r.order_number || ui.shortRef(r.id)) + ' · ' + (r.model || '—')),
        ui.el('span', { style: 'margin-left:8px;' }, ui.statusBadge(r.status)),
      ]);
      ul.appendChild(li);
    });
    card.appendChild(ul);
    return card;
  }

  async function view(host) {
    host.innerHTML = '';
    var member = await loadMembership();
    if (!member) {
      host.innerHTML = '<div class="route-state"><h1>您不是任何車行的成員</h1><p>請洽 Admin 取得邀請。</p></div>';
      return;
    }
    var header = ui.el('header', null, [
      ui.el('span', { class: 'sheet__eyebrow' }, 'DEALER WORKSPACE'),
      ui.el('h1', null, member.dealer_name || '車商後台'),
      ui.el('p', { style: 'color:#5b6b80;margin:0;' }, '角色:' + member.role),
    ]);
    host.appendChild(header);

    var requests = await loadRequests();
    var buckets = {
      '新請求': { predicate: function (r) { return r.status === 'new'; }, rows: [] },
      '待報價': { predicate: function (r) { return r.status === 'quoted'; }, rows: [] },
      '今日預約': { predicate: function (r) { return r.status === 'scheduled' && isToday(r.scheduled_at); }, rows: [] },
      '施工中': { predicate: function (r) { return r.work_state === 'in_progress'; }, rows: [] },
      '待批准追加': { predicate: function (r) { return r.has_pending_change; }, rows: [] },
      '待交付': { predicate: function (r) { return r.work_state === 'completion_submitted'; }, rows: [] },
    };
    requests.forEach(function (r) {
      Object.keys(buckets).forEach(function (k) {
        if (buckets[k].predicate(r)) buckets[k].rows.push(r);
      });
    });
    Object.keys(buckets).forEach(function (k) {
      host.appendChild(summaryCard(k, buckets[k].rows.length, buckets[k].rows));
    });
  }

  function isToday(iso) {
    if (!iso) return false;
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  window.dealerWorkspaceView = view;
})();