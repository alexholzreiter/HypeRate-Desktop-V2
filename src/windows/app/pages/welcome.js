// First start: five steps from nothing to a heart rate in the overlay. Takes the whole window
// until it is finished or skipped; everything here can be changed later on the normal pages.
//
//   welcome → where the heart rate comes from → connect → pick a look → done

import { h, icon, heart } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { bluetooth, cloud, connection, overlayConfig, showOverlay, app, finishWelcome } from '../lib/state.js';
import { drawPreview } from '../lib/overlay-config.js';

const STEPS = ['welcome', 'source', 'connect', 'style', 'done'];
let step = 0;
let source = 'ble';
let style = null;            // null = keep what the config has
let autostart = true;
let analytics = false;   // asked, never assumed
let sessionId = '';
const rerender = () => window.dispatchEvent(new Event('hr-rerender'));
const goto = n => { step = Math.max(0, Math.min(STEPS.length - 1, n)); rerender(); };

// The four looks of the mockup, as changes to the overlay config
export const LOOKS = [
  { id: 'pill', name: 'welcome_look_pill', patch: { bgStyle: 'dark-pill', bgOpacity: 80, borderRadius: 50, showBorder: false, heartColor: '#3b7bff', glowColor: '#3b7bff', heartGlow: true } },
  { id: 'glass', name: 'welcome_look_glass', patch: { bgStyle: 'glass', bgOpacity: 30, borderRadius: 12, showBorder: true, heartColor: '#f43f5e', glowColor: '#f43f5e', heartGlow: true } },
  { id: 'clean', name: 'welcome_look_clean', patch: { bgStyle: 'transparent', showBorder: false, heartColor: '#38bdf8', glowColor: '#38bdf8', heartGlow: true, textGlow: true } },
  { id: 'neon', name: 'welcome_look_neon', patch: { bgStyle: 'dark-pill', bgOpacity: 60, borderRadius: 10, showBorder: true, heartColor: '#3b7bff', glowColor: '#3b7bff', heartGlow: true, textGlow: true } },
];

export function render(s) {
  const name = STEPS[step];
  const body = { welcome, source: pickSource, connect, style: pickStyle, done }[name](s);
  return h('div', { class: 'welcome' },
    h('header', { class: 'welcome-top' },
      heart({ size: 22 }), h('span', { class: 'brand' }, 'HypeRate Desktop'),
      h('span', { class: 'small muted', style: { marginLeft: 'auto' } }, t('welcome_step', { n: step + 1, of: STEPS.length, name: t('welcome_label_' + name) })),
      h('button', { class: 'win-btn close', 'aria-label': t('close'), onclick: () => window.electronAPI.closeSettings() }, icon('close', 16))),
    h('div', { class: 'welcome-dots' }, STEPS.map((_, i) => h('span', { class: i <= step ? 'on' : '' }))),
    h('main', { class: 'welcome-body' }, body),
    h('footer', { class: 'welcome-foot' },
      step > 0 ? h('button', { class: 'btn', onclick: () => goto(step - 1) }, t('welcome_back')) : h('button', { class: 'btn ghost', onclick: () => finish(s, false) }, t('welcome_skip')),
      h('button', { class: 'btn primary', onclick: () => next(s) }, nextLabel(s))));
}

function nextLabel(s) {
  if (step === 0) return t('welcome_start');
  if (step === 2 && connection(s) !== 'on') return t('welcome_later');
  if (step === STEPS.length - 1) return t('welcome_finish');
  return t('welcome_next');
}

function next(s) {
  if (step === STEPS.length - 1) { finish(s, true); return; }
  if (step === 2 && s.scan.active) bluetooth.stopScan();
  goto(step + 1);
  if (STEPS[step] === 'connect' && source === 'ble' && connection(s) !== 'on') bluetooth.scan();
}

function finish(s, launch) {
  if (style) {
    const look = LOOKS.find(l => l.id === style);
    const config = { ...overlayConfig(), ...look.patch };
    s.settings.config = config;
    window.electronAPI.updateConfig(config);
    window.electronAPI.saveSettings({ config });
  }
  if (launch) {
    app.setAutostart(autostart);
    app.setAnalytics(analytics);
    showOverlay();
  }
  finishWelcome();
}

