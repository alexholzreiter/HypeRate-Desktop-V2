// Heart rate source: a Bluetooth strap straight to the PC, or the HypeRate app via the cloud.

import { h, html, icon, svg } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { bluetooth, cloud, cloudQuiet } from '../lib/state.js';
import { signalBars, batteryIcon, barsFromRssi, receptionWord } from '../lib/vitals.js';

export const id = 'source';

// Which of the two is shown; starts with whatever is in use
let mode = null;
let sessionDraft = null;
let copied = false;

const LINKED = ['connected', 'signal-lost', 'no-contact'];
const TRYING = ['connecting', 'reconnecting'];

export function render(s) {
  if (!mode) mode = s.cloud.status === 'connected' || (s.settings.hrId && !s.ble.name) ? 'cloud' : 'ble';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'h1' }, t('nav_source')),
        h('p', { class: 'sub' }, t('source_sub')))),
    // Choices and what is below them share one two-column grid, so all edges line up
    h('div', { class: 'source-grid', role: 'radiogroup', 'aria-label': t('nav_source') },
      choice('ble', 'source', t('choice_ble'), t('choice_ble_sub')),
      choice('cloud', 'cloud', t('choice_cloud'), t('choice_cloud_sub'))),
    mode === 'ble' ? bluetoothPart(s) : cloudPart(s));
}

function choice(value, iconName, title, sub) {
  const on = mode === value;
  return h('button', {
    class: 'card choice' + (on ? ' on' : ''), role: 'radio', 'aria-checked': String(on),
    onclick: () => { mode = value; window.dispatchEvent(new Event('hr-rerender')); },
  },
    h('span', { class: 'icon-tile' }, icon(iconName)),
    h('span', { class: 'choice-text' }, h('b', {}, title), h('span', { class: 'small muted' }, sub)),
    h('span', { class: 'radio' + (on ? ' on' : '') }));
}

// ── Bluetooth ──
function bluetoothPart(s) {
  const ble = s.ble;
  const hasDevice = ble.name && (LINKED.includes(ble.state) || TRYING.includes(ble.state));
  return h('div', { class: 'source-grid' },
    h('div', { class: 'card stack' },
      hasDevice ? deviceRow(ble, s.bleVitals) : null,
      h('div', { class: 'row between' },
        h('p', { class: 'label' }, t('nearby')),
        h('button', { class: 'btn small', onclick: () => (s.scan.active ? bluetooth.stopScan() : bluetooth.scan()) },
          s.scan.active ? t('scan_stop') : t('scan_start'))),
      s.scan.error ? h('p', { class: 'small', style: { color: 'var(--bad-text)', margin: 0 } }, s.scan.error) : null,
      ble.state === 'ble-unavailable' ? h('p', { class: 'small', style: { color: 'var(--warn-text)', margin: 0 } }, t('ble_off')) : null,
      deviceList(s),
      h('hr', { class: 'divider' }),
      h('div', { class: 'row between' },
        h('div', {},
          h('p', { style: { margin: 0, fontWeight: 500 } }, t('auto_reconnect')),
          h('p', { class: 'small muted', style: { margin: '3px 0 0' } }, t('auto_reconnect_sub'))),
        toggle(s.settings.bleAutoReconnect !== false, on => bluetooth.setAutoReconnect(on), t('auto_reconnect'))),
      h('p', { class: 'small muted', style: { margin: 0 } }, html(t('supported_html')))),
    h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('conn_log')),
      s.bleLog.length
        ? h('div', { class: 'log' }, s.bleLog.slice().reverse().map(logLine))
        : h('p', { class: 'small muted', style: { margin: 0 } }, t('log_empty')),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: async () => { await bluetooth.copyDiagnostics(); copied = true; window.dispatchEvent(new Event('hr-rerender')); setTimeout(() => { copied = false; window.dispatchEvent(new Event('hr-rerender')); }, 2500); } }, t('copy_diag')),
        copied ? h('span', { class: 'small', style: { color: 'var(--ok-text)' } }, t('copied')) : null)));
}

function deviceRow(ble, v) {
  const tone = ble.state === 'connected' ? 'ok' : 'warn';
  const text = {
    connected: t('dev_connected'), 'signal-lost': t('dev_signal_lost'), 'no-contact': t('dev_no_contact'),
    connecting: t('dev_connecting'), reconnecting: ble.attempt ? t('dev_reconnecting_n', { n: ble.attempt }) : t('dev_reconnecting'),
  }[ble.state];
  return h('div', { class: 'device ' + tone },
    h('span', { class: 'dot ' + (ble.state === 'connected' ? 'live' : 'warn') }),
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('p', { style: { margin: 0, fontWeight: 600 } }, ble.name),
      h('p', { class: 'small', style: { margin: '2px 0 0', color: tone === 'ok' ? 'var(--ok-text)' : 'var(--warn-text)' } }, text),
      v && LINKED.includes(ble.state) ? vitalsRow(v) : null),
    h('button', { class: 'btn small', onclick: () => bluetooth.disconnect() }, t('disconnect')));
}

