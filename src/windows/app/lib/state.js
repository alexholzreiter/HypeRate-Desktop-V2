// One place that listens to the main process and keeps what the pages show.
// Pages subscribe and re-render; nothing else talks to window.electronAPI for live data.

import { withDefaults } from './overlay-config.js';

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
  bleLog: [],           // recent lines of the Bluetooth connection log
  scan: { active: false, error: null, devices: new Map() },
  cloud: { status: 'idle' },
  wow: { state: null },
  lol: { state: null },
  overlayOpen: false,
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
    // A scan runs next to whatever connection there is, so it is tracked on its own
    if (bleState === 'scanning') { state.scan.active = true; state.scan.error = null; changed(); return; }
    if (bleState === 'scan-error') { state.scan.active = false; state.scan.error = extra.reason || 'error'; changed(); return; }
    if (bleState === 'connected' || bleState === 'connecting') { state.scan.active = false; state.scan.devices.clear(); }
    if (bleState === 'idle') state.scan.active = false;
    state.ble = { state: bleState, ...extra, name: extra.name || (bleState === 'idle' ? undefined : state.ble.name) };
    if (bleState === 'signal-lost' || bleState === 'no-contact') state.bpm = null;
    refreshLog();
    changed();
  });

  api.onBleDeviceFound(({ id, name, rssi }) => {
    state.scan.devices.set(id, { id, name: name || 'HR Monitor', rssi });
    changed();
  });

  api.onWsStatus(({ status, sessionId, message }) => {
    state.cloud = { status, sessionId, message };
    changed();
  });

  // The app may already be connected (or reconnecting) when this window opens
  const ble = await api.bleGetState?.();
  if (ble?.state) state.ble = ble;
  await refreshLog();

  api.onWowStatus(({ state: s, ...extra }) => { state.wow = { state: s, ...extra }; changed(); });
  api.onLolStatus(({ state: s, ...extra }) => { state.lol = { state: s, ...extra }; changed(); });
  api.onOverlayState(({ open }) => { state.overlayOpen = !!open; changed(); });

  // The cloud connection and the game readers are started by the window, as in the previous one
  if (state.settings.cloudAutoConnect && state.settings.hrId) cloud.connect(state.settings.hrId);
  if (state.settings.wowEnabled) api.wowEnable(games.wowOptions());
  if (state.settings.lolEnabled) api.lolEnable(games.lolOptions());
  changed();
}

async function refreshLog() {
  try { state.bleLog = (await api.bleGetLog?.(8)) || []; } catch { state.bleLog = []; }
  changed();
}

// ── Actions the pages call ──

export const bluetooth = {
  scan() { state.scan.devices.clear(); state.scan.active = true; api.bleScanStart(); changed(); },
  stopScan() { state.scan.active = false; api.bleScanStop(); changed(); },
  connect(id, name) { api.bleConnect(id, name); state.ble = { state: 'connecting', name }; changed(); },
  disconnect() { api.bleDisconnect(); state.ble = { state: 'disconnected' }; changed(); },
  setAutoReconnect(on) {
    state.settings.bleAutoReconnect = on;
    api.bleSetAutoReconnect(on);
    api.saveSettings({ bleAutoReconnect: on });
    changed();
  },
  copyDiagnostics: () => api.bleCopyDiagnostics(),
};

export const cloud = {
  connect(id) {
    const sessionId = String(id || '').trim();
    if (!sessionId) return;
    state.settings.hrId = sessionId;
    state.settings.cloudAutoConnect = true;
    api.saveSettings({ hrId: sessionId, cloudAutoConnect: true });
    state.cloud = { status: 'connecting', sessionId };
    api.wsConnect(sessionId);
    changed();
  },
  disconnect() {
    state.settings.cloudAutoConnect = false;
    api.saveSettings({ cloudAutoConnect: false });
    api.wsDisconnect();
    state.cloud = { status: 'idle' };
    changed();
  },
};

