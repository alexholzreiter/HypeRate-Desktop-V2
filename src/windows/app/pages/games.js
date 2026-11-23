// Games: while a supported game runs, the overlay turns into that game's bar and shows
// moment cards (boss kill, close call, pentakill …). One page per game.

import { h, html } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { games, WOW_CARDS, LOL_CARDS } from '../lib/state.js';
import { open as openIntegration } from './integrations.js';

export const id = 'games';

let detail = null;   // null = overview, 'wow' or 'lol'
const rerender = () => window.dispatchEvent(new Event('hr-rerender'));

const GAMES = {
  wow: {
    name: 'World of Warcraft', mono: 'WoW', theme: 'wow',
    enabled: s => !!s.settings.wowEnabled, status: s => s.wow,
    cards: () => games.wowCards(), cardKeys: WOW_CARDS,
    cardLabel: k => t({ boss: 'wow_card_boss', close: 'wow_card_close', death: 'wow_card_death', intense: 'wow_card_intense', peak: 'wow_card_peak', closest: 'wow_card_closest', nemesis: 'wow_card_nemesis', streak: 'wow_card_streak' }[k]),
    tests: [['boss', 'test_boss'], ['close', 'test_close'], ['death', 'test_death'], ['insight', 'test_insight']],
    closeCall: s => s.settings.wowCloseCallPct || 10, scaleKey: 'wowScale',
    set: on => games.setWow(on), save: patch => games.saveWow(patch), closeKey: 'wowCloseCallPct', cardsKey: 'wowCards',
  },
  lol: {
    name: 'League of Legends', mono: 'LoL', theme: 'lol',
    enabled: s => !!s.settings.lolEnabled, status: s => s.lol,
    cards: () => games.lolCards(), cardKeys: LOL_CARDS,
    cardLabel: k => t({ deaths: 'lol_card_deaths', closeCalls: 'lol_card_close', multikills: 'lol_card_multi', kills: 'lol_card_kills', firstBlood: 'lol_card_firstblood', objectives: 'lol_card_objectives', steals: 'lol_card_steals', ace: 'lol_card_ace', matchResult: 'lol_card_result' }[k]),
    tests: [['penta', 'test_penta'], ['close', 'test_close'], ['death', 'test_death'], [undefined, 'test_all']],
    closeCall: s => s.settings.lolCloseCallPct || 10, scaleKey: 'lolScale',
    set: on => games.setLol(on), save: patch => games.saveLol(patch), closeKey: 'lolCloseCallPct', cardsKey: 'lolCards',
  },
};

export function render(s, go) {
  return detail ? gamePage(s, detail, go) : overview(s);
}

// ── Overview ──
function overview(s) {
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'h1' }, t('nav_games')), h('p', { class: 'sub' }, t('games_sub')))),
    h('div', { class: 'grid' },
      Object.entries(GAMES).map(([key, g]) => {
        const on = g.enabled(s);
        const st = statusOf(key, s);
        return h('button', { class: 'card game-card ' + key, onclick: () => { detail = key; rerender(); } },
          h('div', { class: 'game-banner' }, h('span', { class: 'game-mono' }, g.mono),
            h('span', { class: 'pill ' + (on ? st.tone : 'off') }, on ? st.text : t('off'))),
          h('div', { class: 'game-body' },
            h('p', { style: { margin: 0, fontWeight: 600, fontSize: '17px' } }, g.name),
            h('p', { class: 'small muted', style: { margin: 0 } }, t('moments_on_count', { n: Object.values(g.cards()).filter(Boolean).length, of: g.cardKeys.length })),
            h('span', { class: 'small', style: { color: 'var(--accent-text)', fontWeight: 600 } }, t('open') + ' →')));
      })),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('games_hyperaid_hint')));
}

function statusOf(key, s) {
  const st = (key === 'wow' ? s.wow : s.lol) || {};
  if (st.state === 'active') return { tone: 'ok', text: key === 'lol' && st.champion ? t('lol_in_game', { champion: st.champion }).replace('{champion}', st.champion) : t(key + '_active') };
  if (st.state === 'waiting') return { tone: 'warn', text: t(key + '_waiting') };
  if (st.state === 'no-folder' || st.state === 'error') return { tone: 'warn', text: t(key === 'wow' ? 'wow_no_folder' : 'lol_error') };
  return { tone: 'off', text: t('ready') };
}

