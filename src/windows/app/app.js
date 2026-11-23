// HypeRate Desktop v2 — main window: title bar, sidebar, and whichever page is open.

import { h, svg, icon, heart } from './lib/dom.js';
import { t } from './lib/i18n.js';
import * as store from './lib/state.js';
import * as live from './pages/live.js';
import * as source from './pages/source.js';
import { placeholder } from './pages/placeholder.js';

const api = window.electronAPI;

const NAV = [
  { group: 'nav_overview' },
  { id: 'live', icon: 'live', label: 'nav_live', page: live },
  { id: 'sessions', icon: 'sessions', label: 'nav_sessions', page: placeholder('sessions', 'nav_sessions') },
  { group: 'nav_setup' },
  { id: 'overlay', icon: 'overlay', label: 'nav_overlay', page: placeholder('overlay', 'nav_overlay') },
  { id: 'source', icon: 'source', label: 'nav_source', page: source },
  { id: 'games', icon: 'games', label: 'nav_games', page: placeholder('games', 'nav_games') },
  { id: 'integrations', icon: 'integrations', label: 'nav_integrations', page: placeholder('integrations', 'nav_integrations') },
  { id: 'settings', icon: 'settings', label: 'nav_settings', page: placeholder('settings', 'nav_settings') },
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
    heart({ size: 22 }),
    h('span', { class: 'brand' }, 'HypeRate Desktop'),
    h('span', { class: 'version' }, s.settings.version ? 'v' + s.settings.version : ''),
    h('div', { class: 'spacer' }),
    h('span', { class: 'pill ' + (conn === 'on' ? 'ok' : conn === 'none' ? 'off' : 'warn') },
      h('span', { class: 'dot ' + (conn === 'on' ? 'live' : conn === 'none' ? '' : 'warn') }),
      conn === 'on' && s.bpm != null ? h('span', { class: 'num' }, `${s.bpm} BPM`) : t('conn_' + conn)),
    h('button', { class: 'win-btn', 'aria-label': t('minimize'), onclick: () => api.minimizeSettings() }, icon('minimize', 16)),
    h('button', { class: 'win-btn close', 'aria-label': t('close'), onclick: () => api.closeSettings() }, icon('close', 16)));
}

function sidebar(s) {
  const conn = store.connection(s);
  return h('nav', { class: 'sidebar', 'aria-label': t('nav_label') },
    NAV.map(item => item.group
      ? h('p', { class: 'nav-group' }, t(item.group))
      : h('button', { class: 'nav', 'aria-current': item.id === current ? 'page' : null, onclick: () => go(item.id) },
          icon(item.icon), t(item.label))),
    h('div', { class: 'side-status' },
      h('div', { class: 'who' },
        h('span', { class: 'icon-tile', style: { width: '34px', height: '34px', borderRadius: '10px' } }, icon(s.source === 'cloud' ? 'cloud' : 'source', 16)),
        h('div', {},
          h('p', { class: 'name', style: { margin: 0 } }, s.ble.name || (s.cloud.status === 'connected' ? t('source_cloud') : t('no_source'))),
          h('p', { class: 'sub', style: { margin: '1px 0 0', color: conn === 'on' ? 'var(--ok-text)' : 'var(--dim)' } }, t('conn_' + conn)))),
      h('button', { class: 'btn primary', style: { width: '100%' }, onclick: () => api.launchOverlay(s.settings.config) }, t('overlay_show')),
      h('p', { class: 'small muted', style: { margin: 0, textAlign: 'center' } }, (s.settings.hotkey?.keys || ['Ctrl', 'Shift', 'H']).join(' + '))));
}

const root = document.getElementById('app');
let queued = false;

// While someone types in a field, the page is left alone: heart rate updates arrive every
// second and would otherwise rebuild the field under the cursor. Title bar and sidebar still update.
function typing() {
  const el = document.activeElement;
  return !!el && el.closest?.('.content') && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function render() {
  queued = false;
  const s = store.get();
  document.documentElement.lang = s.lang;
  const item = NAV.find(n => n.id === current) || NAV[1];
  const content = document.querySelector('.content');
  if (content && typing()) {
    document.querySelector('.titlebar').replaceWith(titlebar(s));
    document.querySelector('.sidebar').replaceWith(sidebar(s));
    return;
  }
  const scroll = content ? content.scrollTop : 0;
  root.replaceChildren(defs(), h('div', { class: 'app' },
    titlebar(s),
    h('div', { class: 'body' }, sidebar(s), h('main', { class: 'content' }, item.page.render(s, go)))));
  document.querySelector('.content').scrollTop = scroll;
}

function schedule() { if (!queued) { queued = true; requestAnimationFrame(render); } }
store.subscribe(schedule);
window.addEventListener('hr-rerender', schedule);
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
