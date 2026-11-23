// Sessions: the recorded heart rate, one session at a time, with the game moments in it.
// Recording is off unless switched on; it all stays on this computer.

import { h, svg } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { sessions } from '../lib/state.js';

export const id = 'sessions';

export function render(s) {
  const ss = s.sessions;
  const on = !!s.settings.sessionsEnabled;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head row between', style: { alignItems: 'flex-end', flexWrap: 'wrap', gap: '16px' } },
      h('div', {}, h('h1', { class: 'h1' }, t('nav_sessions')), h('p', { class: 'sub' }, t('sess_sub'))),
      h('div', { class: 'row' }, h('span', {}, t('sessions_toggle')), toggle(on, v => sessions.save({ sessionsEnabled: v }), t('sessions_toggle')))),
    ss.list.length ? h('div', { class: 'sess-layout' }, list(s), detail(s)) : empty(on),
    settings(s, on),
    ss.share ? shareView(s) : null);
}

// ── Nothing recorded yet ──
function empty(on) {
  return h('div', { class: 'card empty' },
    h('p', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t(on ? 'sess_empty_title' : 'sess_off_title')),
    h('p', { class: 'sub', style: { maxWidth: '460px', margin: 0 } }, t(on ? 'sess_empty_text' : 'sess_off_text')),
    on ? null : h('button', { class: 'btn primary', onclick: () => sessions.save({ sessionsEnabled: true }) }, t('sessions_toggle')));
}

// ── The list ──
function list(s) {
  const ss = s.sessions;
  // The card takes the height of the session card next to it; the rows scroll inside
  return h('div', { class: 'card sess-list' }, h('div', { class: 'sess-list-scroll', role: 'list' },
    ss.list.slice(0, 50).map(x => h('button', {
      class: 'sess-row' + (x.startedAt === ss.selected ? ' on' : '') + (x.live ? ' live' : ''), role: 'listitem',
      'aria-current': x.startedAt === ss.selected ? 'true' : null,
      onclick: () => sessions.select(x.startedAt),
    },
      x.live ? h('span', { class: 'dot live' }) : x.game ? h('span', { class: 'sess-game ' + x.game }, x.game === 'wow' ? 'WoW' : 'LoL') : h('span', { class: 'sess-game' }, '♥'),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('p', { style: { margin: 0, fontWeight: 600 } }, x.live ? t('sessions_live') : when(x.startedAt, s.lang)),
        h('p', { class: 'small muted', style: { margin: '2px 0 0' } },
          duration(x.minutes) + ' · Ø ' + x.avg + (x.events ? ' · ' + x.events + ' ' + t(x.events === 1 ? 'sessions_moment' : 'sessions_moments') : ''))),
      h('span', { class: 'num sess-peak' }, '▲' + x.peak)))));
}

// ── One session ──
function detail(s) {
  const ss = s.sessions;
  const item = ss.list.find(x => x.startedAt === ss.selected);
  if (!item) return null;
  const d = ss.detail?.startedAt === item.startedAt ? ss.detail : null;
  const events = d?.events || [];
  return h('div', { class: 'card stack sess-detail' },
    h('div', { class: 'row between', style: { flexWrap: 'wrap', gap: '12px' } },
      h('div', {},
        h('p', { class: 'label' }, item.live ? t('sessions_live') : t('sess_session')),
        h('p', { class: 'h1', style: { fontSize: '22px', margin: '4px 0 0' } }, longDate(item.startedAt, item.endedAt, s.lang))),
      item.live ? null : h('button', { class: 'btn', onclick: () => sessions.openShare(item.startedAt) }, t('sess_image'))),
    h('div', { class: 'sess-stats' },
      stat(t('sess_duration'), duration(item.minutes)),
      stat(t('sess_avg'), item.avg + ' BPM'),
      stat(t('sess_peak'), item.peak + ' BPM', '#ffb3a0'),
      stat(t('sess_moments'), String(item.events || 0))),
    d ? curve(d) : h('div', { class: 'spark sess-wait' }, t(item.live ? 'sess_live_wait' : 'graph_waiting')),
    events.length ? h('div', { class: 'stack', style: { gap: '6px' } },
      h('p', { class: 'label' }, t('sess_moments')),
      events.map(e => h('div', { class: 'sess-moment' },
        h('span', { class: 'num muted' }, clock(e.t)),
        h('span', { class: 'mark ' + markClass(e.style) }),
        h('b', {}, e.title),
        e.detail ? h('span', { class: 'muted' }, e.detail) : null,
        e.bpm ? h('span', { class: 'num', style: { marginLeft: 'auto' } }, e.bpm + ' BPM') : null))) : null);
}