// ── One game ──
function gamePage(s, key, go) {
  const g = GAMES[key];
  const on = g.enabled(s);
  const st = statusOf(key, s);
  const cardState = g.cards();
  const scale = s.settings.config?.[g.scaleKey] ?? 50;
  const wowStatus = s.wow || {};
  return h('div', { class: 'page' },
    h('div', { class: 'card game-hero ' + key },
      h('a', { class: 'small', onclick: () => { detail = null; rerender(); } }, '← ' + t('nav_games')),
      h('div', { class: 'row', style: { gap: '18px', flexWrap: 'wrap' } },
        h('span', { class: 'game-mono big' }, g.mono),
        h('div', { style: { flex: 1, minWidth: '220px' } },
          h('h1', { class: 'h1 game-title' }, g.name),
          h('div', { class: 'row small', style: { gap: '8px', marginTop: '6px' } },
            h('span', { class: 'dot ' + (on ? (st.tone === 'ok' ? 'live' : st.tone === 'warn' ? 'warn' : '') : '') }),
            on ? st.text : t('off'),
            key === 'wow' && on && wowStatus.lastWriteAt ? h('span', { class: 'muted' }, '· ' + lastWrite(wowStatus.lastWriteAt)) : null)),
        h('div', { class: 'row' }, h('span', {}, t('moments_toggle')), toggle(on, v => g.set(v), t('moments_toggle'))))),

    h('p', { class: 'sub', style: { margin: 0 } }, t(key === 'wow' ? 'wow_moments_sub' : 'lol_moments_sub')),

    key === 'wow' && on && wowStatus.advanced === false
      ? h('div', { class: 'note warn' }, html(t('wow_advanced_off_html'))) : null,

    h('div', { class: 'card stack' },
      h('div', { class: 'row between' }, h('p', { class: 'label' }, t('preview_real')), h('span', { class: 'small muted' }, t('preview_real_sub'))),
      h('div', { class: 'row', style: { flexWrap: 'wrap', gap: '8px' } },
        g.tests.map(([type, label]) => h('button', { class: 'btn small', disabled: on ? null : true, onclick: () => games.test(key, type) }, t(label)))),
      on ? null : h('p', { class: 'small muted', style: { margin: 0 } }, t('test_needs_on')),
      h('hr', { class: 'divider' }),
      h('div', { class: 'ctl' },
        h('span', { class: 'ctl-label' }, t('bar_size')),
        h('div', { class: 'ctl-input' },
          h('input', { type: 'range', min: 30, max: 80, step: 5, value: scale, style: { flex: 1 }, 'aria-label': t('bar_size'),
            oninput: e => { e.target.nextSibling.textContent = e.target.value + '%'; sizeNote.textContent = barSize(Number(e.target.value)); games.syncThemes({ [g.scaleKey]: Number(e.target.value) }); } }),
          h('span', { class: 'num range-value' }, scale + '%'))),
      sizeNote = h('p', { class: 'small muted', style: { margin: 0 } }, barSize(scale))),

    h('div', { class: 'split' },
      h('div', { class: 'card stack' },
        h('div', { class: 'row between' }, h('p', { class: 'label' }, t('moments_pick')),
          h('span', { class: 'small muted' }, t('moments_on_count', { n: Object.values(cardState).filter(Boolean).length, of: g.cardKeys.length }))),
        h('div', { class: 'moment-grid' }, g.cardKeys.map(k => h('button', {
          class: 'moment' + (cardState[k] ? ' on' : ''), 'aria-pressed': String(!!cardState[k]),
          onclick: () => g.save({ [g.cardsKey]: { ...cardState, [k]: !cardState[k] } }),
        }, h('span', { class: 'box' }), g.cardLabel(k))))),
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('fine_tuning')),
        h('div', { class: 'ctl' },
          h('span', { class: 'ctl-label' }, t('close_call_at')),
          h('div', { class: 'ctl-input' },
            h('input', { type: 'range', min: 5, max: 30, value: g.closeCall(s), style: { flex: 1 }, 'aria-label': t('close_call_at'),
              oninput: e => { e.target.nextSibling.textContent = e.target.value + '%'; },
              onchange: e => g.save({ [g.closeKey]: Number(e.target.value) }) }),
            h('span', { class: 'num range-value' }, g.closeCall(s) + '%'))),
        key === 'wow' ? wowFolder(s) : h('p', { class: 'small muted', style: { margin: 0 } }, html(t('lol_how_html'))),
        key === 'wow' ? h('a', { class: 'small', onclick: () => games.diagnostics() }, t('wow_diagnostics')) : null)),

    key === 'wow' ? h('button', { class: 'card hint-link', onclick: () => { openIntegration('hyperaid'); go('integrations'); } },
      h('span', { class: 'game-mono small-mono' }, 'HR'),
      h('span', { style: { flex: 1 } }, h('b', { style: { display: 'block' } }, t('hyperaid_q')), h('span', { class: 'small muted' }, t('hyperaid_where'))),
      h('span', { class: 'small', style: { color: 'var(--accent-text)', fontWeight: 600 } }, t('open') + ' →')) : null);
}

let sizeNote = null;
function barSize(pct) {
  const f = pct / 100;
  return t('bar_size_px', { idle: Math.round(500 * f), open: Math.round(1540 * f), h: Math.round(190 * f) });
}

function lastWrite(at) {
  const min = Math.floor((Date.now() - at) / 60000);
  const ago = min < 1 ? t('wow_just_now') : min < 60 ? t('wow_min_ago').replace('{n}', min) : t('wow_h_ago').replace('{n}', Math.floor(min / 60));
  return t('wow_last_write').replace('{ago}', ago);
}

function wowFolder(s) {
  return h('div', { class: 'stack', style: { gap: '8px' } },
    h('span', { class: 'ctl-label' }, t('wow_folder')),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('input', { class: 'field', value: s.settings.wowPath || '', spellcheck: 'false', 'aria-label': t('wow_folder'), onchange: e => games.saveWow({ wowPath: e.target.value.trim() }) }),
      h('button', { class: 'btn small', onclick: () => games.detectWow() }, t('auto_detect')),
      h('button', { class: 'btn small', onclick: () => games.pickWow() }, t('choose'))));
}

function toggle(on, onChange, label) {
  return h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
}