// ── 1 ──
function welcome() {
  return h('div', { class: 'welcome-hero' },
    h('div', { class: 'heart-wrap' }, heart({ size: 84, className: 'beat', fill: 'url(#hr-gradient)' })),
    h('h1', { class: 'h1 welcome-title' }, t('welcome_title')),
    h('p', { class: 'sub', style: { maxWidth: '520px', textAlign: 'center' } }, t('welcome_text')));
}

// ── 2 ──
function pickSource() {
  const option = (id, ic, title, text) => h('button', { class: 'card choice' + (source === id ? ' on' : ''), role: 'radio', 'aria-checked': String(source === id), onclick: () => { source = id; rerender(); } },
    h('span', { class: 'icon-tile' }, icon(ic)),
    h('span', { class: 'choice-text' }, h('b', {}, t(title)), h('span', { class: 'small muted' }, t(text))),
    h('span', { class: 'radio' + (source === id ? ' on' : '') }));
  return h('div', { class: 'welcome-col' },
    head('welcome_source_title', 'welcome_source_sub'),
    h('div', { class: 'stack', role: 'radiogroup', style: { gap: '12px' } },
      option('ble', 'source', 'welcome_ble', 'welcome_ble_text'),
      option('cloud', 'cloud', 'welcome_cloud', 'welcome_cloud_text')));
}

// ── 3 ──
function connect(s) {
  return source === 'ble' ? connectBle(s) : connectCloud(s);
}

function connectBle(s) {
  const on = s.ble.state === 'connected';
  const devices = [...s.scan.devices.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  return h('div', { class: 'welcome-col' },
    head('welcome_ble_title', 'welcome_ble_sub'),
    on ? connected(s, s.ble.name || 'HR Monitor') : null,
    on ? null : h('div', { class: 'card stack', style: { gap: '10px' } },
      h('div', { class: 'row', style: { gap: '10px' } },
        s.scan.active ? h('span', { class: 'dot live' }) : null,
        h('span', { class: 'small muted' }, s.scan.active ? t('welcome_scanning') : s.scan.error ? t('welcome_scan_error') : t('welcome_scan_stopped')),
        s.scan.active ? null : h('button', { class: 'btn small', style: { marginLeft: 'auto' }, onclick: () => bluetooth.scan() }, t('welcome_scan_again'))),
      devices.map(d => h('div', { class: 'device' },
        h('span', { class: 'icon-tile', style: { width: '34px', height: '34px' } }, icon('source', 16)),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('b', {}, d.name)),
        h('button', { class: 'btn small primary', disabled: s.ble.state === 'connecting' ? true : null, onclick: () => bluetooth.connect(d.id, d.name) },
          s.ble.state === 'connecting' && s.ble.name === d.name ? t('welcome_connecting') : t('welcome_connect')))),
      s.ble.state === 'connect-error' ? h('p', { class: 'small bad-text', style: { margin: 0 } }, t('welcome_connect_error')) : null),
    on ? null : h('p', { class: 'small muted', style: { margin: 0 } }, t('welcome_ble_help')));
}

function connectCloud(s) {
  const on = s.cloud.status === 'connected';
  return h('div', { class: 'welcome-col' },
    head('welcome_cloud_title', 'welcome_cloud_sub'),
    on ? connected(s, t('source_cloud')) : h('div', { class: 'card stack', style: { gap: '10px' } },
      h('span', { class: 'ctl-label' }, t('welcome_session_id')),
      h('div', { class: 'row', style: { gap: '8px' } },
        h('input', { class: 'field', value: sessionId || s.settings.hrId || '', placeholder: 'abc123', maxlength: 40, spellcheck: 'false', 'aria-label': t('welcome_session_id'),
          oninput: e => { sessionId = e.target.value.trim(); },
          onkeydown: e => { if (e.key === 'Enter') cloud.connect(e.target.value); } }),
        h('button', { class: 'btn primary', disabled: s.cloud.status === 'connecting' ? true : null, onclick: e => cloud.connect(e.target.previousSibling.value) },
          s.cloud.status === 'connecting' ? t('welcome_connecting') : t('welcome_connect'))),
      s.cloud.status === 'error' || s.cloud.status === 'closed' ? h('p', { class: 'small bad-text', style: { margin: 0 } }, t('welcome_cloud_error')) : null),
    on ? null : h('p', { class: 'small muted', style: { margin: 0 } },
      t('welcome_no_app') + ' ', h('a', { 'data-external': 'https://www.hyperate.io/' }, t('welcome_get_app') + ' ↗')));
}

