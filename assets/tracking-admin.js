export async function render(root){
  root.innerHTML='<div class="wrap"><h1>站內商戶推廣</h1><p>僅在本站配對結果標示贊助商戶；不使用外部廣告或追蹤。配對分數不受推廣影響。</p><div id="promotionAdmin" class="card form-card">載入中…</div></div>';
  const host=root.querySelector('#promotionAdmin');
  try{
    const response=await fetch('/api/admin/marketing/tracking');const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'無法載入');let settings=data.settings;
    const form=document.createElement('form');
    const label=document.createElement('label');label.textContent='啟用站內推廣 ';const enabled=document.createElement('input');enabled.type='checkbox';enabled.checked=settings.config.enabled;label.append(enabled);form.append(label);
    const help=document.createElement('p');help.textContent='每行：商戶 ID | 開始時間 | 結束時間，時間包含時區，例如 2026-10-01T00:00:00+08:00。';form.append(help);
    const input=document.createElement('textarea');input.rows=8;input.setAttribute('aria-label','商戶推廣期間');input.value=(settings.config.promotions||[]).map(p=>[p.dealer_id,p.starts_at,p.ends_at].join(' | ')).join('\n');form.append(input);
    const button=document.createElement('button');button.textContent='儲存站內推廣';form.append(button);const status=document.createElement('p');status.setAttribute('role','status');form.append(status);
    form.onsubmit=async event=>{event.preventDefault();button.disabled=true;try{
      const promotions=input.value.split('\n').filter(s=>s.trim()).map(line=>{const [dealer_id,starts_at,ends_at]=line.split('|').map(s=>s.trim());return {dealer_id,starts_at,ends_at};});
      const r=await fetch('/api/admin/marketing/tracking',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({version:settings.version,config:{enabled:enabled.checked,promotions}})});const result=await r.json();if(!r.ok)throw new Error(result.error?.message||'儲存失敗');settings=result.settings;status.textContent='站內推廣已儲存';
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}};
    host.replaceChildren(form);
  }catch(error){host.textContent=error.message;}
}
