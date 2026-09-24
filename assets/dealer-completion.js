/* Dealer completion form (T7).
   Renders the approved order lines for a request and lets the dealer mark
   each completed/not_performed + actual parts + next-due km/date + photo
   attachments, then submits the completion. Server validates that no line
   is billed unless outcome='completed'. */

(function () {
  'use strict';
  var ui = window.svcUI;

  async function uploadEvidence(requestId,file,purpose){
    if(!file)return null;
    var intent=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(requestId)+'/attachments/upload',{mime_type:file.type,size_bytes:file.size,purpose:purpose},{idempotencyKey:ui.uuidV4()});
    if(!intent.ok)throw new Error(intent.body.error?.message||'無法建立照片上傳');
    var uploaded=await fetch(intent.body.data.upload_url,{method:'PUT',headers:{'Content-Type':file.type},body:file});
    if(!uploaded.ok)throw new Error('照片上傳失敗');
    var finalized=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(requestId)+'/attachments/'+encodeURIComponent(intent.body.data.attachment_id)+'/finalize',{}, {idempotencyKey:ui.uuidV4()});
    if(!finalized.ok)throw new Error(finalized.body.error?.message||'照片驗證失敗');
    return finalized.body.data;
  }

  async function view(host, requestId) {
    host.innerHTML = '';
    var response = await fetch('/api/service-requests/' + encodeURIComponent(requestId));
    var r = await response.json().catch(function () { return {}; });
    if (!response.ok || !r.data) {
      host.appendChild(ui.el('div', { class: 'route-state' }, '無法載入完工資料。'));
      return;
    }
    var lines = (r.data && r.data.order_lines) || [];
    var mileage = (r.data && r.data.mileage_km) || 0;
    var startedAt = (r.data && r.data.scheduled_at) || new Date().toISOString();
    var idx = (r.data && r.data.version) || 0;

    host.appendChild(ui.el('header', null, [
      ui.el('h1', null, '完工報告 #' + (r.data?.order_number || ui.shortRef(requestId))),
      ui.el('p', { style: 'color:#5b6b80;' }, '請逐項填寫,未施工請選 not_performed 並填原因。'),
    ]));
    var inputMileage = ui.el('input', { type: 'number', value: mileage,
      style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:200px;' });
    host.appendChild(ui.el('div', { style: 'margin:8px 0;' }, [ui.el('b', null, '實際里程:'), ' ', inputMileage]));

    var inputTech = ui.el('input', { placeholder: '技師姓名',
      style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:240px;' });
    host.appendChild(ui.el('div', { style: 'margin:8px 0;' }, [ui.el('b', null, '技師:'), ' ', inputTech]));

    var inputNotes = ui.el('textarea', { rows: 3,
      style: 'width:100%;padding:8px;border-radius:8px;border:1px solid #dde5ee;box-sizing:border-box;' });
    host.appendChild(ui.el('div', null, [ui.el('b', null, '備註:'), ' ', inputNotes]));
    var beforePhoto=ui.el('input',{type:'file',accept:'image/jpeg,image/png,image/webp'});
    var afterPhoto=ui.el('input',{type:'file',accept:'image/jpeg,image/png,image/webp'});
    host.appendChild(ui.el('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0;'},[
      ui.el('label',null,[ui.el('b',null,'施工前照片'),beforePhoto]),
      ui.el('label',null,[ui.el('b',null,'施工後照片'),afterPhoto]),
    ]));

    var inputs = [];
    lines.forEach(function (line) {
      var card = ui.el('div', { style: 'border:1px solid #dde5ee;border-radius:12px;padding:12px;margin:12px 0;background:#fff;' });
      card.appendChild(ui.el('h3', { style: 'margin:0 0 6px;' },
        line.description + ' · ' + ui.fmtMinor(line.amount_minor, line.currency || 'MOP')));
      card.appendChild(ui.el('p', { style: 'margin:0;color:#5b6b80;font-size:12px;' },
        (line.work_type || 'service') + ' · ' + (line.service_keys || []).join(', ')));
      var outcome = ui.el('select', { style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:160px;' });
      ['completed','not_performed'].forEach(function (o) { outcome.appendChild(ui.el('option', { value: o }, o === 'completed' ? '已施工 (計費)' : '未施工 (不計費)')); });
      var notes = ui.el('input', { placeholder: '實際情況 / 備註',
        style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:240px;' });
      var npReason = ui.el('input', { placeholder: '未施工原因 (選填)',
        style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:240px;' });
      var actualParts = ui.el('input', { placeholder: '實際零件品牌',
        style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:200px;' });
      var actualPartNumber = ui.el('input', { placeholder: '料號',
        style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:160px;' });
      var nextDueKm = ui.el('input', { type: 'number', placeholder: '下次到期里程',
        style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:160px;' });
      var nextDueDate = ui.el('input', { type: 'date',
        style: 'padding:8px;border-radius:8px;border:1px solid #dde5ee;width:160px;' });
      var grid = ui.el('div', { style: 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px;' }, [
        ui.el('div', null, [ui.el('b', null, '結果'), outcome]),
        ui.el('div', null, [ui.el('b', null, '備註'), notes]),
        ui.el('div', null, [ui.el('b', null, '未施工原因'), npReason]),
        ui.el('div', null, [ui.el('b', null, '實際零件品牌'), actualParts]),
        ui.el('div', null, [ui.el('b', null, '料號'), actualPartNumber]),
        ui.el('div', null, [ui.el('b', null, '下次到期里程'), nextDueKm]),
        ui.el('div', null, [ui.el('b', null, '下次到期日期'), nextDueDate]),
      ]);
      card.appendChild(grid);
      host.appendChild(card);
      inputs.push({
        order_line_id: line.id,
        outcome: outcome,
        notes: notes,
        npReason: npReason,
        actual_parts_brand: actualParts,
        actual_part_number: actualPartNumber,
        next_due_km: nextDueKm,
        next_due_date: nextDueDate,
      });
    });

    var submit = ui.el('button', { type: 'button',
      style: 'padding:10px 18px;background:#073568;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer;margin-top:16px;' }, '送出完工報告');
    host.appendChild(submit);
    var status = ui.el('p', { style: 'color:#5b6b80;margin-top:12px;' });
    host.appendChild(status);

    submit.addEventListener('click', async function () {
      submit.disabled = true;
      status.textContent='正在上傳證據照片…';
      try {
        if(beforePhoto.files[0])await uploadEvidence(requestId,beforePhoto.files[0],'before');
        if(afterPhoto.files[0])await uploadEvidence(requestId,afterPhoto.files[0],'after');
      } catch(error) {
        submit.disabled=false;status.textContent=error.message;return;
      }
      var completion = {
        mileage_km: Number(inputMileage.value),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        technician_name: inputTech.value || 'Tech',
        notes: inputNotes.value || null,
        lines: inputs.map(function (i) {
          var out = { order_line_id: i.order_line_id, outcome: i.outcome.value };
          if (i.notes.value) out.notes = i.notes.value;
          if (i.outcome.value === 'not_performed' && i.npReason.value) out.not_performed_reason = i.npReason.value;
          if (i.actual_parts_brand.value) out.actual_parts_brand = i.actual_parts_brand.value;
          if (i.actual_part_number.value) out.actual_part_number = i.actual_part_number.value;
          if (i.next_due_km.value) out.next_due_km = Number(i.next_due_km.value);
          if (i.next_due_date.value) out.next_due_date = i.next_due_date.value;
          return out;
        }),
      };
      var rr = await fetch('/api/service-requests/' + requestId, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ui.uuidV4() },
        body: JSON.stringify({ action: 'complete', version: idx, completion }),
      });
      var payload = await rr.json().catch(function () { return {}; });
      submit.disabled = false;
      status.textContent = rr.ok ? '完工報告已送出，等待車主確認' : '送出失敗：' + ((payload.error && payload.error.message) || rr.status);
    });
  }

  window.dealerCompletionView = view;
})();
