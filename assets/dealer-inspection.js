/* Dealer inspection form (T7).
   Renders inside the SPA `#view` host. The dealer fills each template item
   (result / measurement / notes / evidence), saves the draft, then publishes.
   Server enforces that every template item has a result row at publish. */

(function () {
  'use strict';
  var ui = window.svcUI;

  var VALID_RESULTS = ['normal','recommended','urgent','not_applicable','unknown'];
  var VALID_UNITS = ['mm','percent','other'];

  function row(item) {
    var row = ui.el('div', { class: 'svc-insp-row',
      style: 'border:1px solid #dde5ee;border-radius:12px;padding:12px;margin-bottom:12px;background:#fff;' });
    row.appendChild(ui.el('h3', { style: 'margin:0 0 8px;font-size:16px;' },
      item.label + ' — ' + item.check_key));

    var resultSel = ui.el('select', { class: 'svc-insp-result',
      style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:100%;margin-bottom:8px;' });
    VALID_RESULTS.forEach(function (r) {
      var o = ui.el('option', { value: r }, r);
      resultSel.appendChild(o);
    });
    resultSel.value = 'normal';
    row.appendChild(ui.el('label', null, '結果'));
    row.appendChild(resultSel);

    var note = ui.el('textarea', { class: 'svc-insp-notes', rows: 3,
      style: 'width:100%;padding:8px;border-radius:8px;border:1px solid #dde5ee;box-sizing:border-box;margin-bottom:8px;' });
    row.appendChild(ui.el('label', null, '說明 (N/A 必填理由)'));
    row.appendChild(note);

    var measured = ui.el('input', { class: 'svc-insp-measure-value', type: 'number', step: '0.1',
      style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:60%;' });
    var unitSel = ui.el('select', { class: 'svc-insp-measure-unit',
      style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:35%;' });
    [''].concat(VALID_UNITS).forEach(function (u) { unitSel.appendChild(ui.el('option', { value: u }, u || '—')); });
    var measureRow = ui.el('div', { style: 'display:flex;gap:8px;margin-bottom:8px;' }, [measured, unitSel]);
    row.appendChild(ui.el('label', null, '量測 (選填)'));
    row.appendChild(measureRow);

    var action = ui.el('input', { class: 'svc-insp-action', type: 'text',
      style: 'width:100%;padding:8px;border-radius:8px;border:1px solid #dde5ee;box-sizing:border-box;margin-bottom:8px;' });
    row.appendChild(ui.el('label', null, '建議處置 (選填)'));
    row.appendChild(action);
    return { el: row, result: resultSel, notes: note, measureValue: measured, measureUnit: unitSel, action: action };
  }

  async function view(host, requestId) {
    host.innerHTML = '';
    var r = await fetch('/api/service-requests/' + requestId).then(function (r) { return r.json(); });
    if (!r.data) return;
    var draft = await fetch('/api/service-requests/' + requestId + '/inspection', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { data: null }; })
      .catch(function () { return { data: null }; });
    var template = (draft.data && draft.data.template) || { key: 'baseline-v1', items: [] };
    var latestReport = (draft.data && draft.data.reports && draft.data.reports[0]) || null;
    host.appendChild(ui.el('header', null, [
      ui.el('span', { class: 'sheet__eyebrow' }, 'INSPECTION'),
      ui.el('h1', null, template.label || '檢查報告'),
      ui.el('p', { style: 'color:#5b6b80;' }, '逐項記錄結果；發布後車主即可檢視。'),
    ]));
    if (!template.items.length) {
      host.appendChild(ui.el('div', { class: 'route-state' }, '此服務沒有檢查模板。'));
      return;
    }
    var rows = [];
    template.items.forEach(function (it) {
      var existing = (draft.data && draft.data.results || []).find(function (x) { return x.check_key === it.check_key; }) || {};
      var r = row(it);
      r.result.value = existing.result || 'normal';
      r.notes.value = existing.notes || '';
      r.measureValue.value = existing.measurement_value != null ? existing.measurement_value : '';
      r.measureUnit.value = existing.measurement_unit || '';
      r.action.value = existing.recommended_action || '';
      rows.push({ check_key: it.check_key, fields: r });
      host.appendChild(r.el);
    });
    var saveBtn = ui.el('button', { type: 'button', class: 'svc-primary',
      style: 'padding:10px 18px;background:#073568;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer;margin-right:8px;' }, '儲存草稿');
    var pubBtn = ui.el('button', { type: 'button',
      style: 'padding:10px 18px;background:#0a7a3a;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer;' }, '發布報告');
    host.appendChild(ui.el('div', { style: 'margin-top:16px;display:flex;gap:8px;' }, [saveBtn, pubBtn]));
    var status = ui.el('p', { style: 'margin-top:12px;color:#5b6b80;' });
    host.appendChild(status);

    function buildResults() {
      return rows.map(function (r) {
        var f = r.fields;
        var out = { check_key: r.check_key, result: f.result.value, notes: f.notes.value };
        if (f.measureValue.value !== '') out.measurement_value = Number(f.measureValue.value);
        if (f.measureUnit.value) out.measurement_unit = f.measureUnit.value;
        if (f.action.value) out.recommended_action = f.action.value;
        return out;
      });
    }
    saveBtn.addEventListener('click', async function () {
      saveBtn.disabled = true; status.textContent = '儲存中…';
      var rr = await fetch('/api/service-requests/' + requestId + '/inspection', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mileage_km: r.data.mileage_km || 0,
          summary: r.data.summary || '',
          template_key: template.key,
          results: buildResults(),
        }),
      });
      var payload = await rr.json().catch(function () { return {}; });
      saveBtn.disabled = false;
      if (rr.ok) latestReport = payload.data || latestReport;
      status.textContent = rr.ok ? '已儲存草稿' : '儲存失敗：' + ((payload.error && payload.error.message) || rr.status);
    });
    pubBtn.addEventListener('click', async function () {
      pubBtn.disabled = true; status.textContent = '發布中…';
      var rr = await fetch('/api/service-requests/' + requestId + '/inspection/publish', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ui.uuidV4() },
        body: JSON.stringify({ version: latestReport && latestReport.version }),
      });
      var payload = await rr.json().catch(function () { return {}; });
      pubBtn.disabled = false;
      status.textContent = rr.ok ? '已發布，車主現在可以檢視' : '發布失敗：' + ((payload.error && payload.error.message) || rr.status);
    });
  }

  window.dealerInspectionView = view;
})();
