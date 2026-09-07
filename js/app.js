/* App entry point — hash router, view dispatch, nav state sync. */
import { renderHome } from './views/home.js';
import {
  renderGarage, renderService, renderQinao, renderVideos, renderProfile,
} from './views/stubs.js';

const ROUTES = {
  '': renderHome,
  home: renderHome,
  garage: renderGarage,
  service: renderService,
  qinao: renderQinao,
  videos: renderVideos,
  profile: renderProfile,
};

const view = document.getElementById('view');

function getRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const name = raw.split('/')[0] || 'home';
  return ROUTES[name] ? name : 'home';
}

function syncNav(name) {
  document.querySelectorAll('[data-tab]').forEach((el) => {
    const active = el.dataset.tab === name || (name === 'home' && el.dataset.tab === 'home');
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.querySelectorAll('.app-header__nav a[data-nav]').forEach((el) => {
    const href = el.getAttribute('href') || '';
    const target = href.replace(/^#\//, '');
    if (target === name) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
}

async function dispatch() {
  const name = getRoute();
  syncNav(name);
  view.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  await ROUTES[name](view);
}

window.addEventListener('hashchange', dispatch);
window.addEventListener('DOMContentLoaded', () => {
  if (!window.location.hash) window.location.hash = '#/home';
  dispatch();
});

// Friendly link interception for in-page anchors that target views
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#/"]');
  if (!link) return;
  // Let the browser handle hash navigation; router listens on hashchange.
});