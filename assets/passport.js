const esc = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

const vehicleName = (vehicle) => {
  const make = String(vehicle.make || '').trim();
  const model = String(vehicle.model || '').trim();
  return make && model.toLowerCase().startsWith(`${make.toLowerCase()} `)
    ? model
    : [make, model].filter(Boolean).join(' ') || '未命名車輛';
};

const dateLabel = (value) => {
  if (!value) return '日期未記錄';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(date);
};

const mileageLabel = (vehicle) => vehicle.mileage_label
  || (vehicle.mileage_km != null ? `${Number(vehicle.mileage_km).toLocaleString()} km` : '尚未記錄');

const seal = `<span class="vp-book__seal" aria-hidden="true"><svg viewBox="0 0 80 52" fill="none"><path d="M10 35h60M18 35l7-14h29l9 14M31 21l6-9h11l8 9M22 35a8 8 0 0 0 16 0m12 0a8 8 0 0 0 16 0" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;

async function getJSON(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function bookMarkup(vehicle, reminder) {
  const hasReminder = Boolean(reminder);
  const unknown = vehicle.scope_confirmed === false;
  const status = unknown ? '車況待確認' : hasReminder ? reminder.title : '護照資料已同步';
  const tone = unknown ? 'is-unknown' : hasReminder ? 'is-warn' : '';
  return `<button class="vp-book" type="button" data-passport-id="${esc(vehicle.id)}" aria-label="開啟 ${esc(vehicleName(vehicle))} 車輛護照">
    <span class="vp-book__inner">
      <span class="vp-book__top">BOOUNDLESS · VEHICLE PASSPORT</span>
      ${seal}
      <h2>${esc(vehicleName(vehicle))}</h2>
      <span class="vp-book__meta">${esc([vehicle.year, vehicle.fuel_type].filter(Boolean).join(' · ') || '車輛資料')}</span>
      <span class="vp-book__plate">${esc(vehicle.plate || '未登記車牌')}</span>
      <span class="vp-book__status ${tone}"><i></i>${esc(status)}</span>
    </span>
  </button>`;
}

function identityPage(vehicle) {
  const placeholder = !vehicle.image || /vehicle-placeholder\.svg(?:$|\?)/.test(vehicle.image);
  const fields = [
    ['品牌', vehicle.make || '未填寫'], ['型號', vehicle.model || '未填寫'],
    ['年份', vehicle.year || '未填寫'], ['能源', vehicle.fuel_type || vehicle.powertrain_type || '未填寫'],
    ['車牌', vehicle.plate || '未填寫'], ['VIN', vehicle.vin || '未填寫'],
  ];
  return `<div class="vp-paper"><span class="vp-page-label">01 · VEHICLE IDENTITY</span><h3>車輛身份</h3>
    <img class="vp-identity-photo ${placeholder ? 'is-placeholder' : ''}" src="${esc(vehicle.image || 'assets/vehicle-placeholder.svg')}" alt="${esc(vehicleName(vehicle))}">
    <div class="vp-data-grid">${fields.map(([label, value]) => `<span><small>${label}</small><b>${esc(value)}</b></span>`).join('')}</div>
  </div>`;
}

function overviewPage(vehicle, status, history) {
  const items = Array.isArray(status?.items) ? status.items : [];
  const attention = items.filter((item) => Number(item.wear) >= 80);
  const completenessFields = [vehicle.make, vehicle.model, vehicle.year, vehicle.fuel_type, vehicle.plate, vehicle.mileage_km];
  const profilePercent = Math.round((completenessFields.filter((item) => item !== null && item !== undefined && item !== '').length / completenessFields.length) * 100);
  const complete = status?.data_complete === true;
  return `<div class="vp-paper vp-paper--right"><span class="vp-page-label">02 · LIVE SUMMARY</span><h3>護照摘要</h3>
    <div class="vp-mileage"><span>目前里程</span><b>${esc(mileageLabel(vehicle))}</b></div>
    <div class="vp-summary"><div class="vp-stat"><b>${items.length}</b><small>保養項目</small></div><div class="vp-stat"><b>${history.length}</b><small>保養紀錄</small></div><div class="vp-stat"><b>${attention.length}</b><small>需要留意</small></div><div class="vp-stat"><b>${profilePercent}%</b><small>身份完整度</small></div></div>
    <div class="vp-complete ${complete ? 'is-complete' : ''}">${complete ? '保養基準資料完整，狀態會按里程與日期更新。' : '部分保養基準尚未確認；系統不會在沒有服務證據時顯示「正常」。'}</div>
  </div>`;
}

function maintenancePage(status) {
  const items = Array.isArray(status?.items) ? status.items : [];
  return `<div class="vp-paper"><span class="vp-page-label">03 · MAINTENANCE</span><h3>保養狀態</h3>
    <div class="vp-list">${items.length ? items.slice(0, 7).map((item) => {
      const warn = Number(item.wear) >= 80;
      const detail = item.last_done_at ? `上次：${dateLabel(item.last_done_at)}` : '尚未記錄基準';
      return `<div class="vp-row"><span><b>${esc(item.item)}</b><small>${esc(detail)}</small></span><span class="vp-pill ${warn ? 'warn' : ''}">${warn ? '需要留意' : item.last_done_at ? `${Number(item.wear) || 0}%` : '待確認'}</span></div>`;
    }).join('') : '<div class="vp-note">尚未建立保養範圍。完成車輛資料後，系統會為你建立適用項目。</div>'}</div>
  </div>`;
}

function historyPage(history) {
  return `<div class="vp-paper vp-paper--right"><span class="vp-page-label">04 · SERVICE RECORDS</span><h3>保養紀錄</h3>
    <div class="vp-list">${history.length ? history.slice(0, 6).map((item) => `<div class="vp-row"><span><b>${esc(item.title)}</b><small>${esc([dateLabel(item.performed_at), item.mileage_km ? `${Number(item.mileage_km).toLocaleString()} km` : '', item.cost || ''].filter(Boolean).join(' · '))}</small></span><span class="vp-pill">已記錄</span></div>`).join('') : '<div class="vp-note">暫時未有保養紀錄。完成首次保養後，日期、里程與項目會同步保存。</div>'}</div>
  </div>`;
}

function reminderPage(reminders) {
  return `<div class="vp-paper"><span class="vp-page-label">05 · REMINDERS</span><h3>車況提醒</h3>
    <div class="vp-list">${reminders.length ? reminders.slice(0, 6).map((item) => `<div class="vp-row"><span><b>${esc(item.title)}</b><small>${esc(item.due_in || (item.status === 'overdue' ? '已到期' : '即將到期'))}</small></span><span class="vp-pill ${item.status === 'overdue' ? 'warn' : ''}">${item.status === 'overdue' ? '已到期' : '即將到期'}</span></div>`).join('') : '<div class="vp-note">目前沒有待處理提醒。新的保養時間或車況項目會在此出現。</div>'}</div>
  </div>`;
}

function documentsPage() {
  return `<div class="vp-paper vp-paper--right"><span class="vp-page-label">06 · PASSPORT DATA</span><h3>資料與下一步</h3>
    <div class="vp-note"><b>文件功能準備中</b><br>現時未有已驗證的行車證或收據文件，因此不會顯示虛構附件。車輛身份、保養與訂購資料已由資料庫同步。</div>
    <div class="vp-actions"><a href="#/service">保養與服務</a><a href="#/shop">選購合適用品</a></div>
  </div>`;
}

export async function renderVehiclePassports(root, context = {}) {
  window.__vehiclePassportCleanup?.();
  let reader = null;
  let activeVehicle = null;
  let activeSpread = 0;
  let cleanup = () => {};
  root.innerHTML = `<main class="vp-page"><div class="vp-shell">
    <header class="vp-heading"><div><span class="vp-kicker">BOOUNDLESS · DIGITAL GARAGE</span><h1>車輛護照</h1><p>每台車一本會持續更新的數碼護照，把身份、里程、保養與提醒集中保存。</p></div><button class="vp-add" type="button" data-add-passport>＋ 建立護照</button></header>
    <div class="vp-intro"><div><b>一眼掌握車況</b><small>所有內容來自你的車輛資料與保養紀錄，不以假資料填補空白。</small></div><div><b>與訂購功能相連</b><small>商店會按護照中的能源及車種篩選合適用品。</small></div></div>
    <div data-passport-content><div class="vp-loading" aria-label="正在載入車輛護照"></div></div>
  </div></main>`;

  const content = root.querySelector('[data-passport-content]');
  const onKeyDown = (event) => {
    if (!reader?.classList.contains('is-open')) return;
    if (event.key === 'Escape') closeReader();
    if (event.key === 'ArrowRight') setSpread(activeSpread + 1);
    if (event.key === 'ArrowLeft') setSpread(activeSpread - 1);
  };

  const closeReader = () => {
    if (!reader) return;
    const closingReader = reader;
    closingReader.classList.remove('is-open');
    document.body.style.overflow = '';
    activeVehicle?.focus?.();
    reader = null;
    window.setTimeout(() => closingReader.remove(), 260);
  };

  const setSpread = (index) => {
    if (!reader) return;
    const spreads = [...reader.querySelectorAll('.vp-spread')];
    activeSpread = Math.max(0, Math.min(index, spreads.length - 1));
    spreads.forEach((spread, position) => spread.classList.toggle('is-active', position === activeSpread));
    reader.querySelector('[data-page-count]').textContent = `${activeSpread + 1} / ${spreads.length}`;
    reader.querySelector('[data-page-prev]').disabled = activeSpread === 0;
    reader.querySelector('[data-page-next]').disabled = activeSpread === spreads.length - 1;
    const pages = spreads[activeSpread]?.querySelectorAll('.vp-paper');
    if (window.gsap && pages) window.gsap.fromTo(pages, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: .38, stagger: .06, ease: 'power2.out' });
  };

  const openReader = async (vehicle, trigger, allReminders) => {
    activeVehicle = trigger;
    activeSpread = 0;
    reader?.remove();
    reader = document.createElement('div');
    reader.className = 'vp-reader';
    reader.setAttribute('role', 'dialog');
    reader.setAttribute('aria-modal', 'true');
    reader.setAttribute('aria-label', `${vehicleName(vehicle)} 車輛護照`);
    reader.innerHTML = `<div class="vp-reader__stage"><button class="vp-reader__close" type="button" aria-label="關閉車輛護照">×</button><div class="vp-reader__book"><div class="vp-loading"></div><div class="vp-cover"><div class="vp-cover__content">${seal}<h2>${esc(vehicleName(vehicle))}</h2><p>車輛護照</p></div></div></div><div class="vp-progress"><button type="button" data-page-prev aria-label="上一頁">←</button><span data-page-count>1 / 3</span><button type="button" data-page-next aria-label="下一頁">→</button></div></div>`;
    document.body.appendChild(reader);
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => reader?.classList.add('is-open'));
    reader.querySelector('.vp-reader__close').addEventListener('click', closeReader);
    reader.addEventListener('click', (event) => { if (event.target === reader) closeReader(); });
    reader.querySelector('[data-page-prev]').addEventListener('click', () => setSpread(activeSpread - 1));
    reader.querySelector('[data-page-next]').addEventListener('click', () => setSpread(activeSpread + 1));

    try {
      const [status, historyPayload] = await Promise.all([
        getJSON(`/api/vehicles/${encodeURIComponent(vehicle.id)}/status`),
        getJSON(`/api/vehicles/${encodeURIComponent(vehicle.id)}/history`),
      ]);
      if (!reader) return;
      const history = Array.isArray(historyPayload) ? historyPayload : historyPayload.data || [];
      const ownReminders = allReminders.filter((item) => item.vehicle_id === vehicle.id);
      const book = reader.querySelector('.vp-reader__book');
      book.innerHTML = `<section class="vp-spread is-active">${identityPage(vehicle)}${overviewPage(vehicle, status, history)}</section><section class="vp-spread">${maintenancePage(status)}${historyPage(history)}</section><section class="vp-spread">${reminderPage(ownReminders)}${documentsPage()}</section><div class="vp-cover"><div class="vp-cover__content">${seal}<h2>${esc(vehicleName(vehicle))}</h2><p>車輛護照</p></div></div>`;
      setSpread(0);
      window.setTimeout(() => reader?.querySelector('.vp-reader__close')?.focus(), 450);
    } catch (error) {
      const loading = reader?.querySelector('.vp-loading');
      if (loading) loading.outerHTML = '<div class="vp-paper"><div class="vp-note">暫時無法同步這本護照，請關閉後再試。</div></div>';
      console.error('[vehicle-passport] failed to load', error);
    }
  };

  document.addEventListener('keydown', onKeyDown);
  root.querySelector('[data-add-passport]').addEventListener('click', () => context.onAddVehicle?.());
  try {
    const [vehiclePayload, reminderPayload] = await Promise.all([getJSON('/api/vehicles'), getJSON('/api/reminders')]);
    const vehicles = Array.isArray(vehiclePayload) ? vehiclePayload : vehiclePayload.data || vehiclePayload.vehicles || [];
    const reminders = Array.isArray(reminderPayload) ? reminderPayload : reminderPayload.data || [];
    if (!vehicles.length) {
      content.innerHTML = `<div class="vp-empty"><img src="assets/garage-empty-v1.png" alt="白色車輛與數碼車輛護照"><h2>建立你的第一本車輛護照</h2><p>新增車輛後，身份、里程及保養範圍會在這裡集中顯示。</p><button class="vp-add" type="button" data-empty-add>新增車輛</button></div>`;
      content.querySelector('[data-empty-add]').addEventListener('click', () => context.onAddVehicle?.());
    } else {
      content.innerHTML = `<div class="vp-shelf">${vehicles.map((vehicle) => bookMarkup(vehicle, reminders.find((item) => item.vehicle_id === vehicle.id))).join('')}</div>`;
      content.querySelectorAll('[data-passport-id]').forEach((book) => book.addEventListener('click', () => {
        const vehicle = vehicles.find((item) => item.id === book.dataset.passportId);
        if (vehicle) openReader(vehicle, book, reminders);
      }));
      if (window.gsap && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        window.gsap.fromTo(content.querySelectorAll('.vp-book'), { opacity: 0, y: 35, rotateY: 8 }, { opacity: 1, y: 0, rotateY: 0, duration: .7, stagger: .11, ease: 'power3.out' });
      }
    }
  } catch (error) {
    content.innerHTML = '<div class="vp-error"><b>暫時無法載入車輛護照</b><br><small>請檢查連線後重新整理頁面。</small><br><button class="vp-add" type="button" onclick="location.reload()">重新載入</button></div>';
    console.error('[vehicle-passport] failed to render', error);
  }

  cleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
    document.body.style.overflow = '';
    reader?.remove();
    reader = null;
    if (window.__vehiclePassportCleanup === cleanup) delete window.__vehiclePassportCleanup;
  };
  window.__vehiclePassportCleanup = cleanup;
}
