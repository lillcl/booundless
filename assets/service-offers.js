/* Service entry points + offer browse (T7 owner side).
   Renders inside the SPA view container; does not own the router. The host
   page invokes window.serviceOffersView(host) when the route mounts. */

(function () {
  'use strict';

  var ui = window.svcUI;

  function offerCard(offer) {
    var card = ui.el('article', { class: 'svc-offer-card', dataset: { offerId: offer.id } });
    card.style.cssText = 'border:1px solid #dde5ee;border-radius:14px;padding:16px;background:#fff;margin-bottom:12px;';
    card.appendChild(ui.el('div', { style: 'display:flex;justify-content:space-between;gap:12px;' }, [
      ui.el('div', null, [
        ui.el('h3', { style: 'margin:0 0 4px;font-size:18px;' }, offer.name || '—'),
        ui.el('div', { style: 'color:#5b6b80;font-size:13px;' }, (offer.kind === 'baseline' ? '基線檢查' : offer.kind === 'maintenance' ? '維修' : offer.kind === 'second_opinion' ? '第二意見' : offer.kind || '—')),
      ]),
      ui.el('div', { style: 'text-align:right;color:#073568;font-weight:700;' }, ui.fmtMinor(offer.price_minor, offer.currency)),
    ]));
    card.appendChild(ui.el('p', { style: 'margin:8px 0;color:#3a4754;font-size:14px;' }, offer.description || ''));
    var meta = ui.el('div', { style: 'display:flex;gap:12px;font-size:12px;color:#5b6b80;' }, [
      ui.el('span', null, '時長 ' + (offer.duration_minutes || '?') + ' 分鐘'),
      ui.el('span', null, offer.branch_name || ''),
    ]);
    card.appendChild(meta);
    if (offer.id) {
      var btn = ui.el('button', { type: 'button', class: 'svc-primary', dataset: { offerId: offer.id } }, '選擇此服務');
      btn.style.cssText = 'margin-top:12px;padding:8px 14px;background:#073568;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer;';
      btn.addEventListener('click', function () {
        location.hash = '#/service-request/new?offer_id=' + encodeURIComponent(offer.id);
      });
      card.appendChild(btn);
    }
    return card;
  }

  function emptyState(host, msg) {
    host.innerHTML = '';
    var box = ui.el('div', { class: 'route-state' }, [
      ui.el('span', { class: 'sheet__eyebrow' }, 'NO OFFERS'),
      ui.el('h1', null, '目前沒有可用服務'),
      ui.el('p', null, msg || '車行尚未上架任何服務;請聯絡車行或稍後再查看。'),
      ui.el('a', { class: 'landing__primary', href: '#/landing' }, '返回首頁'),
    ]);
    host.appendChild(box);
  }

  async function loadOffers(vehicleId) {
    var qs = vehicleId ? '?vehicle_id=' + encodeURIComponent(vehicleId) : '';
    var r = await ui.callApi('GET', '/api/service-offers' + qs);
    return r.body.data || [];
  }

  async function view(host) {
    host.innerHTML = '';
    var head = ui.el('header', null, [
      ui.el('span', { class: 'sheet__eyebrow' }, 'SERVICE OFFERS'),
      ui.el('h1', { style: 'margin:8px 0 16px;' }, '選擇服務'),
    ]);
    host.appendChild(head);
    var vehicleList = await ui.callApi('GET', '/api/vehicles');
    var vehicles = (vehicleList.body && vehicleList.body.data) || [];
    var select = ui.el('select', { id: 'svcVehicleFilter', style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;margin-bottom:16px;' });
    select.appendChild(ui.el('option', { value: '' }, '選擇車輛'));
    vehicles.forEach(function (v) {
      select.appendChild(ui.el('option', { value: v.id }, (v.plate || v.id.slice(0, 8)) + ' · ' + (v.model || '')));
    });
    select.addEventListener('change', function () { refresh(select.value); });
    host.appendChild(select);

    var list = ui.el('div', { id: 'svcOfferList' }, [ui.el('p', null, '載入中…')]);
    host.appendChild(list);

    async function refresh(vId) {
      list.innerHTML = '<p>載入中…</p>';
      try {
        var offers = await loadOffers(vId || null);
        list.innerHTML = '';
        if (!offers.length) { emptyState(list); return; }
        offers.forEach(function (o) { list.appendChild(offerCard(o)); });
      } catch (e) {
        list.innerHTML = '<p style="color:#b23a32;">' + ui.esc(e.message || '無法載入服務') + '</p>';
      }
    }
    refresh('');
  }

  window.serviceOffersView = view;
})();