// Reception and battery of the connected device
function vitalsRow(v) {
  return h('div', { class: 'vitals-row small muted' },
    h('span', { class: 'vital' }, signalBars(v.bars), receptionWord(v.bars) + (v.rssi != null ? ` (${v.rssi} dBm)` : '')),
    h('span', { class: 'vital' }, batteryIcon(v.battery ?? 0), v.battery != null ? t('battery') + ' ' + v.battery + ' %' : t('battery_unknown')));
}

function deviceList(s) {
  const devices = [...s.scan.devices.values()].filter(d => d.name !== s.ble.name || !LINKED.includes(s.ble.state));
  if (!devices.length) {
    return s.scan.active
      ? h('div', { class: 'row small muted' }, h('span', { class: 'dot live', style: { background: 'var(--accent-text)' } }), t('searching'))
      : null;
  }
  return h('div', { class: 'stack', style: { gap: '8px' } }, devices.map(d =>
    h('div', { class: 'device' },
      signalBars(barsFromRssi(d.rssi)),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('p', { style: { margin: 0, fontWeight: 600 } }, d.name),
        d.rssi != null ? h('p', { class: 'small muted', style: { margin: '2px 0 0' } }, receptionWord(barsFromRssi(d.rssi))) : null),
      h('button', { class: 'btn small primary', onclick: () => bluetooth.connect(d.id, d.name) }, t('connect')))));
}

function logLine(line) {
  const time = line.slice(11, 19);
  const text = line.slice(25);
  const tone = /connected to|is back|first measurement/.test(text) ? 'ok' : /failed|no heart rate|without skin|unavailable|disconnected/.test(text) ? 'warn' : '';
  return h('div', { class: 'log-line' }, h('span', { class: 'dot ' + tone }), h('span', { class: 'num muted' }, time), h('span', {}, text));
}

function toggle(on, onChange, label) {
  return h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
}

// ── HypeRate app via the cloud ──
function cloudPart(s) {
  const status = s.cloud.status === 'connected' && cloudQuiet(s) ? 'quiet' : s.cloud.status;
  // trying again on its own counts as connected here: "Disconnect" stops it
  const connected = ['connected', 'quiet', 'reconnecting'].includes(status);
  const value = sessionDraft ?? s.settings.hrId ?? '';
  const statusText = {
    connected: t('cloud_connected', { id: s.cloud.sessionId || value }),
    connecting: t('cloud_connecting'),
    reconnecting: t('cloud_reconnecting', { n: s.cloud.attempt || 1 }),
    quiet: t('cloud_quiet'),
    error: s.cloud.message ? t('cloud_error', { reason: s.cloud.message }) : t('cloud_error_plain'),
    closed: t('cloud_closed'),
  }[status];
  return h('div', { class: 'source-grid' }, h('div', { class: 'card stack wide' },
    h('label', { class: 'label', for: 'sessionId' }, t('session_label')),
    h('div', { class: 'row' },
      h('input', {
        id: 'sessionId', class: 'field', value, placeholder: t('session_placeholder'), maxlength: 40, spellcheck: 'false', autocomplete: 'off',
        disabled: connected ? true : null,
        oninput: (e) => { sessionDraft = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') cloud.connect(e.target.value); },
      }),
      connected
        ? h('button', { class: 'btn', onclick: () => { sessionDraft = null; cloud.disconnect(); } }, t('disconnect'))
        : h('button', { class: 'btn primary', onclick: () => { cloud.connect(document.getElementById('sessionId').value); sessionDraft = null; } }, t('connect'))),
    statusText ? h('div', { class: 'row small' },
      h('span', { class: 'dot ' + (status === 'connected' ? 'live' : ['connecting', 'reconnecting', 'quiet'].includes(status) ? 'warn' : 'bad') }),
      h('span', { style: { color: status === 'connected' ? 'var(--ok-text)' : ['connecting', 'reconnecting', 'quiet'].includes(status) ? 'var(--warn-text)' : 'var(--bad-text)' } }, statusText)) : null,
    h('p', { class: 'small muted', style: { margin: 0 } }, html(t('session_hint_html')))));
}