// ── Share view: the card as it will look, to save or to paste somewhere ──
function shareView(s) {
  const share = s.sessions.share;
  const item = s.sessions.list.find(x => x.startedAt === share.startedAt);
  const resultText = { save: t('sess_saved'), copy: t('sess_copied'), failed: t('sess_failed') }[share.result];
  return h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === e.currentTarget) sessions.closeShare(); } },
    h('div', { class: 'card modal stack', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('sess_share_title') },
      h('div', { class: 'row between' },
        h('div', {}, h('p', { class: 'label' }, t('sess_share_title')),
          item ? h('p', { class: 'small muted', style: { margin: '4px 0 0' } }, longDate(item.startedAt, item.endedAt, s.lang)) : null),
        h('button', { class: 'win-btn', 'aria-label': t('close'), onclick: () => sessions.closeShare() }, '×')),
      h('div', { class: 'share-frame' },
        share.state === 'ready' ? h('img', { src: share.url, alt: t('sess_share_alt') })
          : h('p', { class: 'small muted' }, share.state === 'error' ? t('sess_failed') : t('sessions_working'))),
      h('div', { class: 'row between', style: { flexWrap: 'wrap', gap: '10px' } },
        h('span', { class: 'small ' + (share.result === 'failed' ? 'bad-text' : 'ok-text'), role: 'status' }, resultText || ''),
        h('div', { class: 'row', style: { gap: '10px' } },
          h('button', { class: 'btn', disabled: share.state !== 'ready' || share.busy ? true : null, onclick: () => sessions.shareAction('copy') }, t('sess_copy')),
          h('button', { class: 'btn primary', disabled: share.state !== 'ready' || share.busy ? true : null, onclick: () => sessions.shareAction('save') }, t('sess_save'))))));
}

// Escape closes the share view
window.addEventListener('keydown', e => { if (e.key === 'Escape' && document.querySelector('.modal-backdrop')) sessions.closeShare(); });

function stat(label, value, color) {
  return h('div', {}, h('p', { class: 'label', style: { margin: 0 } }, label), h('p', { class: 'num', style: { margin: '4px 0 0', fontSize: '22px', fontWeight: 600, color } }, value));
}

const markClass = style => ({ boss: 'good', death: 'bad', close: 'warn', closest: 'warn' }[style] || '');

