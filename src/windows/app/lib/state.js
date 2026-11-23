// One place that listens to the main process and keeps what the pages show.
// Pages subscribe and re-render; nothing else talks to window.electronAPI for live data.

const api = window.electronAPI;
const HISTORY_MS = 10 * 60 * 1000;   // the Live graph shows the last ten minutes

const state = {
  settings: {},
  lang: 'en',
  bpm: null,            // latest heart rate, null while there is none
  bpmAt: 0,
  history: [],          // [{ t, bpm }] for the last ten minutes
  source: null,         // 'ble' | 'cloud' | null
  ble: { state: 'idle' },
  cloud: { status: 'idle' },
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function changed() { for (const fn of listeners) fn(state); }
export const get = () => state;

export function setLang(lang) {
  state.lang = lang;
  api.saveSettings({ lang });
  changed();
}

// ── What the pages derive from it ──

// 'on' | 'quiet' | 'lost' | 'none'
export function connection(s = state) {
  const ble = s.ble.state;
  if (ble === 'signal-lost' || ble === 'no-contact') return 'quiet';
  if (ble === 'connected' || s.cloud.status === 'connected') return 'on';
  if (ble === 'reconnecting' || ble === 'connecting' || ble === 'ble-unavailable') return 'lost';
  if (s.cloud.status === 'closed' || s.cloud.status === 'error') return 'lost';
  return 'none';
}

export function stats(s = state) {
  const values = s.history.map(p => p.bpm);
  if (!values.length) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

export function zones(s = state) {
  const list = s.settings.config?.zones;
  return Array.isArray(list) && list.length ? list : [
    { name: 'Low', min: 0, max: 99, color: '#22c55e' },
    { name: 'Medium', min: 100, max: 139, color: '#f59e0b' },
    { name: 'High', min: 140, max: 999, color: '#ef4444' },
  ];
}

export function zoneFor(bpm, s = state) {
  if (bpm == null) return null;
  return zones(s).find(z => bpm >= (z.min ?? 0) && bpm <= (z.max ?? 999)) || null;
}

// ── Wiring ──

function trim(now) {
  const from = now - HISTORY_MS;
  while (state.history.length && state.history[0].t < from) state.history.shift();
}

export async function start() {
  state.settings = await api.loadSettings();
  state.lang = state.settings.lang === 'de' ? 'de' : (state.settings.lang || (navigator.language || 'en').slice(0, 2));
  if (!['en', 'de'].includes(state.lang)) state.lang = 'en';

  api.onBpmUpdate(({ bpm, source }) => {
    const now = Date.now();
    if (bpm == null) { state.bpm = null; changed(); return; }
    state.bpm = bpm;
    state.bpmAt = now;
    state.source = source === 'ble' ? 'ble' : 'cloud';
    state.history.push({ t: now, bpm });
    trim(now);
    changed();
  });

  api.onBleStatus(({ state: bleState, ...extra }) => {
    state.ble = { state: bleState, ...extra };
    if (bleState === 'signal-lost' || bleState === 'no-contact') state.bpm = null;
    changed();
  });

  api.onWsStatus(({ status, sessionId, message }) => {
    state.cloud = { status, sessionId, message };
    changed();
  });

  // The app may already be connected (or reconnecting) when this window opens
  const ble = await api.bleGetState?.();
  if (ble?.state) state.ble = ble;
  changed();
}
