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
  discord: { state: null },
  mqtt: { state: null },
  mqttPassword: 'none',  // 'ok' | 'lost' | 'none': is a broker password stored and readable
  hyperaid: { state: 'off' },
  sessions: { list: [], selected: null, detail: null, share: null, confirmDelete: false },
  autostart: null,      // null until asked
  update: { state: 'idle' },   // 'idle' | 'checking' | 'current' | 'available' | 'error'
  news: null,           // null = not loaded, [] = none, or [{ title, url, date }]
  inApp: { message: null, results: null, voting: false },   // announcement or poll from HypeRate
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
  // The cloud connection is not retried on its own, so a drop is "dropped", not "reconnecting"
  if (s.cloud.status === 'closed' || s.cloud.status === 'error') return 'dropped';
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
  // The saved choice, or the system language on a first start
  state.lang = window.HR_LANGUAGES.resolve(state.settings.lang, navigator.language);

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
    // Disconnecting on purpose also ends in "closed"; that is off, not a problem
    if ((status === 'closed' || status === 'error') && !state.settings.cloudAutoConnect) status = 'idle';
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
  // The overlay may already be up when this window opens
  api.overlayIsOpen?.().then(open => { state.overlayOpen = !!open; changed(); }).catch(() => {});
  api.onDiscordStatus(({ state: s, reason }) => { if (state.settings.discordEnabled) state.discord = { state: s, reason }; changed(); });
  api.onMqttStatus(({ state: s, ...extra }) => { if (state.settings.mqttEnabled) state.mqtt = { state: s, ...extra }; changed(); });
  api.onMqttPasswordLost(() => { state.mqttPassword = 'lost'; changed(); });
  api.onHyperaidStatus((status) => { state.hyperaid = { ...state.hyperaid, ...status }; changed(); });
  api.onInAppMessage?.(m => inApp.receive(m));
  api.inAppGet?.().then(m => inApp.receive(m)).catch(() => {});
  api.onSessionsChanged(() => sessions.refresh());
  sessions.refresh();
  // The main process keeps checking while this window is closed and tells it here
  api.onUpdateAvailable?.(({ version, url }) => { state.update = { state: 'available', version, url }; changed(); });
  app.checkUpdate();
  api.getAutostart?.().then(on => { state.autostart = !!on; changed(); }).catch(() => {});

  // The cloud connection, the game readers, Discord and MQTT are started by the window, as in
  // the previous one. HypeRaid and VRChat are run by the main process from the saved settings.
  if (state.settings.cloudAutoConnect && state.settings.hrId) cloud.connect(state.settings.hrId);
  if (state.settings.wowEnabled) api.wowEnable(games.wowOptions());
  if (state.settings.lolEnabled) api.lolEnable(games.lolOptions());
  if (state.settings.discordEnabled) api.discordEnable();
  state.mqttPassword = (await api.mqttHasPassword?.()) || 'none';
  if (state.settings.mqttEnabled) api.mqttEnable(integrations.mqttOptions());
  try { state.hyperaid = await api.hyperaidStatus(); } catch {}
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

// ── Integrations: other apps that get the heart rate ──

const OSC_KEYS = ['oscEnabled', 'oscHost', 'oscPort', 'oscChatbox', 'oscChatboxFormat',
  'oscNormalizedEnabled', 'oscNormalizedParam', 'oscMinBpm', 'oscMaxBpm',
  'oscRawEnabled', 'oscRawParam', 'oscRawType', 'oscBoolEnabled', 'oscBoolParam', 'oscBoolValue', 'oscLegacyEnabled'];
const OSC_DEFAULTS = { oscHost: '127.0.0.1', oscPort: 9000, oscChatboxFormat: '♥ {bpm} BPM', oscRawParam: 'HR', oscRawType: 'i',
  oscNormalizedParam: 'VRCOSC/Heartrate/Normalised', oscMinBpm: 0, oscMaxBpm: 240, oscBoolParam: 'HRActive', oscBoolValue: true };

let oscRevision = 0;

