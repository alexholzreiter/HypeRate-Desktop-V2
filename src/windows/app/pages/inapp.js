// An announcement or poll from HypeRate, shown over whatever page is open (as on the phone
// apps). The texts and the picture come from HypeRate's push service; the window only shows
// them as text, never as markup.

import { h } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { inApp } from '../lib/state.js';

export function render(s) {
  const { message: m, results, voting, voted } = s.inApp;
  if (!m || s.settings.onboarded !== true) return null;
  queueMicrotask(() => inApp.shown(m.id));
  const poll = m.type === 'poll';
  return h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === e.currentTarget) inApp.dismiss(); } },
    h('div', { class: 'card modal stack inapp', role: 'dialog', 'aria-modal': 'true', 'aria-label': m.title || 'HypeRate' },
      h('button', { class: 'win-btn inapp-close', 'aria-label': t('close'), onclick: () => inApp.dismiss() }, '×'),
      m.image ? h('img', { class: 'inapp-image', src: m.image, alt: '' }) : null,
      m.title ? h('h2', { class: 'h1 inapp-title' }, m.title) : null,
      m.body ? h('p', { class: 'inapp-body' }, m.body) : null,
      poll ? (results ? pollResults(results, voted) : h('div', { class: 'stack', style: { gap: '8px' } },
        m.options.map(o => h('button', { class: 'btn inapp-option', disabled: voting ? true : null, onclick: () => inApp.vote(o.id) },
          voting === o.id ? t('inapp_voting') : o.label)))) : null,
      h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
        poll ? h('button', { class: 'btn' + (results ? ' primary' : ''), onclick: () => inApp.dismiss() }, t(results ? 'inapp_done' : 'inapp_later'))
          : [h('button', { class: 'btn', onclick: () => inApp.dismiss() }, t(m.link && m.ctaText ? 'inapp_later' : 'inapp_ok')),
            m.link && m.ctaText ? h('button', { class: 'btn primary', onclick: () => inApp.open() }, m.ctaText + ' ↗') : null])));
}

function pollResults(r, voted) {
  if (r.failed) return h('p', { class: 'small bad-text', style: { margin: 0 } }, t('inapp_vote_failed'));
  return h('div', { class: 'stack', style: { gap: '8px' } },
    r.options.map(o => h('div', { class: 'inapp-result' + (o.id === voted ? ' mine' : '') },
      h('div', { class: 'inapp-bar', style: { width: o.percent + '%' } }),
      h('span', {}, o.label), h('b', { class: 'num' }, Math.round(o.percent) + '%'))),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('inapp_votes', { n: r.totalVotes })));
}

// Escape closes it like the × does
window.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.inapp')) inApp.dismiss(); });
