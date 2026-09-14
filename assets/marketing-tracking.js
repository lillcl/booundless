/* No third-party tag is loaded until the visitor explicitly opts in. */
(() => {
  const consentKey='booundless.measurement.v1';let config={enabled:false};let loaded=false;
  const read=key=>{try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}};
  const write=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const consent=()=>read(consentKey)?.allowed===true;
  function attribution(){
    const params=new URLSearchParams(location.search);const clean=value=>String(value||'').replace(/[^a-zA-Z0-9_ .-]/g,'').slice(0,100);
    if(params.has('utm_campaign')||params.has('utm_source'))write('booundless.attribution',{campaign:clean(params.get('utm_campaign')),source:clean(params.get('utm_source')),expires:Date.now()+30*86400000});
    const value=read('booundless.attribution');return value?.expires>Date.now()?value:{};
  }
  function load(){
    if(!config.enabled||!consent()||loaded)return;loaded=true;attribution();
    window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};
    window.gtag('consent','default',{analytics_storage:'granted',ad_storage:config.ads?'granted':'denied',ad_user_data:config.ads?'granted':'denied',ad_personalization:'denied'});
    window.gtag('js',new Date());
    for(const id of [config.ga4,config.ads].filter(Boolean))window.gtag('config',id,{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});
    const tag=document.createElement('script');tag.async=true;tag.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(config.ga4||config.ads);document.head.append(tag);
    if(config.ga4)window.gtag('event','page_view',{send_to:config.ga4,page_location:location.origin+location.pathname,page_title:'BOOUNDLESS'});
  }
  window.booundlessTrack=async(event_name,business_id)=>{
    if(!config.enabled||!consent()||!business_id)return;
    load();
    try{
      const response=await fetch('/api/marketing/conversions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_name,business_id,consent:true,...attribution()})});
      const result=await response.json();if(!response.ok||!result.recorded||!consent())return;
      if(config.ga4)window.gtag?.('event',event_name,{send_to:config.ga4,event_id:result.event_id});
      const label=config[{vehicle_created:'vehicle_label',service_request_submitted:'request_label',booking_confirmed:'booking_label'}[event_name]];
      if(config.ads&&label)window.gtag?.('event','conversion',{send_to:config.ads+'/'+label,transaction_id:result.event_id});
    }catch{/* Measurement must never block the actual operation. */}
  };
  const dialog=document.createElement('dialog');dialog.style.cssText='max-width:440px;border:1px solid #cbdadd;border-radius:20px;padding:24px;font:inherit';
  dialog.innerHTML='<h2>分析與廣告設定</h2><p>允許後，我們會使用 Google 分析與廣告工具衡量活動成效。拒絕不影響車輛護照功能。</p><button type="button" data-choice="yes">允許成效分析</button> <button type="button" data-choice="no">拒絕／撤回同意</button> <button type="button" data-close>關閉</button>';
  document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.querySelectorAll('[data-choice]').forEach(button=>{button.onclick=()=>{
    const allowed=button.dataset.choice==='yes';write(consentKey,{allowed,at:Date.now()});dialog.close();
    if(allowed)load();else{
      window.gtag?.('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
      try{localStorage.removeItem('booundless.attribution');}catch{}
      for(const pair of document.cookie.split(';')){const name=pair.trim().split('=')[0];if(/^(_ga|_gcl)/.test(name)){for(const domain of ['',`; Domain=${location.hostname}`,'; Domain=.booundless.com'])document.cookie=`${name}=; Max-Age=0; Path=/${domain}`;}}
      if(loaded)location.reload();
    }
  };});
  const preferences=document.createElement('button');preferences.type='button';preferences.textContent='隱私設定';preferences.style.cssText='position:fixed;bottom:12px;left:12px;z-index:1000;padding:8px 12px;border:1px solid #cbdadd;border-radius:12px;background:white;color:#173747;font:inherit;font-size:12px';preferences.onclick=()=>dialog.showModal();document.body.append(preferences);
  fetch('/api/marketing/config').then(r=>r.ok?r.json():{}).then(data=>{config=data.config||{enabled:false};if(!config.enabled)return;if(read(consentKey)===null)dialog.showModal();else load();}).catch(()=>{});
})();