export const integrations = {
  // Discord
  setDiscord(on) {
    state.settings.discordEnabled = on;
    api.saveSettings({ discordEnabled: on });
    if (on) api.discordEnable();
    else { api.discordDisable(); state.discord = { state: null }; }   // disconnecting reports nothing
    changed();
  },

  // VRChat OSC: the main process checks the whole set and keeps the old one when it is invalid
  osc: () => Object.fromEntries(OSC_KEYS.map(k => [k, state.settings[k] ?? OSC_DEFAULTS[k] ?? false])),
  oscSave: { state: null },
  async saveOsc(patch) {
    Object.assign(state.settings, patch);
    const revision = ++oscRevision;
    integrations.oscSave = { state: 'saving' };
    changed();
    let result;
    try { result = await api.saveOscSettings(integrations.osc()); } catch (e) { result = { ok: false, error: e.message }; }
    if (revision !== oscRevision) return;
    integrations.oscSave = result.ok ? { state: 'saved' } : { state: 'error', error: result.error };
    changed();
  },
  testOsc: () => api.testOsc(integrations.osc()),

  // Home Assistant over MQTT. The password never comes back from the main process; leaving the
  // field alone keeps the stored one.
  mqttOptions(password) {
    const s = state.settings;
    return {
      host: s.mqttHost || '', port: Number(s.mqttPort) || 1883, username: s.mqttUser || '',
      password: password || undefined, tls: !!s.mqttTls, baseTopic: s.mqttBaseTopic || 'hyperate',
      discovery: s.mqttDiscovery !== false, events: s.mqttEvents !== false,
    };
  },
  saveMqtt(patch, password) {
    Object.assign(state.settings, patch);
    const s = state.settings;
    api.saveSettings({
      mqttEnabled: !!s.mqttEnabled, mqttHost: s.mqttHost || '', mqttPort: Number(s.mqttPort) || 1883,
      mqttUser: s.mqttUser || '', mqttTls: !!s.mqttTls, mqttBaseTopic: s.mqttBaseTopic || 'hyperate',
      mqttDiscovery: s.mqttDiscovery !== false, mqttEvents: s.mqttEvents !== false,
    });
    if (password) state.mqttPassword = 'ok';
    if (s.mqttEnabled) api.mqttSetOptions(integrations.mqttOptions(password));
    changed();
  },
  setMqtt(on) {
    state.settings.mqttEnabled = on;
    integrations.saveMqtt({});
    if (on) api.mqttEnable(integrations.mqttOptions());
    else { api.mqttDisable(); state.mqtt = { state: null }; }
    changed();
  },
  testMqtt: () => api.mqttTest(),

  // HypeRaid: the WoW addon that shows the heart rate in the game
  async configureHyperaid(patch) {
    Object.assign(state.settings, patch);
    if (state.settings.hyperaidEnabled && !state.settings.hyperaidFolder) {
      state.settings.hyperaidFolder = state.settings.wowPath || await api.wowDefaultPath();
    }
    state.hyperaid = { ...state.hyperaid, ...await api.hyperaidConfigure({ enabled: !!state.settings.hyperaidEnabled, folder: state.settings.hyperaidFolder || '' }) };
    changed();
  },
  async pickHyperaidFolder() {
    const p = await api.wowPickFolder(state.settings.hyperaidFolder || state.settings.wowPath || '');
    if (p) await integrations.configureHyperaid({ hyperaidFolder: p });
  },
  async installHyperaid() {
    state.hyperaid = { ...state.hyperaid, busy: true };
    changed();
    try { state.hyperaid = { ...state.hyperaid, ...await api.hyperaidInstall(), justInstalled: true }; }
    finally { state.hyperaid.busy = false; changed(); }
  },
};

// ── Sessions: recorded heart rate with the game moments in it ──

export const sessions = {
  async refresh() {
    const ss = state.sessions;
    try { ss.list = (await api.sessionsList()) || []; } catch { ss.list = []; }
    if (!ss.list.some(x => x.startedAt === ss.selected)) ss.selected = ss.list[0]?.startedAt ?? null;
    await sessions.loadDetail();
  },
  async select(startedAt) {
    state.sessions.selected = startedAt;
    state.sessions.card = null;
    changed();
    await sessions.loadDetail();
  },
  async loadDetail() {
    const ss = state.sessions;
    const wanted = ss.selected;
    let detail = null;
    if (wanted != null) { try { detail = await api.sessionsRead(wanted); } catch {} }
    if (ss.selected !== wanted) return;    // another one was picked meanwhile
    ss.detail = detail;
    changed();
  },
  options: () => ({
    sessionsEnabled: !!state.settings.sessionsEnabled,
    sessionsEndAfterMin: Number(state.settings.sessionsEndAfterMin) || 5,
    sessionsMinLengthMin: Number(state.settings.sessionsMinLengthMin) || 3,
    sessionsKeepDays: Number(state.settings.sessionsKeepDays) || 90,
  }),
  save(patch) {
    Object.assign(state.settings, patch);
    api.sessionsSetOptions(sessions.options());
    changed();
  },
  // Two steps instead of a system dialog: the first click asks, the second deletes
  async deleteAll() {
    if (!state.sessions.confirmDelete) {
      state.sessions.confirmDelete = true;
      changed();
      setTimeout(() => { state.sessions.confirmDelete = false; changed(); }, 5000);
      return;
    }
    state.sessions.confirmDelete = false;
    await api.sessionsDelete();
    await sessions.refresh();
  },
  // The share view: the card is rendered once, shown, then saved or copied
  async openShare(startedAt) {
    state.sessions.share = { startedAt, state: 'loading' };
    changed();
    const url = await api.sessionsCardPreview(startedAt).catch(() => null);
    if (state.sessions.share?.startedAt !== startedAt) return;   // closed meanwhile
    state.sessions.share = url ? { startedAt, state: 'ready', url } : { startedAt, state: 'error' };
    changed();
  },
  closeShare() { state.sessions.share = null; changed(); },
  async shareAction(kind) {
    const share = state.sessions.share;
    if (!share || share.state !== 'ready') return;
    share.busy = kind; share.result = null; changed();
    const ok = kind === 'save' ? !!(await api.sessionsCardSave(share.startedAt).catch(() => null))
      : await api.sessionsCardCopy(share.startedAt).catch(() => false);
    if (state.sessions.share !== share) return;
    share.busy = null; share.result = ok ? kind : 'failed'; changed();
  },
};

