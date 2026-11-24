// Live: the heart rate right now, the last ten minutes, and where it comes from.

import { h, svg, icon, heart } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { connection, stats, recent, zones, zoneFor, showOverlay } from '../lib/state.js';

export const id = 'live';

export function render(s, go) {
  const conn = connection(s);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'h1' }, t('live_title')),
        h('p', { class: 'sub' }, subline(s, conn)))),
    conn === 'none' || conn === 'lost' || conn === 'dropped' ? emptyCard(s, conn, go) : hero(s, conn),
    conn === 'none' ? null : h('div', { class: 'grid' }, sourceCard(s, go), overlayCard(s, go)));
}

function subline(s, conn) {
  if (conn === 'on') return s.source === 'ble' ? t('live_sub_ble', { name: s.ble.name || 'HR Monitor' }) : t('live_sub_cloud');
  if (conn === 'quiet') return s.ble.state === 'no-contact' ? t('live_quiet_contact', { name: s.ble.name || 'HR Monitor' }) : t('live_quiet_signal', { name: s.ble.name || 'HR Monitor' });
  if (conn === 'lost') return t('live_sub_lost');
  if (conn === 'dropped') return t('live_sub_dropped');
  return t('live_sub_none');
}

// ── No heart rate source yet, or the connection is gone ──
function emptyCard(s, conn, go) {
  const lost = conn === 'lost' || conn === 'dropped';
  return h('div', { class: 'card empty' },
    h('div', { class: 'heart-wrap idle' }, heart({ size: 64, stroke: '#6e739c' })),
    h('div', {},
      h('p', { class: 'h1', style: { fontSize: '24px' } }, t(lost ? 'empty_lost_title' : 'empty_none_title')),
      h('p', { class: 'sub', style: { maxWidth: '440px', margin: '8px auto 0' } },
        conn === 'dropped' ? t('empty_dropped_text') : lost ? t('empty_lost_text', { name: s.ble.name || t('your_strap') }) : t('empty_none_text'))),
    h('div', { class: 'row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn primary', onclick: () => go('source') }, t(lost ? 'empty_lost_cta' : 'empty_none_cta'))));
}

// ── The big number, zone and graph ──
function hero(s, conn) {
  const bpm = conn === 'quiet' ? null : s.bpm;
  const zone = zoneFor(bpm, s);
  const st = stats(s);
  return h('div', { class: 'card hero' },
    h('div', { class: 'hero-now' },
      h('div', { class: 'row between' },
        h('p', { class: 'label' }, t('live_now')),
        zone ? h('span', { class: 'pill warn', style: { color: zone.color, boxShadow: `inset 0 0 0 1px ${zone.color}55`, background: `${zone.color}1f` } }, zone.name) : null),
      h('div', { class: 'row', style: { gap: '18px' } },
        h('div', { class: bpm ? 'heart-wrap' : 'heart-wrap idle' },
          heart({ size: 84, className: bpm ? 'beat' : '', fill: bpm ? 'url(#hr-gradient)' : '#3a3e5c' })),
        h('div', { class: 'row', style: { gap: '10px', alignItems: 'baseline' } },
          h('span', { class: 'num bpm-big' }, bpm ?? '--'),
          h('span', { class: 'muted', style: { fontSize: '16px', fontWeight: 600 } }, 'BPM'))),
      zoneBar(s, bpm)),
    h('div', { class: 'hero-graph' },
      h('div', { class: 'row between' },
        h('p', { class: 'label' }, t('live_last10')),
        st ? h('div', { class: 'row small', style: { gap: '18px' } },
          statItem(t('min'), st.min), statItem(t('avg'), st.avg), statItem(t('max'), st.max, '#ffb3a0')) : null),
      graph(s),
      axis(s)));
}

// The graph spans ten minutes once there are ten minutes of data; before that it starts at the
// first value, so the first minutes are not squeezed against the right edge.
function span(s) {
  const now = Date.now();
  const full = now - 10 * 60 * 1000;
  const first = recent(s)[0]?.t ?? now;
  return { from: Math.max(full, Math.min(first, now - 30 * 1000)), now, full: first <= full };
}

