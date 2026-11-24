// Reception and battery of a Bluetooth device, drawn (no emoji): signal bars and a battery.
// Used for devices found while scanning, the connected device on the source page and next to
// the heart rate in the title bar.

import { svg, h } from './dom.js';
import { t } from './i18n.js';

// Bars 0–4 from a signal strength in dBm (devices found while scanning)
export function barsFromRssi(rssi) {
  return rssi == null ? 0 : rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : rssi >= -90 ? 1 : 0;
}

export function signalBars(level, { size = 14 } = {}) {
  const color = level >= 3 ? 'var(--ok)' : level === 2 ? 'var(--warn)' : 'var(--bad)';
  return svg('svg', { class: 'vital-bars', width: Math.round(size * 18 / 14), height: size, viewBox: '0 0 18 14', 'aria-hidden': 'true' },
    [0, 1, 2, 3].map(i => svg('rect', { x: i * 5, y: 9 - i * 3, width: 3, height: 5 + i * 3, rx: 1, fill: i < level ? color : 'rgba(150, 156, 200, .35)' })));
}

export function batteryIcon(percent, { size = 14 } = {}) {
  const p = Math.max(0, Math.min(100, percent ?? 0));
  const color = p <= 15 ? 'var(--bad)' : p <= 30 ? 'var(--warn)' : 'currentColor';
  return svg('svg', { class: 'vital-battery', width: Math.round(size * 24 / 14), height: size, viewBox: '0 0 24 14', 'aria-hidden': 'true' },
    svg('rect', { x: 1, y: 1.5, width: 19, height: 11, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, opacity: '.7' }),
    svg('rect', { x: 21, y: 5, width: 2, height: 4, rx: 1, fill: 'currentColor', opacity: '.7' }),
    svg('rect', { x: 3, y: 3.5, width: Math.max(1, 15 * p / 100), height: 7, rx: 1.5, fill: color }));
}

export const receptionWord = (bars) => t(bars >= 3 ? 'signal_strong' : bars === 2 ? 'signal_medium' : 'signal_weak');

// Compact, for the title bar: bars and battery with its percentage
export function vitalsInline(v) {
  if (!v) return null;
  const label = [t('reception') + ': ' + receptionWord(v.bars), v.battery != null ? t('battery') + ': ' + v.battery + ' %' : null].filter(Boolean).join(' · ');
  return h('span', { class: 'vitals', title: label, 'aria-label': label },
    signalBars(v.bars, { size: 12 }),
    v.battery != null ? [batteryIcon(v.battery, { size: 12 }), h('span', { class: 'num' }, v.battery + '%')] : null);
}
