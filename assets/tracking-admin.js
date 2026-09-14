export async function render(root){
  root.innerHTML='<div class="wrap"><h1>廣告成效追蹤</h1><p>設定 Google Analytics / Google Ads ID。只有訪客同意後才會載入追蹤。此處不會購買廣告。</p><div id="trackingAdmin" class="card form-card">載入中…</div></div>';
  const host=root.querySelector('#trackingAdmin');
  try{
    const response=await fetch('/api/admin/marketing/tracking');const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'無法載入');let settings=result.settings;
    const form=document.createElement('form');form.className='form-grid';
    const label=document.createElement('label');label.textContent='啟用成效追蹤 ';const enabled=document.createElement('input');enabled.type='checkbox';enabled.name='enabled';enabled.checked=settings.config.enabled;label.append(enabled);form.append(label);
    for(const [name,title] of Object.entries({ga4:'GA4 Measurement ID（G-…）',ads:'Google Ads ID（AW-…）',vehicle_label:'建立車輛轉換標籤',request_label:'提交請求轉換標籤',booking_label:'確認預約轉換標籤'})){
      const label=document.createElement('label');label.className='field wide';label.textContent=title;const input=document.createElement('input');input.name=name;input.value=settings.config[name]||'';label.append(input);form.append(label);
    }
    const submit=document.createElement('button');submit.className='primary';submit.textContent='儲存設定';form.append(submit);const message=document.createElement('p');message.setAttribute('role','status');form.append(message);
    form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;try{const config=Object.fromEntries(new FormData(form));config.enabled=enabled.checked;const response=await fetch('/api/admin/marketing/tracking',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({version:settings.version,config})});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'儲存失敗');settings=data.settings;message.textContent='設定已儲存。請用已同意追蹤的測試瀏覽器及測試廣告帳號驗證。';}catch(error){message.textContent=error.message;}finally{submit.disabled=false;}};
    host.replaceChildren(form);const title=document.createElement('h2');title.textContent='最近90天：已同意追蹤的轉換';host.append(title);
    const table=document.createElement('table');const header=table.insertRow();for(const t of ['事件','活動','來源','次數']){const th=document.createElement('th');th.textContent=t;header.append(th);}
    for(const row of result.report){const tr=table.insertRow();for(const value of [row.event_name,row.campaign||'未歸因',row.source||'未歸因',row.count])tr.insertCell().textContent=value;}
    host.append(table);
  }catch(error){host.textContent=error.message;}
}