function axis(s) {
  const { from, full } = span(s);
  const since = new Date(from).toLocaleTimeString(window.HR_LANGUAGES.localeFor(s.lang), { hour: '2-digit', minute: '2-digit' });
  return h('div', { class: 'row between', style: { fontSize: '11px', color: 'var(--label)' } },
    full ? [h('span', {}, t('ago_10')), h('span', {}, t('ago_5'))] : h('span', {}, t('since', { time: since })),
    h('span', {}, t('now')));
}

function statItem(label, value, color) {
  return h('span', {}, h('span', { class: 'muted' }, label + ' '), h('b', { class: 'num', style: { fontWeight: 600, color } }, value));
}

function zoneBar(s, bpm) {
  const list = zones(s);
  const lo = list[0]?.min ?? 0;
  const hi = Math.min(220, list[list.length - 1]?.max ?? 200);
  const span = Math.max(1, hi - lo);
  const parts = list.map(z => h('div', { style: { flex: Math.max(1, Math.min(z.max ?? hi, hi) - (z.min ?? lo)), background: z.color } }));
  const pos = bpm == null ? null : Math.max(0, Math.min(100, ((bpm - lo) / span) * 100));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
    h('div', { class: 'zonebar' }, parts, pos == null ? null : h('div', { class: 'marker', style: { left: pos + '%' } })),
    h('div', { class: 'row between', style: { fontSize: '11px', color: 'var(--label)' } }, list.map(z => h('span', {}, z.name))));
}

function graph(s) {
  const W = 640, H = 170;
  const { from, now } = span(s);
  const pts = recent(s);
  if (pts.length < 2) {
    return h('div', { class: 'spark', style: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label)', fontSize: '13px' } }, t('graph_waiting'));
  }
  const values = pts.map(p => p.bpm);
  const lo = Math.min(...values) - 10, hi = Math.max(...values) + 10;
  const x = p => ((p.t - from) / (now - from)) * W;
  const y = p => H - ((p.bpm - lo) / (hi - lo)) * H;
  const line = pts.map(p => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return h('div', { class: 'sess-curve' },
    svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('graph_label') },
      [34, 68, 102, 136].map(yy => svg('line', { x1: 0, y1: yy, x2: W, y2: yy, stroke: 'rgba(255,255,255,.06)', 'stroke-dasharray': '3 5' })),
      svg('path', { d: `M${x(pts[0]).toFixed(1)},${H} L${line.replaceAll(' ', ' L')} L${x(last).toFixed(1)},${H} Z`, fill: 'url(#hr-area)' }),
      svg('polyline', { points: line, fill: 'none', stroke: 'url(#hr-line)', 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' })),
    // Round in HTML; a circle inside the stretched SVG would be drawn as an egg
    h('span', { class: 'live-dot', style: { left: (x(last) / W * 100) + '%', top: (y(last) / H * 100) + '%' } }));
}

// ── Where the heart rate comes from ──
function sourceCard(s, go) {
  const ble = s.source === 'ble' || ['connected', 'signal-lost', 'no-contact', 'reconnecting', 'connecting'].includes(s.ble.state);
  const statusText = {
    connected: t('src_connected'), 'signal-lost': t('src_quiet'), 'no-contact': t('src_no_contact'),
    reconnecting: t('src_reconnecting'), connecting: t('src_reconnecting'),
  }[s.ble.state];
  return h('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
    h('div', { class: 'row between' }, h('p', { class: 'label' }, t('source_label')), h('a', { onclick: () => go('source') }, t('manage'))),
    h('div', { class: 'row' },
      h('span', { class: 'icon-tile' }, icon(ble ? 'source' : 'cloud')),
      h('div', { style: { minWidth: 0 } },
        h('p', { style: { margin: 0, fontWeight: 600 } }, ble ? (s.ble.name || 'HR Monitor') : t('source_cloud')),
        h('p', { class: 'small muted', style: { margin: '2px 0 0' } }, ble ? (statusText || t('source_ble')) : (s.cloud.sessionId ? t('session_id', { id: s.cloud.sessionId }) : t('source_cloud_sub'))))));
}

function overlayCard(s, go) {
  return h('div', { class: 'card', style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
    h('div', { class: 'row between' }, h('p', { class: 'label' }, t('overlay_label')), h('a', { onclick: () => go('overlay') }, t('customize'))),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('overlay_hint')),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => showOverlay() }, t('overlay_show')),
      h('button', { class: 'btn small', onclick: () => window.electronAPI.closeOverlay() }, t('overlay_hide'))));
}
