// Settings: what belongs to the app itself rather than to the overlay or a source.
// Language, starting with the system, the hotkey, updates, news, help, and the way back
// to the previous window while the new one is in beta.

import { h } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { setLang, app } from '../lib/state.js';

export const id = 'settings';

const LANGS = [['en', 'English'], ['de', 'Deutsch']];
const FEEDBACK_URL = 'https://feedback.hyperate.io/form/iHnGf9vp';
const NEWS_URL = 'https://blog.hyperate.io/tags/news/';

export function render(s) {
  app.loadNews();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'h1' }, t('nav_settings')), h('p', { class: 'sub' }, t('set_sub')))),
    h('div', { class: 'split' },
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('set_general')),
        row(t('set_language'), h('div', { class: 'tabs', role: 'radiogroup', 'aria-label': t('set_language') },
          LANGS.map(([code, name]) => h('button', { class: 'tab' + (s.lang === code ? ' on' : ''), role: 'radio', 'aria-checked': String(s.lang === code), onclick: () => setLang(code) }, name)))),
        row(t('set_autostart'), s.autostart == null ? null : toggle(s.autostart, v => app.setAutostart(v), t('set_autostart'))),
        h('hr', { class: 'divider' }),
        row(t('set_hotkey'), h('div', { class: 'row', style: { gap: '6px' } },
          (s.settings.hotkey?.keys || ['Ctrl', 'Shift', 'H']).map((k, i) => [i ? h('span', { class: 'muted' }, '+') : null, h('span', { class: 'kbd' }, k)]))),
        s.settings.hotkey && s.settings.hotkey.registered === false ? h('p', { class: 'small warn-text', style: { margin: 0 } }, t('set_hotkey_taken')) : null),
      updates(s)),
    h('div', { class: 'split' },
      news(s),
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('set_help')),
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('set_feedback_text')),
        h('button', { class: 'btn', onclick: () => window.electronAPI.openExternal(FEEDBACK_URL) }, t('set_feedback') + ' ↗'),
        h('hr', { class: 'divider' }),
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('set_previous_text')),
        h('button', { class: 'btn', onclick: () => window.electronAPI.switchUi(false) }, t('set_previous')))));
}

function updates(s) {
  const u = s.update;
  const version = s.settings.version ? 'v' + s.settings.version : '';
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
  const lang = s.lang === 'de' ? 'de-DE' : 'en-GB';
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

function row(label, control) {
  return h('div', { class: 'row between', style: { gap: '16px', flexWrap: 'wrap' } }, h('span', {}, label), control);
}

function toggle(on, onChange, label) {
  return h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
}
