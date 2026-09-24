/* Notification centre and compact service-operations admin console. */
(function () {
  'use strict';
  var ui = window.svcUI;

  function shell(host, eyebrow, title, description) {
    host.innerHTML = '';
    var wrap = ui.el('div', { class:'wrap' });
    wrap.appendChild(ui.el('header', null, [
      ui.el('span', { class:'sheet__eyebrow' }, eyebrow),
      ui.el('h1', null, title), ui.el('p', null, description || ''),
    ]));
    host.appendChild(wrap);
    return wrap;
  }

  function card(title) {
    var node=ui.el('section',{style:'background:#fff;border:1px solid #dde5ee;border-radius:14px;padding:16px;margin:14px 0;'});
    if(title)node.appendChild(ui.el('h2',{style:'font-size:20px;margin:0 0 12px;'},title));
    return node;
  }

  function button(label, color) {
    return ui.el('button',{type:'button',style:'padding:8px 12px;border:0;border-radius:9px;background:'+(color||'#073568')+';color:#fff;font-weight:700;cursor:pointer;'},label);
  }

  window.serviceNotificationsView = async function (host) {
    var wrap=shell(host,'NOTIFICATIONS','通知中心','報價、預約、檢查、追加項目與完工進度都集中在這裡。');
    var node=card('最近通知');wrap.appendChild(node);
    var result=await ui.callApi('GET','/api/notifications');
    if(!result.ok){node.appendChild(ui.el('p',null,result.body.error?.message||'無法載入通知。'));return;}
    var rows=result.body.data||[];
    if(!rows.length){node.appendChild(ui.el('p',null,'暫時沒有通知。'));return;}
    rows.forEach(function(item){
      var row=ui.el('article',{style:'padding:13px 0;border-bottom:1px solid #edf1f5;opacity:'+(item.read_at?'.68':'1')+';'});
      row.appendChild(ui.el('b',null,(item.read_at?'':'● ')+(item.title||'通知')));
      row.appendChild(ui.el('p',{style:'margin:5px 0;color:#5b6b80;'},item.body||''));
      row.appendChild(ui.el('small',null,ui.fmtDate(item.created_at)));
      var controls=ui.el('div',{style:'display:flex;gap:8px;margin-top:9px;'});
      if(item.request_id)controls.appendChild(ui.el('a',{href:'#/service-request/'+encodeURIComponent(item.request_id),style:'color:#176b91;font-weight:700;'},'查看服務單'));
      if(!item.read_at){var read=button('標為已讀','#4f6675');read.onclick=async function(){read.disabled=true;var r=await ui.callApi('POST','/api/notifications/'+encodeURIComponent(item.id)+'/read',{}, {idempotencyKey:ui.uuidV4()});if(r.ok){row.style.opacity='.68';read.remove();}else read.disabled=false;};controls.appendChild(read);}
      row.appendChild(controls);node.appendChild(row);
    });
  };

  window.adminServiceView = async function (host) {
    var wrap=shell(host,'SERVICE OPERATIONS','服務營運管理','查看訂單、售後個案、退款及佣金結算。');
    var responses=await Promise.all([
      ui.callApi('GET','/api/admin/service-orders'),
      ui.callApi('GET','/api/admin/cases'),
      ui.callApi('GET','/api/admin/commissions?format=json'),
    ]);
    var orders=card('服務訂單');wrap.appendChild(orders);
    (responses[0].body.data||[]).forEach(function(order){
      var row=ui.el('div',{style:'display:grid;grid-template-columns:minmax(150px,1fr) auto;gap:12px;padding:11px 0;border-bottom:1px solid #edf1f5;align-items:center;'});
      row.appendChild(ui.el('div',null,[ui.el('b',null,order.order_number||ui.shortRef(order.id)),ui.el('p',{style:'margin:4px 0;color:#5b6b80;'},order.status+' · '+order.payment_state+' · '+ui.fmtMinor(Number(order.final_total_minor||order.approved_total_minor||0),order.currency))]));
      var controls=ui.el('div',{style:'display:flex;gap:7px;'});controls.appendChild(ui.el('a',{href:'#/service-request/'+encodeURIComponent(order.id),style:'font-weight:700;color:#176b91;'},'查看'));
      if(['paid','partially_refunded'].includes(order.payment_state)){var refund=button('退款','#9a3d36');refund.onclick=async function(){var amount=Number(window.prompt('退款金額（'+(order.currency||'MOP')+'）','0'));if(!Number.isFinite(amount)||amount<=0)return;var reference=window.prompt('退款參考編號','admin-refund')||'';refund.disabled=true;var rr=await ui.callApi('POST','/api/admin/service-orders/'+encodeURIComponent(order.id)+'/refund',{amount_minor:Math.round(amount*100),currency:order.currency,reference:reference},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else{refund.disabled=false;window.alert(rr.body.error?.message||'退款失敗');}};controls.appendChild(refund);}row.appendChild(controls);orders.appendChild(row);
    });
    if(!(responses[0].body.data||[]).length)orders.appendChild(ui.el('p',null,'尚未有服務訂單。'));

    var cases=card('售後與爭議');wrap.appendChild(cases);
    (responses[1].body.data||[]).forEach(function(item){var row=ui.el('div',{style:'padding:11px 0;border-bottom:1px solid #edf1f5;'});row.appendChild(ui.el('b',null,(item.order_number||ui.shortRef(item.request_id))+' · '+item.kind+' · '+item.status));row.appendChild(ui.el('p',{style:'color:#5b6b80;'},item.description));var resolve=button('更新個案');resolve.onclick=async function(){var status=window.prompt('狀態：open / in_review / resolved / closed',item.status);if(!status)return;var resolution=window.prompt('處理結果（resolved/closed 必填）',item.resolution||'')||'';resolve.disabled=true;var rr=await ui.callApi('PATCH','/api/admin/cases/'+encodeURIComponent(item.id),{status:status,resolution:resolution},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else{resolve.disabled=false;window.alert(rr.body.error?.message||'更新失敗');}};row.appendChild(resolve);cases.appendChild(row);});
    if(!(responses[1].body.data||[]).length)cases.appendChild(ui.el('p',null,'沒有待處理個案。'));

    var commissions=card('佣金');wrap.appendChild(commissions);var pending=(responses[2].body.data||[]).filter(function(x){return x.status==='pending';});
    var list=ui.el('div');pending.forEach(function(entry){var check=ui.el('input',{type:'checkbox',value:entry.id,checked:true});list.appendChild(ui.el('label',{style:'display:grid;grid-template-columns:auto 1fr auto;gap:9px;padding:8px 0;border-bottom:1px solid #edf1f5;'},[check,ui.el('span',null,ui.shortRef(entry.request_id)+' · '+entry.entry_type),ui.el('b',null,ui.fmtMinor(Number(entry.commission_minor||0),'MOP'))]));});commissions.appendChild(list);
    if(pending.length){var settle=button('標記已結算','#0a7a3a');settle.onclick=async function(){var ids=Array.from(list.querySelectorAll('input:checked')).map(function(x){return x.value;});var ref=window.prompt('結算參考編號');if(!ids.length||!ref)return;settle.disabled=true;var rr=await ui.callApi('POST','/api/admin/commissions/settle',{entry_ids:ids,settlement_reference:ref},{idempotencyKey:ui.uuidV4()});if(rr.ok)location.reload();else{settle.disabled=false;window.alert(rr.body.error?.message||'結算失敗');}};commissions.appendChild(settle);}else commissions.appendChild(ui.el('p',null,'沒有待結算佣金。'));
    commissions.appendChild(ui.el('p',null,[ui.el('a',{href:'/api/admin/commissions',style:'font-weight:700;color:#176b91;'},'下載佣金 CSV')]));
  };
})();