// The whole session as one line, at most ~600 points, with a gap where there was no signal
function curve(d) {
  const W = 640, H = 170;
  const values = d.bpm || [];
  if (values.filter(v => v != null).length < 2) return h('div', { class: 'spark sess-wait' }, t('graph_waiting'));
  const step = Math.max(1, Math.ceil(values.length / 600));
  const pts = [];
  for (let i = 0; i < values.length; i += step) {
    const slice = values.slice(i, i + step).filter(v => v != null);
    if (slice.length) pts.push({ i, v: slice.reduce((a, b) => a + b, 0) / slice.length });
  }
  const real = pts.map(p => p.v);
  const lo = Math.min(...real) - 8, hi = Math.max(...real) + 8;
  const n = Math.max(1, values.length - 1);
  const x = i => (i / n) * W;
  const y = v => H - ((v - lo) / (hi - lo)) * H;
  // The HypeRate app does not send every second, so short holes are bridged; only a real
  // stretch without signal (over GAP_S seconds) breaks the line
  const GAP_S = 15;
  const lines = [];
  let run = [];
  for (let k = 0; k < pts.length; k++) {
    // Neighbouring points are `step` seconds apart in a long session (one point per bucket);
    // only what is missing beyond that counts as a gap
    if (k && pts[k].i - pts[k - 1].i - step > GAP_S) { lines.push(run); run = []; }
    run.push(`${x(pts[k].i).toFixed(1)},${y(pts[k].v).toFixed(1)}`);
  }
  lines.push(run);
  const peakIdx = values.indexOf(Math.max(...values.filter(v => v != null)));
  return h('div', { class: 'stack', style: { gap: '6px' } },
    h('div', { class: 'sess-curve' },
      svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('sess_curve_label') },
        [34, 68, 102, 136].map(yy => svg('line', { x1: 0, y1: yy, x2: W, y2: yy, stroke: 'rgba(255,255,255,.06)', 'stroke-dasharray': '3 5' })),
        (d.events || []).map(e => svg('line', { x1: x(e.t), y1: 0, x2: x(e.t), y2: H, stroke: markColor(e.style), 'stroke-opacity': .55, 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' })),
        lines.map(l => l.length === 1
          ? svg('line', { x1: l[0].split(',')[0], y1: l[0].split(',')[1], x2: l[0].split(',')[0], y2: l[0].split(',')[1], stroke: '#7fb0ff', 'stroke-width': 3, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' })
          : svg('polyline', { points: l.join(' '), fill: 'none', stroke: 'url(#hr-line)', 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }))),
      // A round dot in HTML: inside the stretched SVG a circle would come out as an egg
      peakIdx >= 0 ? h('span', { class: 'sess-peak-dot', title: values[peakIdx] + ' BPM', style: { left: (x(peakIdx) / W * 100) + '%', top: (y(values[peakIdx]) / H * 100) + '%' } }) : null),
    h('div', { class: 'row between', style: { fontSize: '11px', color: 'var(--label)' } },
      h('span', {}, time(d.startedAt)), h('span', {}, time(d.endedAt))));
}

const markColor = style => ({ boss: '#34d399', death: '#f05252', close: '#f5a524', closest: '#f5a524' }[style] || '#7fb0ff');

// ── Settings ──
function settings(s, on) {
  const o = sessions.options();
  const slider = (key, label, min, max, unit) => h('div', { class: 'ctl' },
    h('span', { class: 'ctl-label' }, label),
    h('div', { class: 'ctl-input' },
      h('input', { type: 'range', min, max, value: o[key], style: { flex: 1 }, 'aria-label': label, disabled: on ? null : true,
        oninput: e => { e.target.nextSibling.textContent = unit(e.target.value); },
        onchange: e => sessions.save({ [key]: Number(e.target.value) }) }),
      h('span', { class: 'num range-value' }, unit(o[key]))));
  const min = v => t('sess_min', { n: v });
  const days = v => t('sess_days', { n: v });
  return h('div', { class: 'split' },
    h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('sess_settings')),
      slider('sessionsEndAfterMin', t('sessions_end'), 2, 30, min),
      slider('sessionsMinLengthMin', t('sessions_min'), 1, 15, min),
      slider('sessionsKeepDays', t('sessions_keep'), 7, 365, days)),
    h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('sess_privacy')),
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('sess_info')),
      h('button', { class: 'btn' + (s.sessions.confirmDelete ? ' danger' : ''), disabled: s.sessions.list.length ? null : true,
        onclick: () => sessions.deleteAll() }, t(s.sessions.confirmDelete ? 'sess_delete_confirm' : 'sess_delete'))));
}

// ── Formatting ──
const locale = lang => window.HR_LANGUAGES.localeFor(lang);
const time = ms => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function when(ms, lang) {
  const d = new Date(ms);
  const today = new Date(); const yesterday = new Date(Date.now() - 86400000);
  const hm = d.toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return t('sessions_today') + ', ' + hm;
  if (d.toDateString() === yesterday.toDateString()) return t('sess_yesterday') + ', ' + hm;
  return d.toLocaleDateString(locale(lang), { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + hm;
}

function longDate(from, to, lang) {
  const d = new Date(from);
  const date = d.toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' });
  const hm = ms => new Date(ms).toLocaleTimeString(locale(lang), { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${hm(from)}–${hm(to)}`;
}

function duration(minutes) {
  if (!minutes) return t('sess_under_min');
  if (minutes < 60) return t('sess_min', { n: minutes });
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

function clock(sec) {
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const two = n => String(n).padStart(2, '0');
  return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${mm}:${two(ss)}`;
}

function toggle(on, onChange, label) {
  return h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
}