// ── Games: the overlay's game bars and the readers behind them ──

export const WOW_CARDS = ['boss', 'close', 'death', 'intense', 'peak', 'closest', 'nemesis', 'streak'];
export const LOL_CARDS = ['deaths', 'closeCalls', 'multikills', 'kills', 'firstBlood', 'objectives', 'steals', 'ace', 'matchResult'];
const LOL_OFF_BY_DEFAULT = ['kills'];

function cards(saved, keys, offByDefault = []) {
  return Object.fromEntries(keys.map(k => [k, saved?.[k] ?? !offByDefault.includes(k)]));
}

export const games = {
  wowCards: () => cards(state.settings.wowCards, WOW_CARDS),
  lolCards: () => cards(state.settings.lolCards, LOL_CARDS, LOL_OFF_BY_DEFAULT),
  wowOptions: () => ({ path: state.settings.wowPath || '', closeCallPct: state.settings.wowCloseCallPct || 10, cards: games.wowCards() }),
  lolOptions: () => ({ closeCallPct: state.settings.lolCloseCallPct || 10, cards: games.lolCards() }),

  async setWow(on) {
    if (on && !state.settings.wowPath) state.settings.wowPath = await api.wowDefaultPath();
    state.settings.wowEnabled = on;
    api.saveSettings({ wowEnabled: on, wowPath: state.settings.wowPath || '' });
    if (on) api.wowEnable(games.wowOptions()); else { api.wowDisable(); state.wow = { state: null }; }
    games.syncThemes();
  },
  saveWow(patch) {
    Object.assign(state.settings, patch);
    api.saveSettings({ wowPath: state.settings.wowPath || '', wowCloseCallPct: state.settings.wowCloseCallPct || 10, wowCards: games.wowCards() });
    if (state.settings.wowEnabled) api.wowSetOptions(games.wowOptions());
    changed();
  },
  async detectWow() { games.saveWow({ wowPath: await api.wowDefaultPath() }); },
  async pickWow() { const p = await api.wowPickFolder(state.settings.wowPath || ''); if (p) games.saveWow({ wowPath: p }); },

  setLol(on) {
    state.settings.lolEnabled = on;
    api.saveSettings({ lolEnabled: on });
    if (on) api.lolEnable(games.lolOptions()); else { api.lolDisable(); state.lol = { state: null }; }
    games.syncThemes();
  },
  saveLol(patch) {
    Object.assign(state.settings, patch);
    api.saveSettings({ lolCloseCallPct: state.settings.lolCloseCallPct || 10, lolCards: games.lolCards() });
    if (state.settings.lolEnabled) api.lolSetOptions(games.lolOptions());
    changed();
  },

  // The overlay picks its look from the config: which game bars are on, and how big they are
  syncThemes(patch = {}) {
    const config = { ...overlayConfig(), ...patch };
    config.gameThemes = [state.settings.wowEnabled && 'wow', state.settings.lolEnabled && 'lol'].filter(Boolean);
    config.theme = state.settings.wowEnabled ? 'wow' : 'default';   // older overlay builds read this
    config.wowScale = config.wowScale ?? 50;
    config.lolScale = config.lolScale ?? 50;
    state.settings.config = config;
    api.updateConfig(config);
    api.saveSettings({ config });
    changed();
  },

  // Shows a sample card in the real overlay; opens the overlay first if needed
  test(game, type) {
    const send = () => (game === 'wow' ? api.wowTest(type) : api.lolTest(type));
    if (state.overlayOpen) { send(); return; }
    showOverlay();
    setTimeout(send, 1200);
  },
  diagnostics: () => api.wowShowDiagnostics(),
};

// The overlay needs the whole config: a partial one (say, only the game settings on a fresh
// install) leaves it without colours and it fails. Always send it complete.
export const overlayConfig = () => withDefaults(state.settings.config);
export function showOverlay() { api.launchOverlay(overlayConfig()); }