// ── The app itself: start with the system, updates, news ──

export const app = {
  setAutostart(on) { state.autostart = on; api.setAutostart(on); changed(); },
  // Show the app in the Dock (macOS) or the taskbar (Windows) besides the menu bar / tray
  setDockIcon(on) { state.settings.showInDock = !!on; api.dockSet(!!on); changed(); },
  // Anonymous usage count, off until the user agrees
  setAnalytics(on) { state.settings.analyticsEnabled = !!on; api.analyticsSet(!!on); changed(); },
  async checkUpdate() {
    if (state.update.state === 'available') return;
    state.update = { state: 'checking' };
    changed();
    try {
      const r = await api.checkUpdate();
      state.update = r?.hasUpdate ? { state: 'available', version: r.latestVersion, url: r.downloadUrl }
        : r?.error ? { state: 'error' } : { state: 'current', checkedAt: Date.now() };
    } catch { state.update = { state: 'error' }; }
    changed();
  },
  // The blog's Atom feed; posts tagged "news" first, otherwise the newest posts
  async loadNews() {
    if (state.news) return;
    state.news = 'loading';
    try {
      const xml = await api.fetchNews();
      if (!xml) throw new Error('no data');
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      const all = [...doc.querySelectorAll('entry')];
      const tagged = all.filter(e => [...e.querySelectorAll('category')].some(c => (c.getAttribute('term') || '').toLowerCase().includes('news')));
      state.news = (tagged.length ? tagged : all).slice(0, 3).map(e => ({
        title: (e.querySelector('title')?.textContent || '').trim(),
        url: e.querySelector('link')?.getAttribute('href') || (e.querySelector('id')?.textContent || '').trim(),
        date: new Date(e.querySelector('updated')?.textContent || ''),
      })).filter(n => /^https:\/\//.test(n.url));
    } catch { state.news = 'error'; }
    changed();
  },
};

// The sidebar can shrink to its icons; remembered across starts
export function setSidebarCollapsed(on) {
  state.settings.sidebarCollapsed = on;
  api.saveSettings({ sidebarCollapsed: on });
  changed();
}

// ── In-app messages from HypeRate (see src/in-app.js) ──
const shownInApp = new Set();   // impression reported in this run
export const inApp = {
  receive(message) {
    const cur = state.inApp;
    if (cur.message?.id === message?.id && cur.results) return;   // keep the results of a vote on screen
    state.inApp = { message: message || null, results: null, voting: false };
    changed();
  },
  // Called when the dialog is on screen; tells the server once per run
  shown(id) {
    if (shownInApp.has(id)) return;
    shownInApp.add(id);
    api.inAppEvent(id, 'impression');
  },
  dismiss() {
    const m = state.inApp.message;
    if (m && !state.inApp.results) api.inAppEvent(m.id, 'dismiss');
    state.inApp = { message: null, results: null, voting: false };
    changed();
  },
  open() {
    const m = state.inApp.message;
    if (!m) return;
    api.inAppEvent(m.id, 'click');
    if (m.link) api.openExternal(m.link);
    state.inApp = { message: null, results: null, voting: false };
    changed();
  },
  async vote(optionId) {
    const m = state.inApp.message;
    if (!m || state.inApp.voting) return;
    state.inApp.voting = optionId; changed();
    const results = await api.inAppVote(m.id, optionId).catch(() => null);
    state.inApp = { message: m, results: results || { failed: true }, voting: false, voted: optionId };
    changed();
  },
};

// The first-start wizard is done (or skipped): never show it again
export function finishWelcome() {
  state.settings.onboarded = true;
  api.ftueComplete();
  changed();
}

// The overlay needs the whole config: a partial one (say, only the game settings on a fresh
// install) leaves it without colours and it fails. Always send it complete.
export const overlayConfig = () => withDefaults(state.settings.config);
export function showOverlay() { api.launchOverlay(overlayConfig()); }
export function toggleOverlay() { if (state.overlayOpen) api.closeOverlay(); else showOverlay(); }
