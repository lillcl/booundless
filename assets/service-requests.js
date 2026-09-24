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

    renderQuotes(host, req);
    renderBooking(host, req);
    renderInspection(host, req);
    renderChanges(host, req);
    renderAttachments(host, req);
    renderCases(host, req);

    if (req.work_state === 'completion_submitted' && req.status === 'completed') {
      host.appendChild(buildCompletionConfirm(req));
    }
    host.appendChild(buildActionPanel(req));
  }

  function card(title) {
    var node = ui.el('section', { class: 'svc-card', style: 'background:#fff;border:1px solid #dde5ee;border-radius:14px;padding:16px;margin-bottom:12px;' });
    if (title) node.appendChild(ui.el('h3', { style: 'margin:0 0 12px;' }, title));
    return node;
  }

  function actionButton(label, tone) {
    return ui.el('button', { type:'button', style:'padding:10px 15px;border:0;border-radius:10px;background:'+(tone||'#073568')+';color:#fff;font-weight:700;cursor:pointer;margin:4px 8px 4px 0;' }, label);
  }

  function latestQuote(req) {
    return Array.isArray(req.quotes) && req.quotes.length ? req.quotes[0] : null;
  }

  function renderQuotes(host, req) {
    var quote = latestQuote(req);
    if (!quote && req.viewer_role !== 'operator') return;
    var node = card('報價');
    if (quote) {
      var items = Array.isArray(quote.items) ? quote.items : [];
      var form = ui.el('div');
      items.forEach(function (line, index) {
        var checked = req.status === 'quoted';
        var checkbox = ui.el('input', { type:'checkbox', checked:checked, value:line.line_id || '', 'data-quote-line':String(index) });
        if (req.status !== 'quoted' || req.viewer_role !== 'owner') checkbox.disabled = true;
        form.appendChild(ui.el('label', { style:'display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #edf1f5;' }, [
          checkbox, ui.el('span', null, line.description || ('項目 '+(index+1))),
          ui.el('b', null, ui.fmtMinor(Number(line.amount_minor || 0), quote.currency)),
        ]));
      });
      node.appendChild(form);
      node.appendChild(ui.el('p', { style:'text-align:right;font-weight:800;' }, '總額：'+ui.fmtMinor(Number(quote.total_minor || 0), quote.currency)));
      if (req.viewer_role === 'owner' && req.status === 'quoted') {
        var accept = actionButton('批准所選項目', '#0a7a3a');
        var reject = actionButton('拒絕報價', '#9a3d36');
        var status = ui.el('p', { role:'status', style:'color:#5b6b80;' });
        accept.onclick = async function () {
          var ids = Array.from(form.querySelectorAll('[data-quote-line]:checked')).map(function (el, index) {
            return el.value || (items[Number(el.dataset.quoteLine)] && items[Number(el.dataset.quoteLine)].line_id);
          }).filter(Boolean);
          if (!ids.length) { status.textContent='請至少選擇一項。'; return; }
          accept.disabled=true;
          var indexes=Array.from(form.querySelectorAll('[data-quote-line]:checked')).map(function(el){return Number(el.dataset.quoteLine);});
          var rr=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id),{action:'accept_quote',version:req.version,quote_id:quote.id,selected_line_ids:ids,selected_line_indexes:indexes},{idempotencyKey:ui.uuidV4()});
          if(rr.ok) location.reload(); else {accept.disabled=false;status.textContent=rr.body.error?.message||'批准失敗';}
        };
        reject.onclick = async function () {
          var reason=window.prompt('拒絕原因（選填）','')||'';
          reject.disabled=true;
          var rr=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id),{action:'reject_quote',version:req.version,quote_id:quote.id,reason:reason},{idempotencyKey:ui.uuidV4()});
          if(rr.ok) location.reload(); else {reject.disabled=false;status.textContent=rr.body.error?.message||'拒絕失敗';}
        };
        node.appendChild(ui.el('div', null, [accept,reject,status]));
      }
    }
    if (req.viewer_role === 'operator' && ['new','quoted'].includes(req.status)) {
      var quoteForm=ui.el('form', { style:'display:grid;gap:9px;margin-top:12px;' });
      var requested=Array.isArray(req.items)?req.items:[];
      (requested.length?requested:[{service_key:'inspection'}]).forEach(function(item,index){
        var row=ui.el('div',{style:'display:grid;grid-template-columns:1fr 140px;gap:8px;'},[
          ui.el('input',{name:'description',value:item.description||item.service_key||('服務項目 '+(index+1)),required:'required'}),
          ui.el('input',{name:'amount',type:'number',min:'0',step:'1',placeholder:'金額（MOP）',required:'required','data-service-key':item.service_key||'inspection'}),
        ]);quoteForm.appendChild(row);
      });
      var expiry=ui.el('input',{name:'expires_at',type:'date',required:'required'});expiry.value=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      quoteForm.appendChild(expiry);
      var submit=actionButton('發出報價');submit.type='submit';quoteForm.appendChild(submit);
      var quoteStatus=ui.el('p',{role:'status'});quoteForm.appendChild(quoteStatus);
      quoteForm.onsubmit=async function(ev){ev.preventDefault();submit.disabled=true;var descriptions=quoteForm.querySelectorAll('[name=description]');var amounts=quoteForm.querySelectorAll('[name=amount]');var lines=Array.from(descriptions).map(function(input,index){var amount=Math.round(Number(amounts[index].value)*100);return{line_id:ui.uuidV4(),description:input.value,amount_minor:amount,quantity:1,parts_unit_minor:0,labour_minor:amount,work_type:req.service_kind==='maintenance'?'service':'inspect',service_keys:[amounts[index].dataset.serviceKey]};});var rr=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id),{action:'quote',version:req.version,currency:'MOP',expires_at:new Date(expiry.value+'T23:59:59+08:00').toISOString(),items:lines},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else{submit.disabled=false;quoteStatus.textContent=rr.body.error?.message||'報價失敗';}};
      node.appendChild(quoteForm);
    }
    host.appendChild(node);
  }

  function renderBooking(host, req) {
    if (req.booking) {
      var booked=card('預約');booked.appendChild(ui.el('p',null,ui.fmtDate(req.booking.starts_at)+' – '+ui.fmtDate(req.booking.ends_at)));host.appendChild(booked);return;
    }
    if (req.viewer_role!=='owner'||req.status!=='accepted'||!req.offer_id) return;
    var node=card('選擇預約時間');var status=ui.el('p',null,'正在載入可用時段…');node.appendChild(status);host.appendChild(node);
    ui.callApi('GET','/api/service-offers/'+encodeURIComponent(req.offer_id)+'/slots').then(function(rr){var slots=rr.body.data||[];status.textContent=slots.length?'':'暫時沒有可用時段。';slots.filter(function(slot){return Number(slot.booked)<Number(slot.capacity);}).forEach(function(slot){var btn=actionButton(ui.fmtDate(slot.starts_at));btn.onclick=async function(){btn.disabled=true;var out=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id),{action:'schedule',version:req.version,slot_id:slot.id},{idempotencyKey:ui.uuidV4()});if(out.ok)location.reload();else{btn.disabled=false;status.textContent=out.body.error?.message||'預約失敗';}};node.appendChild(btn);});});
  }

  function renderInspection(host, req) {
    var reports=Array.isArray(req.inspection_reports)?req.inspection_reports.filter(function(report){return report.status==='published'||req.viewer_role==='operator';}):[];
    if(!reports.length)return;var report=reports[0];var node=card('檢查報告');node.appendChild(ui.el('p',null,report.summary||'逐項檢查結果'));
    (report.results||[]).forEach(function(row){node.appendChild(ui.el('div',{style:'display:grid;grid-template-columns:1fr auto;gap:12px;padding:8px 0;border-bottom:1px solid #edf1f5;'},[ui.el('span',null,row.check_key+(row.notes?' · '+row.notes:'')),ui.statusBadge(row.result)]));});host.appendChild(node);
  }

  function renderChanges(host, req) {
    var changes=Array.isArray(req.changes)?req.changes:[];if(!changes.length)return;var node=card('追加項目');
    changes.forEach(function(change){var wrap=ui.el('div',{style:'padding:10px 0;border-bottom:1px solid #edf1f5;'});wrap.appendChild(ui.el('b',null,change.reason+' · '+ui.fmtMinor(Number(change.total_minor||0),req.currency)));wrap.appendChild(ui.el('p',{style:'margin:5px 0;color:#5b6b80;'},'狀態：'+change.status));if(req.viewer_role==='owner'&&change.status==='proposed'){['approve','reject'].forEach(function(decision){var btn=actionButton(decision==='approve'?'批准追加':'拒絕追加',decision==='approve'?'#0a7a3a':'#9a3d36');btn.onclick=async function(){btn.disabled=true;var rr=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id)+'/changes/'+encodeURIComponent(change.id)+'/decision',{decision:decision,decision_note:''},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else{btn.disabled=false;window.alert(rr.body.error?.message||'操作失敗');}};wrap.appendChild(btn);});}node.appendChild(wrap);});host.appendChild(node);
  }

  function renderAttachments(host, req) {
    var rows=Array.isArray(req.attachments)?req.attachments:[];if(!rows.length)return;var node=card('照片與收據');rows.forEach(function(att){var btn=actionButton((att.purpose||'附件')+' · '+Math.ceil(Number(att.size_bytes||0)/1024)+' KB','#4f6675');btn.onclick=async function(){var rr=await ui.callApi('GET','/api/service-requests/'+encodeURIComponent(req.id)+'/attachments/'+encodeURIComponent(att.id));if(rr.ok&&rr.body.data?.url)window.open(rr.body.data.url,'_blank','noopener');else window.alert(rr.body.error?.message||'附件無法開啟');};node.appendChild(btn);});host.appendChild(node);
  }

  function renderCases(host, req) {
    var rows=Array.isArray(req.cases)?req.cases:[];if(!rows.length&&!(req.viewer_role==='owner'&&['completed','disputed'].includes(req.status)))return;var node=card('售後／爭議');rows.forEach(function(item){node.appendChild(ui.el('p',null,item.kind+' · '+item.status+' · '+item.description));});if(req.viewer_role==='owner'&&req.status==='completed'){var btn=actionButton('提出售後問題','#9a3d36');btn.onclick=async function(){var description=window.prompt('請描述問題');if(!description)return;var rr=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id)+'/cases',{kind:'workmanship',description:description},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else window.alert(rr.body.error?.message||'提交失敗');};node.appendChild(btn);}host.appendChild(node);
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
    var actions=req.action_options||[];
    if(req.viewer_role==='operator'&&actions.includes('start')){var start=actionButton('開始施工');start.onclick=async function(){start.disabled=true;var rr=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id),{action:'start',version:req.version},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else{start.disabled=false;window.alert(rr.body.error?.message||'無法開始');}};card.appendChild(start);}
    if(req.viewer_role==='operator'&&actions.includes('inspect'))card.appendChild(ui.el('a',{href:'#/dealer/inspection/'+encodeURIComponent(req.id),style:'display:inline-block;padding:10px 15px;margin:4px 8px 4px 0;border-radius:10px;background:#176b91;color:#fff;text-decoration:none;font-weight:700;'},'填寫檢查報告'));
    if(req.viewer_role==='operator'&&actions.includes('propose_change')){
      var change=actionButton('提出追加項目','#a06919');
      change.onclick=async function(){
        var reason=window.prompt('為什麼需要追加？');if(!reason)return;
        var description=window.prompt('追加項目名稱');if(!description)return;
        var amount=Number(window.prompt('追加金額（MOP）','0'));if(!Number.isFinite(amount)||amount<0)return;
        change.disabled=true;
        var rr=await ui.callApi('POST','/api/service-requests/'+encodeURIComponent(req.id)+'/changes',{reason:reason,quote_lines:[{line_id:ui.uuidV4(),description:description,amount_minor:Math.round(amount*100),quantity:1,parts_unit_minor:0,labour_minor:Math.round(amount*100),work_type:'service',service_keys:[]}]},{idempotencyKey:ui.uuidV4()});
        if(rr.ok)location.reload();else{change.disabled=false;window.alert(rr.body.error?.message||'無法提出追加項目');}
      };card.appendChild(change);
    }
    if(req.viewer_role==='operator'&&actions.includes('complete'))card.appendChild(ui.el('a',{href:'#/dealer/completion/'+encodeURIComponent(req.id),style:'display:inline-block;padding:10px 15px;margin:4px 8px 4px 0;border-radius:10px;background:#0a7a3a;color:#fff;text-decoration:none;font-weight:700;'},'提交完工報告'));
    if(req.viewer_role==='operator'&&req.status==='completed'&&!req.work_state&&req.completion_confirmed_at&&req.payment_state==='unpaid'){
      var payment=actionButton('記錄收款','#0a7a3a');
      payment.onclick=async function(){var due=Number(req.final_total_minor||req.approved_total_minor||0);var reference=window.prompt('收款參考編號／現金備註','cash')||'';if(!reference)return;payment.disabled=true;var rr=await ui.callApi('POST','/api/dealer/service-orders/'+encodeURIComponent(req.id)+'/payment',{amount_minor:due,currency:req.currency||'MOP',reference:reference,payment_method:'offline'},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else{payment.disabled=false;window.alert(rr.body.error?.message||'收款記錄失敗');}};card.appendChild(payment);
    }
    if(!card.querySelector('button,a'))card.appendChild(ui.el('p',{style:'color:#5b6b80;margin:0;'},actions.length?'請完成上方所列操作。':'目前不需要操作。'));
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
