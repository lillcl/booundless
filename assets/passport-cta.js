/* Passport "history unknown" CTA (T7 owner side).
   When a vehicle has no service_history row AND no inspection report, the
   home / garage page should surface a call to action: 預約基線檢查.
   The CTA leads to the service-offers page filtered to the vehicle. */

(function () {
  'use strict';
  var ui = window.svcUI;

  async function cta(host, vehicleId) {
    var r = await ui.callApi('GET', '/api/service-history?vehicle_id=' + encodeURIComponent(vehicleId));
    var data = (r.body && r.body.data) || [];
    if (data.length) return null; // we have history; nothing to show
    var inspect = await ui.callApi('GET', '/api/service-requests?vehicle_id=' + encodeURIComponent(vehicleId));
    var insps = ((inspect.body && inspect.body.data) || []).filter(function (x) { return x.service_kind === 'baseline'; });
    if (insps.length) return null; // there's already a baseline pending or done
    var card = ui.el('section', { class: 'svc-card',
      style: 'background:linear-gradient(135deg,#fff7e6,#ffe4b3);border:1px solid #f0b56b;border-radius:14px;padding:16px;margin:12px 0;' });
    card.appendChild(ui.el('h3', { style: 'margin:0 0 6px;color:#7a4500;' }, '這輛車的保養紀錄未知'));
    card.appendChild(ui.el('p', { style: 'margin:0 0 12px;color:#5a3300;' }, '尚未進行過任何檢查或維修 — 建議先預約一次基線檢查建立護照。'));
    var btn = ui.el('a', { class: 'svc-primary', href: '#/service-offers?vehicle_id=' + encodeURIComponent(vehicleId),
      style: 'display:inline-block;padding:10px 18px;background:#073568;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;' },
      '預約基線檢查');
    card.appendChild(btn);
    return card;
  }

  window.passportCta = cta;
})();