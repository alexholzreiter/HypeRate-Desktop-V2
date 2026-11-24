// Settings: what belongs to the app itself rather than to the overlay or a source.
// Language, starting with the system, the hotkey, updates, privacy, news and help.

import { h } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { setLang, app, addons } from '../lib/state.js';

export const id = 'settings';

export const FEEDBACK_URL = 'https://feedback.hyperate.io/form/iHnGf9vp';
const NEWS_URL = 'https://blog.hyperate.io/tags/news/';

export function render(s) {
  app.loadNews();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'h1' }, t('nav_settings')), h('p', { class: 'sub' }, t('set_sub')))),
    h('div', { class: 'split' },
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('set_general')),
        row(t('set_language'), h('select', { class: 'field select', style: { flex: '0 1 220px' }, 'aria-label': t('set_language'), onchange: e => setLang(e.target.value) },
          window.HR_LANGUAGES.LANGUAGES.map(l => h('option', { value: l.code, selected: s.lang === l.code ? true : null }, l.name)))),
        row(t('set_autostart'), s.autostart == null ? null : toggle(s.autostart, v => app.setAutostart(v), t('set_autostart'))),
        dockRow(s),
        h('hr', { class: 'divider' }),
        row(t('set_hotkey'), h('div', { class: 'row', style: { gap: '6px' } },
          (s.settings.hotkey?.keys || ['Ctrl', 'Shift', 'H']).map((k, i) => [i ? h('span', { class: 'muted' }, '+') : null, h('span', { class: 'kbd' }, k)]))),
        s.settings.hotkey && s.settings.hotkey.registered === false ? h('p', { class: 'small warn-text', style: { margin: 0 } }, t('set_hotkey_taken')) : null),
      updates(s)),
    h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('set_privacy')),
      row(t('set_analytics'), toggle(s.settings.analyticsEnabled === true, v => app.setAnalytics(v), t('set_analytics'))),
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('set_analytics_text')),
      h('hr', { class: 'divider' }),
      row(t('integ_addons_toggle'), toggle(!!s.addons.master, v => addons.setMaster(v), t('integ_addons_toggle'))),
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('set_addons_desc'))),
    h('div', { class: 'split' },
      news(s),
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('set_help')),
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('set_feedback_text')),
        h('button', { class: 'btn', onclick: () => window.electronAPI.openExternal(FEEDBACK_URL) }, t('set_feedback') + ' ↗'))));
}

function updates(s) {
  const u = s.update;
  const version = s.settings.version ? 'v' + s.settings.version : '';
  // The Steam build is kept up to date by Steam; no own check, no link elsewhere
  if (s.settings.distribution === 'steam') {
    return h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('set_updates')),
      h('p', { style: { margin: 0, fontWeight: 600 } }, 'HypeRate Desktop ' + version),
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('set_update_steam')));
  }
  const status = {
    checking: t('set_update_checking'),
    current: t('set_update_current'),
    available: t('set_update_available', { version: u.version || '' }),
    error: t('set_update_error'),
  }[u.state] || '';
  return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('set_updates')),
    h('div', { class: 'row', style: { gap: '14px' } },
      h('div', { style: { flex: 1 } },
        h('p', { style: { margin: 0, fontWeight: 600 } }, 'HypeRate Desktop ' + version),
        h('p', { class: 'small ' + (u.state === 'available' ? 'ok-text' : 'muted'), style: { margin: '2px 0 0' }, role: 'status' }, status))),
    u.state === 'available'
      ? h('button', { class: 'btn primary', onclick: () => window.electronAPI.openExternal(u.url) }, t('set_update_download') + ' ↗')
      : h('button', { class: 'btn', disabled: u.state === 'checking' ? true : null, onclick: () => app.checkUpdate() }, t('set_update_check')),
    /-beta\b/.test(s.settings.version || '') ? h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('set_beta_note')) : null);
}

function news(s) {
  const lang = window.HR_LANGUAGES.localeFor(s.lang);
  const items = Array.isArray(s.news) ? s.news : [];
  return h('div', { class: 'card stack' },
    h('div', { class: 'row between' }, h('p', { class: 'label' }, t('set_news')),
      h('a', { class: 'small', onclick: () => window.electronAPI.openExternal(NEWS_URL) }, t('set_news_all') + ' ↗')),
    s.news === 'loading' || s.news == null ? h('p', { class: 'small muted', style: { margin: 0 } }, t('set_news_loading')) : null,
    s.news === 'error' ? h('p', { class: 'small muted', style: { margin: 0 } }, t('set_news_error')) : null,
    Array.isArray(s.news) && !items.length ? h('p', { class: 'small muted', style: { margin: 0 } }, t('set_news_empty')) : null,
    items.map(n => h('button', { class: 'news-row', onclick: () => window.electronAPI.openExternal(n.url) },
      h('b', {}, n.title),
      isNaN(n.date) ? null : h('span', { class: 'small muted' }, n.date.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })))));
}

// macOS: Dock, Windows: taskbar. Linux desktops differ too much, so not there.
function dockRow(s) {
  const platform = window.electronAPI.platform;
  if (platform !== 'darwin' && platform !== 'win32') return null;
  const label = t(platform === 'darwin' ? 'set_dock' : 'set_taskbar');
  return h('div', { class: 'stack', style: { gap: '4px' } },
    row(label, toggle(s.settings.showInDock === true, v => app.setDockIcon(v), label)),
    h('p', { class: 'small muted', style: { margin: 0 } }, t(platform === 'darwin' ? 'set_dock_sub' : 'set_taskbar_sub')));
}

function row(label, control) {
  return h('div', { class: 'row between', style: { gap: '16px', flexWrap: 'wrap' } }, h('span', {}, label), control);
}

function toggle(on, onChange, label) {
  return h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
}
