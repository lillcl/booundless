/* Service-request create + detail (T7 owner side).
   Handles #/service-request/new?offer_id=...
            #/service-request/<id>
   Pure form-driven flow; no fetch proxies via page.evaluate. */

(function () {
  'use strict';
  var ui = window.svcUI;

  function field(label, name, opts) {
    opts = opts || {};
    var wrap = ui.el('div', { class: 'field' });
    var lab = ui.el('label', { for: 'svcF_' + name }, label);
    var input = opts.textarea
      ? ui.el('textarea', { id: 'svcF_' + name, name: name, rows: opts.rows || 3,
          style: 'width:100%;padding:8px;border-radius:8px;border:1px solid #dde5ee;box-sizing:border-box;' })
      : ui.el('input', { id: 'svcF_' + name, name: name, type: opts.type || 'text',
          placeholder: opts.placeholder || '',
          style: 'width:100%;padding:8px;border-radius:8px;border:1px solid #dde5ee;box-sizing:border-box;' });
    wrap.appendChild(lab); wrap.appendChild(input);
    return wrap;
  }

  async function createView(host, offerId) {
    host.innerHTML = '';
    var offer = (await ui.callApi('GET', '/api/service-offers/' + encodeURIComponent(offerId))).body.data;
    var vehicles = ((await ui.callApi('GET', '/api/vehicles')).body || {}).data || [];

    var header = ui.el('header', null, [
      ui.el('span', { class: 'sheet__eyebrow' }, 'NEW REQUEST'),
      ui.el('h1', null, '建立服務請求'),
      ui.el('p', null, offer ? (offer.name + ' · ' + ui.fmtMinor(offer.price_minor, offer.currency)) : ''),
    ]);
    host.appendChild(header);

    var form = ui.el('form', { class: 'svc-form', style: 'display:flex;flex-direction:column;gap:12px;max-width:560px;' });
    var vehicleField = ui.el('select', { id: 'svcF_vehicle_id', required: 'required',
      style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;' });
    vehicles.forEach(function (v) {
      vehicleField.appendChild(ui.el('option', { value: v.id }, (v.plate || v.id.slice(0, 8)) + ' · ' + (v.model || '')));
    });
    form.appendChild(ui.el('div', { class: 'field' }, [ui.el('label', { for: 'svcF_vehicle_id' }, '車輛'), vehicleField]));
    form.appendChild(field('聯絡人姓名', 'contact_name'));
    form.appendChild(field('聯絡人電話', 'contact_phone', { type: 'tel' }));
    form.appendChild(field('備註', 'customer_note', { textarea: true, rows: 3 }));
    var consent = ui.el('label', { style: 'display:flex;gap:8px;align-items:center;' }, [
      ui.el('input', { id: 'svcF_consent', type: 'checkbox', required: 'required' }),
      ui.el('span', null, '我已閱讀並同意 隱私政策 與 服務條款'),
    ]);
    form.appendChild(consent);

    var submit = ui.el('button', { type: 'submit', class: 'svc-primary',
      style: 'padding:10px 18px;background:#073568;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer;' },
      '送出服務請求');
    form.appendChild(submit);
    var status = ui.el('p', { id: 'svcFormStatus', style: 'color:#5b6b80;font-size:13px;margin:0;' });
    form.appendChild(status);
    host.appendChild(form);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      submit.disabled = true; status.textContent = '送出中…';
      var body = {
        vehicle_id: vehicleField.value,
        offer_id: offerId,
        contact_name: form.contact_name.value,
        contact_phone: form.contact_phone.value,
        customer_note: form.customer_note.value,
        terms_version: 'v1',
        consented_at: new Date().toISOString(),
      };
      var key = ui.uuidV4();
      var r = await ui.callApi('POST', '/api/vehicles/' + encodeURIComponent(body.vehicle_id) + '/service-requests',
        body, { idempotencyKey: key });
      if (r.ok) {
        location.hash = '#/service-request/' + encodeURIComponent(r.body.data.id);
      } else {
        status.textContent = r.body.error && r.body.error.message ? r.body.error.message : '送出失敗';
        status.style.color = '#b23a32';
        submit.disabled = false;
      }
    });
  }

  async function detailView(host, requestId) {
    host.innerHTML = '';
    var r = await ui.callApi('GET', '/api/service-requests/' + encodeURIComponent(requestId));
    if (!r.ok) {
      host.appendChild(ui.el('div', { class: 'route-state' }, [
        ui.el('h1', null, '找不到請求'),
        ui.el('p', null, r.body.error && r.body.error.message || ''),
      ]));
      return;
    }
    var req = r.body.data;
    host.appendChild(ui.el('header', null, [
      ui.el('span', { class: 'sheet__eyebrow' }, 'SERVICE REQUEST'),
      ui.el('h1', null, req.order_number || ui.shortRef(req.id)),
      ui.statusBadge(req.status),
    ]));

    var details = ui.el('section', { class: 'svc-card', style: 'background:#fff;border:1px solid #dde5ee;border-radius:14px;padding:16px;margin-bottom:12px;' }, [
      ui.el('div', null, [ui.el('b', null, '車行'), ui.el('span', null, req.dealer_name || '—')]),
      ui.el('div', null, [ui.el('b', null, '車輛'), ui.el('span', null, req.model || '—')]),
      ui.el('div', null, [ui.el('b', null, '服務類型'), ui.el('span', null, req.service_kind || '—')]),
      ui.el('div', null, [ui.el('b', null, '建立時間'), ui.el('span', null, ui.fmtDate(req.created_at))]),
      ui.el('div', null, [ui.el('b', null, '預約時間'), ui.el('span', null, ui.fmtDate(req.scheduled_at))]),
    ]);
    host.appendChild(details);

    if (req.work_state === 'completion_submitted' && req.status === 'completed') {
      host.appendChild(buildCompletionConfirm(req));
    }
    if (Array.isArray(req.action_options) && req.action_options.length) {
      host.appendChild(buildActionPanel(req));
    }
  }

  function buildCompletionConfirm(req) {
    var card = ui.el('section', { class: 'svc-card',
      style: 'background:#f7fbff;border:1px solid #1999be;border-radius:14px;padding:16px;margin-bottom:12px;' });
    card.appendChild(ui.el('h3', null, '車商已提交完工 — 請確認'));
    card.appendChild(ui.el('p', null, '確認後將寫入護照紀錄並開始計算下次提醒。'));
    var btn = ui.el('button', { type: 'button', class: 'svc-primary',
      style: 'padding:10px 18px;background:#0a7a3a;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer;' },
      '確認完工並寫入護照');
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      var r = await ui.callApi('POST', '/api/service-requests/' + encodeURIComponent(req.id),
        { action: 'confirm_completion', version: req.version },
        { idempotencyKey: ui.uuidV4() });
      if (r.ok) { location.reload(); } else { btn.disabled = false; alert(r.body.error && r.body.error.message || '確認失敗'); }
    });
    card.appendChild(btn);
    return card;
  }

  function buildActionPanel(req) {
    var card = ui.el('section', { class: 'svc-card',
      style: 'background:#fff;border:1px solid #dde5ee;border-radius:14px;padding:16px;margin-bottom:12px;' });
    card.appendChild(ui.el('h3', null, '下一步'));
    var list = ui.el('ul', { style: 'padding-left:20px;margin:0;' });
    (req.action_options || []).forEach(function (a) {
      list.appendChild(ui.el('li', null, a));
    });
    card.appendChild(list);
    return card;
  }

  window.serviceRequestView = async function (host, params) {
    if (params && params.kind === 'new') {
      var offerId = (params.qs && params.qs.offer_id) || '';
      if (!offerId) {
        host.innerHTML = '<div class="route-state"><h1>缺少 offer_id</h1></div>';
        return;
      }
      return createView(host, offerId);
    }
    if (params && params.id) return detailView(host, params.id);
    host.innerHTML = '<div class="route-state"><h1>未指定請求</h1></div>';
  };
})();