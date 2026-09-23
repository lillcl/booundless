const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function render(root){
  root.innerHTML='<div class="wrap"><div class="top"><h1>服務請求與報價</h1></div><div id="requestFlow">載入中…</div></div>';
  const host=root.querySelector('#requestFlow');
  try {
    const [response,session]=await Promise.all([fetch('/api/service-requests'),fetch('/api/auth/me')]);
    const data=await response.json();const me=(await session.json()).user;
    if(!response.ok)throw new Error(data.error?.message||'請先登入');
    host.replaceChildren();if(!data.data.length){host.textContent='尚無服務請求。從車輛護照選擇車商服務後，報價會顯示在這裡。';return;}
    for(const request of data.data){
      const card=document.createElement('div');card.className='card form-card';card.style.marginBottom='16px';
      const customer=request.user_id===me?.id;const quote=request.quotes[0];
      if(customer&&['scheduled','completed'].includes(request.status))window.booundlessTrack?.('booking_confirmed',request.id);
      card.innerHTML=`<h2>${escape(request.dealer_name)} · ${escape(request.model)}</h2><p>狀態：${escape(request.status)}${request.scheduled_at?' · '+escape(new Date(request.scheduled_at).toLocaleString()):''}</p>`;
      if(request.items?.length){const p=document.createElement('p');p.textContent='請求項目：'+request.items.map(item=>item.name).join('、');card.append(p);}
      if(quote){const p=document.createElement('p');p.style.whiteSpace='pre-line';p.textContent=quote.items.map(i=>`${i.description} — ${(i.amount_minor/100).toFixed(2)}`).join('\n')+`\n報價總額 ${quote.currency} ${(quote.total_minor/100).toFixed(2)}\n有效至 ${new Date(quote.expires_at).toLocaleString()}`;card.append(p);}
      if(request.order_lines?.length){const p=document.createElement('p');p.textContent=`車主已批准：${request.order_lines.map(line=>line.description).join('、')} · ${quote?.currency||'MOP'} ${(request.order_lines.reduce((sum,line)=>sum+line.amount_minor,0)/100).toFixed(2)}`;card.append(p);}
      const status=document.createElement('p');status.setAttribute('role','status');
      const act=async(action,extra={})=>{
        card.querySelectorAll('button').forEach(b=>b.disabled=true);
        try{const r=await fetch('/api/service-requests/'+encodeURIComponent(request.id),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,version:request.version,...extra})});const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'操作失敗');await render(root);}
        catch(error){status.textContent=error.message;card.querySelectorAll('button').forEach(b=>b.disabled=false);}
      };
      const button=(label,action,extra)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.onclick=()=>act(action,extra);card.append(b);};
      if(request.can_manage&&!customer&&['new','quoted'].includes(request.status)){
        const form=document.createElement('form');form.innerHTML='<label>報價項目（每行：項目 | 金額 | 服務 key）<textarea required rows="4" placeholder="機油更換 | 500 | oil_filter"></textarea></label><label>幣別<select><option>MOP</option><option>HKD</option><option>CNY</option></select></label><button class="primary">提交報價（七天有效）</button>';
        form.querySelector('textarea').value=(request.items||[]).map(item=>`${item.name} |  | ${item.service_key}`).join('\n');
        form.onsubmit=e=>{e.preventDefault();const lines=form.querySelector('textarea').value.split('\n').filter(l=>l.trim());const items=lines.map(line=>{const [description,amount,key]=line.split('|');return {description:description.trim(),amount_minor:/^\d+(\.\d{1,2})?$/.test(amount?.trim()||'')?Math.round(Number(amount)*100):-1,service_keys:key?.trim()?[key.trim()]:[]};});act('quote',{items,currency:form.querySelector('select').value,expires_at:new Date(Date.now()+7*86400000).toISOString()});};card.append(form);button('拒絕請求','decline');
      }
      if(customer&&request.status==='quoted'&&quote){
        const form=document.createElement('form');
        form.innerHTML=`<h3>選擇批准項目</h3>${quote.items.map((item,index)=>`<label style="display:block"><input type="checkbox" name="approved" value="${index}" checked> ${escape(item.description)} · ${escape(quote.currency)} ${(item.amount_minor/100).toFixed(2)}</label>`).join('')}<button class="primary" type="submit">接受所選報價</button>`;
        form.onsubmit=e=>{e.preventDefault();const selected=[...new FormData(form).getAll('approved')].map(Number);if(!selected.length){status.textContent='請選擇至少一項';return;}act('accept_quote',{quote_id:quote.id,selected_line_indexes:selected});};card.append(form);
      }
      if(request.can_manage&&!customer&&request.status==='accepted'){
        const input=document.createElement('input');input.type='datetime-local';input.setAttribute('aria-label','預約時間');card.append(input);
        const b=document.createElement('button');b.className='secondary';b.textContent='確認預約';b.onclick=()=>{if(!input.value){status.textContent='請選擇時間';return;}act('schedule',{scheduled_at:new Date(input.value).toISOString()});};card.append(b);
      }
      if(request.can_manage&&!customer&&request.status==='scheduled'){
        const form=document.createElement('form');
        const approvedLines=request.order_lines?.length?request.order_lines:(request.quotes||[]).filter(q=>q.accepted_at).flatMap(q=>q.items||[]);
        const approved=[...new Set(approvedLines.flatMap(line=>line.service_keys||[]))];
        const approvedTotal=approvedLines.reduce((sum,line)=>sum+line.amount_minor,0);
        const requested=new Map((request.items||[]).map(item=>[item.service_key,item.name]));
        form.innerHTML=`<h3>實際完成項目</h3>${approved.length?approved.map(key=>`<label style="display:block"><input type="checkbox" name="completed" value="${escape(key)}"> ${escape(requested.get(key)||key)}</label>`).join(''):'<p>報價沒有對應的保養項目；可保存紀錄，但不會重置保養狀態。</p>'}<label>完工里程（km）<input name="mileage" type="number" min="0" max="10000000" required></label><label>實收金額（${escape(quote?.currency||'MOP')}，不得超過已批准項目）<input name="total" type="number" min="0" max="${approvedTotal/100}" step="0.01" value="${approvedTotal/100}" required></label><label>實際完成內容與未做項目說明<textarea name="notes" required rows="3"></textarea></label><button class="primary" type="submit">提交完工紀錄</button>`;
        form.onsubmit=e=>{e.preventDefault();act('complete',{service_keys:[...new FormData(form).getAll('completed')],mileage_km:Number(form.elements.mileage.value),total_minor:Math.round(Number(form.elements.total.value)*100),notes:form.elements.notes.value});};card.append(form);
      }
      if(customer&&request.status==='completed'){
        const p=document.createElement('p');p.textContent=`車行申報完成：${(request.completed_service_keys||[]).map(key=>(request.items||[]).find(item=>item.service_key===key)?.name||key).join('、')||'未對應保養項目'} · ${request.completion_mileage_km??'未填'} km · ${quote?.currency||'MOP'} ${((request.completion_total_minor||0)/100).toFixed(2)}。${request.completion_notes||''}`;card.append(p);
      }
      if(customer&&request.status==='completed'&&!request.completion_confirmed_at)button('確認完成並加入保養紀錄','confirm_completion');
      if((customer||request.can_manage)&&!['completed','cancelled','declined'].includes(request.status))button('取消請求','cancel');
      card.append(status);host.append(card);
    }
  }catch(error){host.textContent=error.message;}
}
