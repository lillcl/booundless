/* Home view — greeting, quick actions, reminders, fleet, trip banner, footnote. */
import { api } from '../api.js';
import { iconHTML, hydrateIcons } from '../icons.js';

const ACTION_TILES = [
  { key: 'cars', label: '看車', href: '#/garage', icon: 'car', tone: 'green' },
  { key: 'maintain', label: '養車', href: '#/garage', icon: 'wrench', tone: 'green' },
  { key: 'qinao', label: '琴澳去玩', href: '#/qinao', icon: 'route', tone: 'blue' },
  { key: 'workshops', label: '找車行', href: '#/garage', icon: 'shop', tone: 'orange' },
];

function escapeHTML(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderActions() {
  return `<nav class="action-grid" aria-label="快速功能">
    ${ACTION_TILES.map((t) => `
      <a class="action-card" href="${t.href}" data-action="${t.key}">
        <span class="action-card__icon action-card__icon--${t.tone}" aria-hidden="true">${iconHTML(t.icon)}</span>
        <span class="action-card__label">${escapeHTML(t.label)}</span>
      </a>`).join('')}
  </nav>`;
}

function renderReminders(reminders) {
  if (!reminders?.length) {
    return `<div class="reminder-list"><div class="reminder-row" style="cursor:default"><div class="reminder-row__body"><b>目前沒有待辦保養</b><small>所有車輛狀態正常</small></div></div></div>`;
  }
  return `<div class="reminder-list">
    ${reminders.map((r) => `
      <button class="reminder-row" type="button" data-reminder="${r.id}" aria-label="${escapeHTML(r.title)}">
        <span class="reminder-row__icon" aria-hidden="true">${iconHTML(r.icon || 'oil')}</span>
        <span class="reminder-row__body">
          <b>${escapeHTML(r.title)}</b>
          <small>${escapeHTML(r.due_in || '')}</small>
        </span>
        <span class="reminder-row__chev" aria-hidden="true">${iconHTML('chevron')}</span>
      </button>`).join('')}
  </div>`;
}

function renderCars(vehicles) {
  if (!vehicles?.length) {
    return `<div class="state">尚未登記車輛</div>`;
  }
  return `<div class="car-grid">
    ${vehicles.map((v) => `
      <a class="car-card" href="#/garage" data-vehicle="${v.id}">
        <div class="car-card__media">
          <img src="${escapeHTML(v.image || '/assets/scenic/hengqin-skyline.png')}" alt="${escapeHTML(v.model)}" loading="lazy">
        </div>
        <div class="car-card__body">
          <div class="car-card__title">${escapeHTML(v.model)}</div>
          <div class="car-card__meta">${escapeHTML(v.plate || '')}${v.plate ? ' · ' : ''}${escapeHTML(v.mileage_label || '')}</div>
        </div>
      </a>`).join('')}
  </div>`;
}

function renderTripBanner() {
  return `<a class="trip-banner" href="#/qinao" aria-label="琴澳同行 — AI 規劃琴澳自駕">
    <div class="trip-banner__copy">
      <small>琴澳同行</small>
      <b>AI 幫你規劃琴澳自駕</b>
      <span>路線 · 停車 · 充電 · 跨境提醒</span>
    </div>
    <div class="trip-banner__art">
      <img src="/assets/scenic/qinao-bridge-drive.png" alt="琴澳大橋實景" loading="lazy">
    </div>
  </a>`;
}

function renderFootnote() {
  return `<div class="footnote" role="note">
    <span class="footnote__icon" aria-hidden="true">${iconHTML('spark')}</span>
    <div class="footnote__body">
      <b>康程只提醒保養，不做維修診斷</b>
      <small>根據車型、里程及過往保養紀錄計算</small>
    </div>
  </div>`;
}

export async function renderHome(root) {
  root.innerHTML = `<div class="state">載入中…</div>`;
  hydrateIcons(root);

  let vehicles = [];
  let reminders = [];
  try {
    [vehicles, reminders] = await Promise.all([api.vehicles.list(), api.reminders.list()]);
  } catch (err) {
    root.innerHTML = `<div class="state state--error">無法載入資料：${escapeHTML(err.message)}</div>`;
    return;
  }

  const userName = 'Isaac';
  root.innerHTML = `
    <div class="home">
      <header>
        <h1 class="home__greeting">你好，${escapeHTML(userName)}</h1>
        <p class="home__greeting-sub">今天你的車狀整體正常</p>
      </header>

      ${renderActions()}

      <section class="home__section">
        <h2 class="section-title">最近保養提醒</h2>
        ${renderReminders(reminders)}
      </section>

      <section class="home__section">
        <h2 class="section-title">我的車</h2>
        ${renderCars(vehicles)}
      </section>

      <section class="home__section">
        ${renderTripBanner()}
      </section>

      <section class="home__section">
        ${renderFootnote()}
      </section>
    </div>`;

  hydrateIcons(root);
}