function connected(s, name) {
  return h('div', { class: 'device ok' },
    heart({ size: 36, className: s.bpm ? 'beat' : '', fill: 'url(#hr-gradient)' }),
    h('div', { style: { flex: 1 } }, h('b', {}, name), h('p', { class: 'small ok-text', style: { margin: '2px 0 0' } }, t('welcome_connected'))),
    h('span', { class: 'num', style: { fontSize: '28px', fontWeight: 700 } }, s.bpm ?? '--'));
}

// ── 4 ──
function pickStyle(s) {
  const base = overlayConfig();
  return h('div', { class: 'welcome-col wide' },
    head('welcome_style_title', 'welcome_style_sub'),
    h('div', { class: 'look-grid', role: 'radiogroup' }, LOOKS.map(look => {
      const on = (style || null) === look.id;
      return h('button', { class: 'card look' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on), onclick: () => { style = look.id; rerender(); } },
        h('div', { class: 'look-scene' }, widget({ ...base, ...look.patch, heartSize: 30, bpmSize: 26 }, s.bpm ?? 118)),
        h('div', { class: 'row between' }, h('b', {}, t(look.name)), h('span', { class: 'radio' + (on ? ' on' : '') })));
    })),
    style ? null : h('p', { class: 'small muted', style: { margin: 0 } }, t('welcome_style_keep')));
}

function widget(config, bpm) {
  const el = h('div', { class: 'preview-widget' },
    h('div', { class: 'ph' }),
    h('div', { class: 'pv-num' }, h('div', { class: 'pn num' }), h('div', { class: 'pl' }, 'BPM')));
  drawPreview(el, config, bpm);
  return el;
}

// ── 5 ──
function done(s) {
  const conn = connection(s);
  const look = LOOKS.find(l => l.id === style);
  const keys = s.settings.hotkey?.keys || ['Ctrl', 'Shift', 'H'];
  return h('div', { class: 'welcome-col' },
    head(conn === 'on' ? 'welcome_done_title' : 'welcome_done_title_nosrc', conn === 'on' ? 'welcome_done_sub' : 'welcome_done_sub_nosrc'),
    h('div', { class: 'card look-big' }, h('div', { class: 'look-scene big' }, widget({ ...overlayConfig(), ...(look?.patch || {}) }, s.bpm ?? 118))),
    h('div', { class: 'card stack', style: { gap: '14px' } },
      h('div', { class: 'row between' },
        h('div', {}, h('b', {}, t('welcome_hotkey')), h('p', { class: 'small muted', style: { margin: '2px 0 0' } }, t('welcome_hotkey_sub'))),
        h('div', { class: 'row', style: { gap: '6px' } }, keys.map((k, i) => [i ? h('span', { class: 'muted' }, '+') : null, h('span', { class: 'kbd' }, k)]))),
      h('hr', { class: 'divider' }),
      h('div', { class: 'row between' },
        h('div', {}, h('b', {}, t('set_autostart')), h('p', { class: 'small muted', style: { margin: '2px 0 0' } }, t('welcome_autostart_sub'))),
        h('button', { class: 'toggle' + (autostart ? ' on' : ''), role: 'switch', 'aria-checked': String(autostart), 'aria-label': t('set_autostart'), onclick: () => { autostart = !autostart; rerender(); } }, h('span'))),
      h('hr', { class: 'divider' }),
      h('div', { class: 'row between' },
        h('div', { style: { maxWidth: '440px' } }, h('b', {}, t('set_analytics')), h('p', { class: 'small muted', style: { margin: '2px 0 0' } }, t('welcome_analytics_sub'))),
        h('button', { class: 'toggle' + (analytics ? ' on' : ''), role: 'switch', 'aria-checked': String(analytics), 'aria-label': t('set_analytics'), onclick: () => { analytics = !analytics; rerender(); } }, h('span')))));
}

function head(title, sub) {
  return h('div', { class: 'stack', style: { gap: '6px' } }, h('h1', { class: 'h1' }, t(title)), h('p', { class: 'sub', style: { margin: 0 } }, t(sub)));
}
