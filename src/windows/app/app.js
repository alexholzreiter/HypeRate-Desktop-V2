// HypeRate Desktop v2 — main window: title bar, sidebar, and whichever page is open.

import { h, svg, icon, heart, logo, morph } from './lib/dom.js';
import { t } from './lib/i18n.js';
import * as store from './lib/state.js';
import * as live from './pages/live.js';
import * as source from './pages/source.js';
import * as overlay from './pages/overlay.js';
import * as gamesPage from './pages/games.js';
import * as integrations from './pages/integrations.js';
import * as sessionsPage from './pages/sessions.js';
import * as settingsPage from './pages/settings.js';
import * as welcome from './pages/welcome.js';
import * as inAppDialog from './pages/inapp.js';
import { setKnownHearts } from './lib/overlay-config.js';

const api = window.electronAPI;

const NAV = [
  { group: 'nav_overview' },
  { id: 'live', icon: 'live', label: 'nav_live', page: live },
  { id: 'sessions', icon: 'sessions', label: 'nav_sessions', page: sessionsPage },
  { group: 'nav_setup' },
  { id: 'overlay', icon: 'overlay', label: 'nav_overlay', page: overlay },
  { id: 'source', icon: 'source', label: 'nav_source', page: source },
  { id: 'games', icon: 'games', label: 'nav_games', page: gamesPage },
  { id: 'integrations', icon: 'integrations', label: 'nav_integrations', page: integrations },
  { id: 'settings', icon: 'settings', label: 'nav_settings', page: settingsPage },
];

let current = 'live';
try { current = sessionStorage.getItem('page') || 'live'; } catch {}

function go(id) {
  current = id;
  try { sessionStorage.setItem('page', id); } catch {}
  render();
  document.querySelector('.content')?.scrollTo(0, 0);
}

// Gradients the hearts and the graph refer to by id
function defs() {
  return svg('svg', { width: 0, height: 0, style: 'position:absolute', 'aria-hidden': 'true' },
    svg('defs', {},
      svg('linearGradient', { id: 'hr-gradient', x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: 0, 'stop-color': '#5b9bff' }), svg('stop', { offset: 1, 'stop-color': '#1d4ed8' })),
      svg('linearGradient', { id: 'hr-area', x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: 0, 'stop-color': '#3b82f6', 'stop-opacity': '.45' }), svg('stop', { offset: 1, 'stop-color': '#3b82f6', 'stop-opacity': 0 })),
      svg('linearGradient', { id: 'hr-line', x1: 0, y1: 0, x2: 1, y2: 0 },
        svg('stop', { offset: 0, 'stop-color': '#38bdf8' }), svg('stop', { offset: 1, 'stop-color': '#7fb0ff' }))));
}

function titlebar(s) {
  const conn = store.connection(s);
  return h('header', { class: 'titlebar' },
    logo({ size: 21 }),
    h('span', { class: 'brand', 'aria-label': 'HypeRate Desktop' }, 'HYPERATE', h('span', { class: 'brand-accent' }, '.DESKTOP')),
    h('span', { class: 'version' }, s.settings.version ? 'v' + s.settings.version : ''),
    h('div', { class: 'spacer' }),
    s.update.state === 'available' ? h('button', { class: 'pill ok update-pill', onclick: () => go('settings') }, '↑ ' + t('update_pill', { version: s.update.version })) : null,
    h('span', { class: 'pill ' + (conn === 'on' ? 'ok' : conn === 'none' ? 'off' : 'warn') },
      h('span', { class: 'dot ' + (conn === 'on' ? 'live' : conn === 'none' ? '' : 'warn') }),
      conn === 'on' && s.bpm != null ? h('span', { class: 'num' }, `${s.bpm} BPM`) : t('conn_' + conn)),
    h('button', { class: 'win-btn', 'aria-label': t('minimize'), onclick: () => api.minimizeSettings() }, icon('minimize', 16)),
    h('button', { class: 'win-btn close', 'aria-label': t('close'), onclick: () => api.closeSettings() }, icon('close', 16)));
}

