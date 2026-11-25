// The developer window: hidden, opened with the Konami code (↑ ↑ ↓ ↓ ← → ← → B A). A place for
// everything worth trying out without waiting for it: each celebration, the confetti, sample
// messages from HypeRate and the game moments in the overlay.

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import * as fx from '../lib/fx.js';
import { games, inApp } from '../lib/state.js';

let open = false;
const rerender = () => window.dispatchEvent(new Event('hr-rerender'));
export const close = () => { open = false; rerender(); };

const KONAMI = 'ArrowUp ArrowUp ArrowDown ArrowDown ArrowLeft ArrowRight ArrowLeft ArrowRight b a';
let keys = [];
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && open) { close(); return; }
  // letters typed into a field are text, not a code
  const el = e.target;
  if (el?.closest?.('input, textarea, select, [contenteditable]')) return;
  keys = [...keys, e.key.length === 1 ? e.key.toLowerCase() : e.key].slice(-10);
  if (keys.join(' ') === KONAMI) { keys = []; open = !open; rerender(); }
});

const btn = (label, onclick, on = false) => h('button', { class: 'btn small' + (on ? ' primary' : ''), 'aria-pressed': on ? 'true' : null, onclick }, label);
const section = (title, ...children) => h('div', { class: 'dev-section' }, h('p', { class: 'label' }, title), ...children);

// Samples of what HypeRate can send; shown here only, nothing is reported back
function sampleMessage(kind) {
  close();
  inApp.receive(kind === 'poll'
    ? { id: 'dev-preview-poll', preview: true, type: 'poll', title: t('dev_poll_title'), body: t('dev_poll_body'),
        options: [{ id: 'a', label: t('dev_poll_a') }, { id: 'b', label: t('dev_poll_b') }, { id: 'c', label: t('dev_poll_c') }] }
    : { id: 'dev-preview-news', preview: true, type: 'announcement', title: t('dev_news_title'), body: t('dev_news_body'),
        link: 'https://www.hyperate.io', ctaText: t('dev_news_cta') });
}

export function render(s) {
  if (!open) return null;
  const picked = fx.previewed();
  const today = fx.seasonOn();
  return h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === e.currentTarget) close(); } },
    h('div', { class: 'card modal stack devtools', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('dev_title') },
      h('button', { class: 'win-btn inapp-close', 'aria-label': t('close'), onclick: close }, icon('close', 16)),
      h('div', { class: 'row', style: { gap: '12px' } },
        h('span', { class: 'icon-tile' }, icon('code')),
        h('div', {},
          h('h2', { class: 'h1 inapp-title' }, t('dev_title')),
          h('p', { class: 'sub', style: { margin: '2px 0 0' } }, t('dev_sub')))),

      section(t('dev_seasons'),
        h('div', { class: 'dev-buttons' },
          btn(t('dev_auto'), () => fx.setPreview(null), !picked),
          fx.SEASONS.map(key => btn(t('fx_' + key), () => fx.setPreview(key), picked === key))),
        h('p', { class: 'small muted', style: { margin: 0 } },
          t('dev_today', { season: today ? t('fx_' + today) : t('dev_none') }),
          s.settings.seasonalEffects === false ? ' ' + t('dev_switched_off') : '')),

      section(t('dev_moments'),
        h('div', { class: 'dev-buttons' },
          btn(t('dev_record'), () => fx.burst(t('fx_record', { bpm: 187 }))),
          btn(t('dev_birthday'), () => fx.birthdayBurst()),
          btn(t('dev_finale'), () => { if (fx.previewed() !== 'newyear') fx.setPreview('newyear'); setTimeout(fx.finale, 50); }))),

      section(t('dev_messages'),
        h('div', { class: 'dev-buttons' },
          btn(t('dev_news'), () => sampleMessage('news')),
          btn(t('dev_poll'), () => sampleMessage('poll')))),

      section(t('dev_games'),
        h('div', { class: 'dev-buttons' },
          [['boss', 'test_boss'], ['close', 'test_close'], ['death', 'test_death'], ['insight', 'test_insight']]
            .map(([type, label]) => btn('WoW · ' + t(label), () => games.test('wow', type))),
          [['penta', 'test_penta'], ['close', 'test_close'], ['death', 'test_death'], [undefined, 'test_all']]
            .map(([type, label]) => btn('LoL · ' + t(label), () => games.test('lol', type))))),

      h('p', { class: 'dev-info', style: { margin: 0 } },
        ['v' + (s.settings.version || '?'),
          navigator.userAgent.match(/Electron\/[\d.]+/)?.[0],
          navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
          s.lang].filter(Boolean).join(' · '))));
}