function sidebar(s) {
  const conn = store.connection(s);
  const narrow = !!s.settings.sidebarCollapsed;
  const who = s.ble.name || (s.cloud.status === 'connected' ? t('source_cloud') : t('no_source'));
  const keys = (s.settings.hotkey?.keys || ['Ctrl', 'Shift', 'H']).join(' + ');
  return h('nav', { class: 'sidebar' + (narrow ? ' narrow' : ''), 'aria-label': t('nav_label') },
    h('button', { class: 'nav side-toggle', 'aria-expanded': String(!narrow), title: t(narrow ? 'side_expand' : 'side_collapse'), 'aria-label': t(narrow ? 'side_expand' : 'side_collapse'),
      onclick: () => store.setSidebarCollapsed(!narrow) }, icon(narrow ? 'expand' : 'collapse')),
    NAV.map(item => item.group
      ? h('p', { class: 'nav-group' }, h('span', { class: 'nav-text' }, t(item.group)))
      : h('button', { class: 'nav', 'aria-current': item.id === current ? 'page' : null, title: narrow ? t(item.label) : null, 'aria-label': narrow ? t(item.label) : null, onclick: () => go(item.id) },
          icon(item.icon), h('span', { class: 'nav-text' }, t(item.label)))),
    narrow
      ? h('div', { class: 'side-status' },
          h('span', { class: 'icon-tile side-who', title: who + ' · ' + t('conn_' + conn) },
            icon(s.source === 'cloud' ? 'cloud' : 'source', 16), h('span', { class: 'dot ' + (conn === 'on' ? 'live' : conn === 'none' ? '' : 'warn') })),
          h('button', { class: 'btn icon-only' + (s.overlayOpen ? '' : ' primary'), title: t(s.overlayOpen ? 'overlay_hide' : 'overlay_show') + ' (' + keys + ')', 'aria-label': t(s.overlayOpen ? 'overlay_hide' : 'overlay_show'), 'aria-pressed': String(s.overlayOpen), onclick: () => store.toggleOverlay() }, icon('overlay', 18)))
      : h('div', { class: 'side-status' },
          h('div', { class: 'who' },
            h('span', { class: 'icon-tile', style: { width: '34px', height: '34px', borderRadius: '10px' } }, icon(s.source === 'cloud' ? 'cloud' : 'source', 16)),
            h('div', {},
              h('p', { class: 'name', style: { margin: 0 } }, who),
              h('p', { class: 'sub', style: { margin: '1px 0 0', color: conn === 'on' ? 'var(--ok-text)' : 'var(--dim)' } }, t('conn_' + conn)))),
          // One button that shows or hides, like the hotkey under it
          h('button', { class: 'btn' + (s.overlayOpen ? '' : ' primary'), style: { width: '100%' }, 'aria-pressed': String(s.overlayOpen), onclick: () => store.toggleOverlay() }, t(s.overlayOpen ? 'overlay_hide' : 'overlay_show')),
          h('p', { class: 'small muted', style: { margin: 0, textAlign: 'center' } }, keys)));
}

const root = document.getElementById('app');
let queued = false;

// While someone types in a field, the page is left alone: heart rate updates arrive every
// second and would otherwise rebuild the field under the cursor. Title bar and sidebar still update.
function typing() {
  const el = document.activeElement;
  // Menus are not typed into, and patching keeps their choice, so they do not hold the page back
  return !!el && el.closest?.('.content') && ((el.tagName === 'INPUT' && !['range', 'color', 'checkbox'].includes(el.type)) || el.tagName === 'TEXTAREA');
}

function render() {
  queued = false;
  const s = store.get();
  document.documentElement.lang = s.lang;
  setKnownHearts(s.settings.customHearts);
  // First start: the wizard takes the whole window until it is finished or skipped
  if (s.settings.onboarded !== true) {
    const el = document.activeElement;
    if (el?.closest?.('.welcome') && el.tagName === 'INPUT') return;
    update(defs(), welcome.render(s));
    return;
  }
  const item = NAV.find(n => n.id === current) || NAV[1];
  const content = document.querySelector('.content');
  if (content && typing()) {
    morph(document.querySelector('.titlebar'), titlebar(s));
    morph(document.querySelector('.sidebar'), sidebar(s));
    return;
  }
  update(defs(), h('div', { class: 'app' },
    titlebar(s),
    h('div', { class: 'body' }, sidebar(s), h('main', { class: 'content' }, item.page.render(s, go))),
    inAppDialog.render(s)));
}

// The screen is patched, not rebuilt: see morph() in lib/dom.js
function update(...nodes) {
  const live = [...root.childNodes];
  nodes.forEach((node, i) => { if (live[i]) morph(live[i], node); else root.appendChild(node); });
  for (let i = nodes.length; i < live.length; i++) live[i].remove();
}

function schedule() { if (!queued) { queued = true; requestAnimationFrame(render); } }
store.subscribe(schedule);
window.addEventListener('hr-rerender', schedule);
// The preview measures fonts; once one has loaded, measure again
document.fonts.addEventListener('loadingdone', schedule);
// Leaving a field lets the page catch up with what changed meanwhile
document.addEventListener('focusout', () => setTimeout(schedule, 0));

// Links to the web open in the browser. Inline handlers are blocked by this window's CSP,
// so translated texts mark them with data-external instead.
document.addEventListener('click', (e) => {
  const link = e.target.closest?.('a[data-external]');
  if (!link) return;
  e.preventDefault();
  api.openExternal(link.dataset.external);
});

store.start().then(render);
