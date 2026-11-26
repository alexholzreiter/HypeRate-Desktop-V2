// A detached terminal can fail asynchronously while Node or Electron is logging.
// Neither console stream is required for the app to continue running.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

const { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeTheme, Tray, Menu, nativeImage, shell, dialog, safeStorage, Notification, powerMonitor, clipboard, ClipboardItem, protocol, session } = require('electron');

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
}
// No WebGPU anywhere in the app: nothing of ours uses it, and an addon could compute on the
// graphics card with it (mining, say), out of reach of its CPU watch. The per-window setting
// (disableBlinkFeatures) does not take it away; without the service no adapter is handed out.
app.commandLine.appendSwitch('disable-features', 'WebGPUService');

const edition = require('./edition');
const storeMigration = require('./store-migration');
app.setAppUserModelId(edition.appId);
const path   = require('path');
const fs     = require('fs');
const dgram  = require('dgram');
const { WebSocket } = require('ws');
const ble     = require('./ble');
const { createBleManager } = require('./ble-manager');
const discord = require('./discord');
const moments = require('./moments');
const wow     = require('./games/wow');
const { createHyperaid } = require('./games/wow/hyperaid');
const lol     = require('./games/lol');
const mqtt    = require('./mqtt');
const sessions = require('./sessions');
const sessionCard = require('./session-card');
const systemFonts = require('./system-fonts');
const customAssets = require('./custom-assets');
const LANGS = require('./i18n/languages');
const usageStats = require('./usage-stats');
const { createAddonHost, ADDON_SCHEME } = require('./addons/host');
const { readManifest: readAddonManifest, fingerprint: addonFingerprint, scan: scanAddons } = require('./addons/manifest');
const { fetchLatestRelease } = require('./desktop-update');
const { fitOverlay, restoreOverlayPlacement, overlayPlacementPreferences, OVERLAY_PAD } = require('./overlay-placement');
const crypto = require('crypto');

const { createInApp } = require('./in-app');

// A development run can point at a local stand-in (HYPERATE_PUSH_URL=http://localhost:…); a
// packaged app always talks to the real service.
const HYPERATE_PUSH_URL = (!app.isPackaged && process.env.HYPERATE_PUSH_URL) || 'https://push.hyperate.io';
const DESKTOP_PUSH_INTERVAL_MS = 30000;

let desktopPushTimer = null;
let desktopPushRunning = false;

function desktopPushPlatform() {
  if (process.platform === 'darwin') return 'MACOS';
  if (process.platform === 'win32') return 'WINDOWS';
  if (process.platform === 'linux') return 'LINUX';
  return 'UNKNOWN';
}

function encryptDesktopPushToken(token) {
  if (!token) return null;

  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(token).toString('base64');
    }
  } catch (error) {
    console.error('[Push] token encryption failed:', error);
  }

  return token;
}

function decryptDesktopPushToken(stored) {
  if (!stored) return null;

  if (!String(stored).startsWith('enc:')) {
    return String(stored);
  }

  try {
    if (!safeStorage.isEncryptionAvailable()) return null;

    return safeStorage.decryptString(
      Buffer.from(String(stored).slice(4), 'base64'),
    );
  } catch (error) {
    console.error('[Push] token decryption failed:', error);
    return null;
  }
}

async function registerDesktopPush() {
  const store = loadStore();

  const installationId =
    store.desktopPushInstallationId || crypto.randomUUID();

  if (!store.desktopPushInstallationId) {
    saveStore({
      ...store,
      desktopPushInstallationId: installationId,
    });
  }

  const payload = {
    installationId,
    platform: desktopPushPlatform(),
    // Not the computer name: it often carries the owner's first name ("Alex-MacBook-Pro")
    deviceModel: `${{ darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform] || process.platform} ${process.arch}`,
    osVersion: require('os').release(),
    appVersion: VERSION,
    appBuild: VERSION,
    language: app.getLocale() || undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
  };

  if (store.hrId) {
    payload.externalId = String(store.hrId).trim();
  }

  const response = await fetch(
    `${HYPERATE_PUSH_URL}/api/devices/register`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(`Registration failed with HTTP ${response.status}`);
  }

  const result = await response.json();

  if (!result?.device?.desktopPushToken) {
    throw new Error('Registration returned no desktop push token');
  }

  const latestStore = loadStore();

  saveStore({
    ...latestStore,
    desktopPushInstallationId: installationId,
    desktopPushToken: encryptDesktopPushToken(
      result.device.desktopPushToken,
    ),
  });

  console.log('[Push] desktop registered');

  return {
    installationId,
    token: result.device.desktopPushToken,
  };
}

async function getDesktopPushCredentials() {
  const store = loadStore();

  const installationId = store.desktopPushInstallationId;
  const token = decryptDesktopPushToken(store.desktopPushToken);

  if (installationId && token) {
    return {
      installationId,
      token,
    };
  }

  return registerDesktopPush();
}

const activeDesktopPushNotifications = new Set();

function showDesktopPushNotification(message) {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: message.title || 'HypeRate',
    body: message.message || '',
    silent: false,
    ...(process.platform === 'linux'
      ? { icon: path.join(__dirname, '..', 'assets', 'icon-linux.png') }
      : {}),
  });

  activeDesktopPushNotifications.add(notification);

  const releaseNotification = () => {
    activeDesktopPushNotifications.delete(notification);
  };

  notification.on('click', () => {
    const deepLink = message.deepLink
      ? String(message.deepLink).trim()
      : '';

    console.log('[Push] notification clicked:', deepLink || '(no link)');

    if (
      deepLink.startsWith('https://') ||
      deepLink.startsWith('http://')
    ) {
      shell.openExternal(deepLink).catch((error) => {
        console.error('[Push] link failed:', error);
      });
    } else {
      settingsWindow?.show();
      settingsWindow?.focus();
      // a decision on a shared addon: straight to that addon's page
      const addon = deepLink.match(/^hyperate-desktop:addon\/([a-z0-9-]{2,40})$/);
      if (addon) sendToSettings('open-addon', addon[1]);
    }

    releaseNotification();
  });

  notification.on('close', releaseNotification);

  notification.show();
}

async function pollDesktopPush() {
  if (desktopPushRunning) return;
  desktopPushRunning = true;

  try {
    const { installationId, token } =
      await getDesktopPushCredentials();

    const url =
      `${HYPERATE_PUSH_URL}/api/desktop/messages` +
      `?installationId=${encodeURIComponent(installationId)}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      const store = loadStore();

      saveStore({
        ...store,
        desktopPushToken: null,
      });

      console.warn('[Push] credentials rejected; will re-register');
      return;
    }

    if (!response.ok) {
      throw new Error(`Message fetch failed with HTTP ${response.status}`);
    }

    const result = await response.json();
    noteInAppRevision(result.inAppRevision);

    const messages = result.messages || [];

    for (const message of messages) {
      showDesktopPushNotification(message);
    }
  } catch (error) {
    console.error('[Push] poll failed:', error);
  } finally {
    desktopPushRunning = false;
  }
}

function startDesktopPush() {
  if (desktopPushTimer) return;

  registerDesktopPush()
    .catch((error) => {
      console.error('[Push] startup registration failed:', error);
    })
    .finally(() => {
      pollDesktopPush();
    });

  desktopPushTimer = setInterval(
    pollDesktopPush,
    DESKTOP_PUSH_INTERVAL_MS,
  );

  powerMonitor.on('resume', () => {
    pollDesktopPush();
    refreshInApp();
  });

  // In-app messages: once the installation is registered, then every few hours
  setTimeout(refreshInApp, 3000);
  setInterval(refreshInApp, IN_APP_INTERVAL_MS);
}

// ── In-app messages (see in-app.js) ──────────────────────────────────────────
// In the background every 15 minutes; when the window opens at most every 2 minutes; and right
// away when the 30-second push poll reports that the in-app messages changed (inAppRevision).
const IN_APP_INTERVAL_MS = 15 * 60 * 1000;
const IN_APP_ON_OPEN_MS = 2 * 60 * 1000;
const inApp = createInApp({ baseUrl: HYPERATE_PUSH_URL, credentials: () => getDesktopPushCredentials() });
let inAppMessage = null;      // the one to show now, or null
let inAppFetchedAt = 0;
const inAppDone = new Set();  // clicked or dismissed in this run: not shown again until restart

async function refreshInApp() {
  try {
    const message = await inApp.fetchMessage();
    inAppFetchedAt = Date.now();
    inAppMessage = message && !inAppDone.has(message.id) ? message : null;
    sendToSettings('inapp-message', inAppMessage);
  } catch (error) {
    console.error('[In-app] fetch failed:', error.message);
  }
}

ipcMain.handle('inapp-get', async () => {
  if (Date.now() - inAppFetchedAt > IN_APP_ON_OPEN_MS) await refreshInApp();
  return inAppMessage;
});
// The window coming forward is when a message can be read, so ask then (throttled)
function inAppOnShow() {
  if (Date.now() - inAppFetchedAt > IN_APP_ON_OPEN_MS) refreshInApp();
}
// The push poll carries a revision of the in-app messages; a new one means: fetch now
let inAppRevision = null;
function noteInAppRevision(revision) {
  if (typeof revision !== 'string' || !revision) return;   // an older server sends none
  if (inAppRevision !== null && revision !== inAppRevision) refreshInApp();
  inAppRevision = revision;
}
ipcMain.handle('inapp-event', async (_, id, event) => {
  if (event === 'click' || event === 'dismiss') {
    inAppDone.add(id);
    if (inAppMessage?.id === id) inAppMessage = null;
  }
  try { return await inApp.report(String(id), String(event)); } catch { return false; }
});
ipcMain.handle('inapp-vote', async (_, id, optionId) => {
  try { return await inApp.vote(String(id), String(optionId)); } catch { return null; }
});

// Wishes for HypeRate (what an addon could not do) go to HypeRate Push, where someone looks at
// them before they become a post in the Discord forum. Only what the user saw and sent, plus
// the app version and system (the server knows those from the registration anyway).
async function pushRequest(route, method, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { installationId, token } = await getDesktopPushCredentials();
    const url = `${HYPERATE_PUSH_URL}/api/desktop/${route}` + (method === 'GET' ? `?installationId=${encodeURIComponent(installationId)}` : '');
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify({ installationId, ...body }) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    // credentials no longer valid: register again, once
    if (response.status === 401 && attempt === 0) { saveStore({ ...loadStore(), desktopPushToken: null }); continue; }
    return response;
  }
}
const wishText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '') || null;
ipcMain.handle('wishes-send', async (_, wish = {}) => {
  try {
    const response = await pushRequest('wishes', 'POST', {
      title: wishText(wish.title, 100), body: wishText(wish.body, 4000),
      addonName: wishText(wish.addonName, 80), addonVersion: wishText(wish.addonVersion, 20),
      contactName: wishText(wish.contactName, 40),
      appVersion: VERSION, language: app.getLocale() || null,
    });
    if (response.ok) return { ok: true, id: (await response.json())?.wish?.id || null };
    return { ok: false, reason: response.status === 429 ? 'limit' : response.status === 400 ? 'invalid' : 'error' };
  } catch (error) {
    console.error('[Wishes] send failed:', error.message);
    return { ok: false, reason: 'offline' };
  }
});
ipcMain.handle('wishes-list', async () => {
  try {
    const response = await pushRequest('wishes', 'GET');
    return response.ok ? ((await response.json())?.wishes || []) : null;
  } catch { return null; }
});

// ── OSC ──────────────────────────────────────────────────────────────────────
// Pure Node.js UDP — no extra npm package needed.

function padTo4(n) { return Math.ceil(n / 4) * 4; }

function encodeOscStr(s) {
  const buf = Buffer.alloc(padTo4(Buffer.byteLength(s, 'utf8') + 1));
  buf.write(s, 'utf8');
  return buf;
}

// args: array of {t: 'i' | 'f' | 's' | 'T' | 'F', v?: any}
function buildOscMsg(address, args) {
  const addrBuf = encodeOscStr(address);
  const tagBuf  = encodeOscStr(',' + args.map(a => a.t).join(''));
  const dataBufs = args.map(({ t, v }) => {
    if (t === 'i') { const b = Buffer.alloc(4); b.writeInt32BE(v); return b; }
    if (t === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(v); return b; }
    if (t === 's') return encodeOscStr(String(v));
    return Buffer.alloc(0); // T, F — no data bytes
  });
  return Buffer.concat([addrBuf, tagBuf, ...dataBufs]);
}

let oscSocket = null;
function getOscSocket() {
  if (!oscSocket) {
    oscSocket = dgram.createSocket('udp4');
    oscSocket.on('error', err => { console.error('[OSC] socket error:', err); oscSocket = null; });
  }
  return oscSocket;
}

function oscSend(host, port, address, args) {
  try {
    const msg = buildOscMsg(address, args);
    getOscSocket().send(msg, 0, msg.length, port, host);
  } catch(e) { console.error('[OSC] send:', e); }
}

let _chatboxLastSent = 0;
let _addonChatUntil = 0;   // an addon's chatbox message stays up a while before the heart rate takes over again

const OSC_OUTPUT_DEFAULTS = {
  oscHost: '127.0.0.1', oscPort: 9000,
  oscRawEnabled: false, oscRawParam: 'HR', oscRawType: 'i',
  oscNormalizedEnabled: false, oscNormalizedParam: 'VRCOSC/Heartrate/Normalised', oscMinBpm: 0, oscMaxBpm: 240,
  // Not 'HR': that is the raw output's default, and two outputs may not share a name
  oscBoolEnabled: false, oscBoolParam: 'HRActive', oscBoolValue: true,
  oscLegacyEnabled: false,
};

function oscSettings(settings) {
  // Preserve existing mappings on upgrade
  const legacy = settings.oscNormalizedEnabled === undefined &&
    (settings.oscParam !== undefined || settings.oscEnabled === true);
  return { ...OSC_OUTPUT_DEFAULTS, ...(legacy ? {
    oscRawEnabled: true, oscRawParam: settings.oscParam ?? 'HR',
    oscNormalizedEnabled: false, oscLegacyEnabled: true,
  } : {}), ...settings };
}

function avatarHeartRatePackets(cfg, bpm) {
  if (typeof cfg.oscHost !== 'string' || !cfg.oscHost.trim() ||
      !Number.isInteger(cfg.oscPort) || cfg.oscPort < 1 || cfg.oscPort > 65535) {
    throw new Error('Enter a host and a port from 1 to 65535.');
  }
  for (const key of ['oscEnabled', 'oscChatbox', 'oscRawEnabled', 'oscNormalizedEnabled', 'oscBoolEnabled', 'oscLegacyEnabled']) {
    if (cfg[key] !== undefined && typeof cfg[key] !== 'boolean') throw new Error(`Invalid switch: ${key}`);
  }
  const packets = [];
  const addresses = new Set();
  function add(name, type, value) {
    if (typeof name !== 'string' || !name || name.length > 256 ||
        /[\s\x00-\x1f#*,?\[\]{}]/u.test(name) || name.split('/').some(part => !part)) {
      throw new Error('Use a parameter name without spaces, OSC wildcards, or a leading slash.');
    }
    const address = `/avatar/parameters/${name}`;
    if (addresses.has(address)) throw new Error(`Duplicate enabled parameter: ${name}`);
    addresses.add(address);
    packets.push({ address, args: [{ t: type, v: value }] });
  }
  if (cfg.oscRawEnabled) {
    if (!['i', 'f'].includes(cfg.oscRawType)) throw new Error('Raw BPM type must be Int or Float.');
    add(cfg.oscRawParam, cfg.oscRawType, cfg.oscRawType === 'i' ? Math.round(bpm) : bpm);
  }
  if (cfg.oscNormalizedEnabled) {
    if (!Number.isFinite(cfg.oscMinBpm) || !Number.isFinite(cfg.oscMaxBpm) ||
        cfg.oscMinBpm < 0 || cfg.oscMaxBpm <= cfg.oscMinBpm) {
      throw new Error('Normalized maximum BPM must exceed minimum BPM; minimum must be zero or higher.');
    }
    const normalized = (bpm - cfg.oscMinBpm) / (cfg.oscMaxBpm - cfg.oscMinBpm);
    add(cfg.oscNormalizedParam, 'f', Math.max(0, Math.min(1, normalized)));
  }
  if (cfg.oscBoolEnabled) {
    if (typeof cfg.oscBoolValue !== 'boolean') throw new Error('Boolean value must be True or False.');
    add(cfg.oscBoolParam, cfg.oscBoolValue ? 'T' : 'F', cfg.oscBoolValue);
  }
  if (cfg.oscLegacyEnabled) {
    add('onesHR', 'f', (bpm % 10) / 10);
    add('tensHR', 'f', (Math.floor(bpm / 10) % 10) / 10);
    add('hundredsHR', 'f', Math.floor(bpm / 100) / 10);
  }
  return packets;
}

function sendHeartRateOsc(bpm, settings = loadStore(), test = false) {
  const store = oscSettings(settings);
  if (!test && !store.oscEnabled) return;
  // Do not send invalid BPM samples over OSC.
  if (!Number.isFinite(bpm) || bpm < 0 || bpm > 2147483647) return;
  try {
    const packets = avatarHeartRatePackets(store, bpm);
    if (store.oscChatbox && (test || (Date.now() - _chatboxLastSent >= 2000 && Date.now() >= _addonChatUntil))) {
      const text = (store.oscChatboxFormat || '♥ {bpm} BPM').replace('{bpm}', bpm);
      packets.push({ address: '/chatbox/input', args: [{ t:'s', v: text }, { t:'T' }, { t:'F' }] });
      if (!test) _chatboxLastSent = Date.now();
    }
    for (const { address, args } of packets) oscSend(store.oscHost, store.oscPort, address, args);
    return { ok: true };
  } catch (error) {
    console.error('[OSC] Invalid output settings:', error.message);
    return { ok: false, error: error.message };
  }
}
// ─────────────────────────────────────────────────────────────────────────────

const STORE_PATH = path.join(app.getPath('userData'), 'settings.json');
function loadStore()     { try { return JSON.parse(fs.readFileSync(STORE_PATH,'utf8')); } catch { return {}; } }
function saveStore(data) { try { fs.writeFileSync(STORE_PATH, JSON.stringify(data,null,2),'utf8'); } catch(e) { console.error('store save:',e); } }

// One instance per edition. The lock lives in the data folder, so v1 and the beta can still run
// side by side, but starting the same one twice only brings its window forward: two instances
// meant two hearts in the menu bar and both reaching for the same strap.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;   // CommonJS: ends this module, nothing below is set up for the second instance
}
// Started again (Dock, Finder, a shortcut): bring the window back, and mend it if it broke, so
// starting the app always gets it back. A window that had lost its page used to swallow every
// later start.
app.on('second-instance', () => {
  if (!app.isReady()) return;
  if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
  else if (settingsWindow.webContents.isCrashed()) settingsWindow.reload();
  if (settingsWindow.isMinimized()) settingsWindow.restore();
  settingsWindow.show();
  settingsWindow.focus();
});

// A window whose page crashed or was ended by the system loads it again by itself
function reloadWhenGone(win, label, after = () => {}) {
  win.webContents.on('render-process-gone', (_, details) => {
    console.error(`[${label}] page gone: ${details.reason} (exit code ${details.exitCode})`);
    if (app.isQuitting || win.isDestroyed() || details.reason === 'clean-exit') return;
    setTimeout(() => { if (!win.isDestroyed()) { win.reload(); after(); } }, 500);
  });
}

// A plain "please quit" from the system (an installer, a Steam update, kill) ends the app the
// same way the tray's Quit does, so the current session is written first.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { app.isQuitting = true; app.quit(); });
}

// The beta lives in its own data folder; on its first start it takes over what v1 has.
if (edition.isBeta) {
  const copied = storeMigration.importFromStableInstall({
    fromDir: path.join(app.getPath('appData'), 'HypeRate Desktop'),
    toDir: app.getPath('userData'),
  });
  if (copied.length) console.log('Imported from HypeRate Desktop:', copied.join(', '));
}
{
  const stored = loadStore();
  const migrated = storeMigration.migrateStore(stored);
  if (migrated !== stored) saveStore(migrated);
}

const HYPERAID_TRACE = process.env.HYPERAID_TRACE === '1';
const HYPERAID_TRACE_PATH = path.join(path.dirname(STORE_PATH), 'hyperaid-diagnostics.log');
function tracePulse(component, event, detail = {}) {
  try {
    const line = `${new Date().toISOString()} [${component}] ${event} ${JSON.stringify(detail)}\n`;
    fs.appendFileSync(HYPERAID_TRACE_PATH, line, { mode: 0o600 });
  } catch {
    // A diagnostic write must never interrupt the live pulse feed.
  }
}

const HYPERATE_API_KEY = '7XnPqR2m9LdHsV4tYk8ZuEf1WaJ5GcB3rTsQ6v';
const VERSION = app.getVersion();            // reads from package.json

// Detect autostart launch — start hidden (tray only, no settings window)
const IS_AUTOSTART = process.platform === 'darwin'
  ? app.getLoginItemSettings().wasOpenedAtLogin
  : process.argv.includes('--hidden');

// ── Discord state ────────────────────────────────────────────────────────────
let discordEnabled    = false;
let currentConnType   = 'cloud'; // 'cloud' | 'ble'
let bleConnected      = false;

function zoneForBpm(bpm) {
  const store = loadStore();
  const zones = store.config?.zones || store.zones || [];
  return zones.find(z => bpm >= (z.min || 0) && bpm <= (z.max || 999)) || null;
}

function discordBpmUpdate(bpm) {
  if (!discordEnabled) return;
  const zone = zoneForBpm(bpm);
  discord.updatePresence({
    bpm,
    zoneName:       zone?.name  || null,
    zoneColor:      zone?.color || null,
    connectionType: currentConnType,
  });
}
// ─────────────────────────────────────────────────────────────────────────────

let settingsWindow  = null;
let overlayWindow   = null;
let tray            = null;
let overlayTrackedX = 0; // main-process position tracking — avoids stale getPosition() reads
let overlayTrackedY = 0;
let overlayTrackedW = 300; // current window size, kept in sync with widget size
let overlayTrackedH = 160;
// The edge the user put the widget nearer to (per axis): that edge stays put when the widget
// grows or shrinks, and the widget sits against that side of its window, so one at the screen's
// right edge stays flush there whatever number it shows
let overlayAnchor = { right: false, bottom: false };
let overlayClampedX = null; // last position set by resize-overlay (may differ from tracked near screen edges)
let overlayClampedY = null;
let overlayDisplayId = null;
let overlayDragging = false, overlayDragTimer = null, overlayPendingSize = null;
let overlayDisplayRefreshPending = false;
let overlayCursorTimer = null, overlayCursorInside = false;
let showBpmInTray   = loadStore().showBpmInTray !== false; // default true

// ── DPI helper ──
function scaleFactor() {
  return screen.getPrimaryDisplay().scaleFactor || 1;
}

function overlayDisplaySettings() {
  const store = loadStore();
  const primary = screen.getPrimaryDisplay();
  const displays = screen.getAllDisplays();
  const current = displays.find(display => display.id === overlayDisplayId);
  const { display } = restoreOverlayPlacement(screen, store, overlayTrackedW, overlayTrackedH);
  return {
    displays: displays.map(({ id, label }) => ({ id, label, primary: id === primary.id })),
    selected: (current || display).id,
    supportsSpaces: process.platform === 'darwin',
    allSpaces: store.overlayAllSpaces === true,
  };
}

function notifyOverlayDisplays() {
  sendToSettings('overlay-displays', overlayDisplaySettings());
}

function applyOverlaySpaces(enabled) {
  if (process.platform === 'darwin' && overlayWindow
      && overlayWindow.isVisibleOnAllWorkspaces() !== enabled) {
    overlayWindow.setVisibleOnAllWorkspaces(enabled, {
      visibleOnFullScreen: enabled,
      // Never let Electron switch the app between Dock app and menu bar app here: with the Dock
      // icon on, that switch took the icon away and pushed the main window off screen. Without
      // the Dock icon the app already is a menu bar app, so nothing changes there; with it, macOS
      // keeps the overlay out of other apps' full-screen spaces (the setting says so).
      skipTransformProcessType: true,
    });
  }
  addons.setAllSpaces(enabled);
}

// ── Main window ──
// (still called the settings window in the code: it grew out of the settings window of v1)
const MAIN_WINDOW = { file: 'windows/app/index.html', width: 1180, height: 820, minWidth: 940, minHeight: 640 };

function createSettingsWindow() {
  const kind = MAIN_WINDOW;
  settingsWindow = new BrowserWindow({
    width:kind.width, height:kind.height, minWidth:kind.minWidth, minHeight:kind.minHeight,
    frame:false, transparent:false, backgroundColor:'#080810',
    show: false, // shown explicitly after ready (or not at all on autostart)
    // Windows: only in the tray, unless the user wants it in the taskbar too (see applyDockIcon)
    skipTaskbar: process.platform === 'win32' && loadStore().showInDock !== true,
    webPreferences:{ nodeIntegration:false, contextIsolation:true, preload:path.join(__dirname,'preload.js') },
    icon: path.join(__dirname,'../assets/icon.png'),
    title:edition.name,
  });
  if (process.platform === 'linux') {
    let selectBluetoothCallback = null;

    settingsWindow.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
      event.preventDefault();
      selectBluetoothCallback = callback;

      for (const device of deviceList) {
        settingsWindow.webContents.send('ble-device-found', {
          id: device.deviceId,
          name: device.deviceName || 'HR Monitor',
          rssi: null,
        });
      }
    });

    ipcMain.removeAllListeners('ble-web-select-device');
    ipcMain.on('ble-web-select-device', (_, deviceId) => {
      if (!selectBluetoothCallback) return;
      const callback = selectBluetoothCallback;
      selectBluetoothCallback = null;
      callback(deviceId || '');
    });

    ipcMain.removeAllListeners('ble-web-cancel-scan');
    ipcMain.on('ble-web-cancel-scan', () => {
      if (!selectBluetoothCallback) return;
      const callback = selectBluetoothCallback;
      selectBluetoothCallback = null;
      callback('');
    });
  }

  settingsWindow.loadFile(path.join(__dirname, kind.file));
  reloadWhenGone(settingsWindow, 'window');

  // Coming forward is when an in-app message can be read: ask for one (throttled)
  settingsWindow.on('show', () => inAppOnShow());
  settingsWindow.on('focus', () => inAppOnShow());

  // Hide to tray instead of quitting when the window is closed
  settingsWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      settingsWindow.hide();
    }
  });
}

// ── Tray / Menu-bar icon ──
// Texts live in src/i18n/*.json; a key missing in a language falls back to English.
const STRINGS = require('./i18n/strings');
// The saved language, or the system's on a first start
function appLang() { return LANGS.resolve(loadStore().lang, app.getLocale()); }
function tl(key) { return STRINGS[appLang()]?.tray?.[key] ?? STRINGS.en.tray[key]; }

function buildMenu() {
  return Menu.buildFromTemplate([
    ...(newRelease ? [
      { label: tl('updateMenu').replace('%s', newRelease.version), click: () => shell.openExternal(newRelease.url) },
      { type: 'separator' },
    ] : []),
    {
      label: tl('settings'),
      click: () => { settingsWindow?.show(); settingsWindow?.focus(); },
    },
    {
      label: overlayIsOpen() ? tl('overlayHide') : tl('overlayShow'),
      click: () => toggleOverlay(),
    },
    {
      label: showBpmInTray ? tl('bpmHide') : tl('bpmShow'),
      click: () => {
        showBpmInTray = !showBpmInTray;
        const store = loadStore(); store.showBpmInTray = showBpmInTray; saveStore(store);
        if (!showBpmInTray) tray.setTitle('');
        tray.setContextMenu(buildMenu());
      },
    },
    { type: 'separator' },
    {
      label: tl('quit'),
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);
}

function createTray() {
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, '../assets/tray-icon.png')
    : path.join(__dirname, '../assets/icon.png');

  let img = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') {
    img = img.resize({ width: 18, height: 18 });
    img.setTemplateImage(true);
  } else {
    img = img.resize({ width: 32, height: 32 });
  }

  tray = new Tray(img);
  tray.setToolTip(edition.name);

  tray.setContextMenu(buildMenu());

  // Rebuild menu when overlay state changes so label stays accurate
  ipcMain.on('launch-overlay',  () => setTimeout(() => tray.setContextMenu(buildMenu()), 500));
  ipcMain.on('close-overlay',   () => setTimeout(() => tray.setContextMenu(buildMenu()), 100));

  // On macOS, show the context menu on left-click instead of opening settings directly
  if (process.platform === 'darwin') {
    tray.on('click', () => tray.popUpContextMenu());
  }
}

// ── Overlay window ──
// The overlay starts hidden and with the user's own config at hand (overlay-initial-config),
// and shows itself once it has drawn that (overlay-ready): no default heart for a moment
// before the chosen one. If it never says so, it is shown after 2 s anyway.
let overlayInitialConfig = null;
let overlayWanted = false;   // shown as soon as it is ready; hiding it first cancels that
function revealOverlay() {
  if (!overlayWanted || !overlayWindow || overlayWindow.isDestroyed() || overlayWindow.isVisible()) return;
  overlayWindow.show();
  notifyOverlayState();
}
ipcMain.handle('overlay-initial-config', (event) =>
  overlayWindow && event.sender === overlayWindow.webContents ? (overlayInitialConfig || loadStore().config || null) : null);
ipcMain.handle('overlay-anchor', () => overlayAnchor);
ipcMain.on('overlay-ready', (event) => { if (overlayWindow && event.sender === overlayWindow.webContents) revealOverlay(); });

function createOverlayWindow(initialConfig = null) {
  const store = loadStore();
  overlayInitialConfig = initialConfig || store.config || null;
  overlayWanted = true;
  // the size it had last time, so the edge it was kept at is right from the start
  const lastW = Number.isFinite(store.overlayWidth) ? store.overlayWidth : 300;
  const lastH = Number.isFinite(store.overlayHeight) ? store.overlayHeight : 160;
  overlayAnchor = { right: store.overlayAnchorRight === true, bottom: store.overlayAnchorBottom === true };
  const { display, x, y } = restoreOverlayPlacement(screen, store, lastW, lastH);
  // the whole screen, not only the work area: the widget may sit over the Dock, the taskbar or
  // the menu bar too (it floats above them) if that is where the user puts it
  const bounds = fitOverlay(display.bounds, x, y, lastW, lastH, OVERLAY_PAD);
  overlayDisplayId = display.id;
  overlayTrackedX = x;
  overlayTrackedY = y;
  overlayTrackedW = bounds.width;
  overlayTrackedH = bounds.height;
  overlayClampedX = bounds.x;
  overlayClampedY = bounds.y;

  overlayWindow = new BrowserWindow({
    ...bounds, show: false,
    // macOS would otherwise push the window back under the menu bar, and the widget with it
    enableLargerThanScreen: true,
    frame:false, transparent:true, alwaysOnTop:true,
    skipTaskbar:true, resizable:false, maximizable:false, fullscreenable:false, hasShadow:false,
    webPreferences:{ nodeIntegration:false, contextIsolation:true, preload:path.join(__dirname,'preload.js') },
    icon: path.join(__dirname,'../assets/icon.png'),
  });
  overlayWindow.loadFile(path.join(__dirname,'windows/overlay/index.html'));
  const created = overlayWindow;
  setTimeout(() => { if (overlayWindow === created) revealOverlay(); }, 2000);
  // after a reload the overlay needs its settings again
  reloadWhenGone(overlayWindow, 'overlay', () => setTimeout(() => { const cfg = loadStore().config; if (cfg) sendToOverlay('config-update', cfg); }, 400));
  overlayWindow.setAlwaysOnTop(true,'screen-saver');
  applyOverlaySpaces(store.overlayAllSpaces === true);

  // will-resize and will-move are intentionally not blocked here.
  // resizable:false + maximizable:false prevent user-initiated resizes.
  // Dynamic resizing via resize-overlay IPC adjusts the window to widget size.

  // Pass mouse events through transparent areas by default.
  // Linux doesn't support forward:true, so skip click-through there — drag still works.
  if (process.platform !== 'linux') {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  // Track position via native OS drag events — no custom drag code needed.
  // overlayTracked* is where the user put the widget; moves caused by resize-overlay
  // clamping are ignored so an expanding widget doesn't permanently drift from that spot.
  overlayWindow.on('move', () => {
    if (!overlayWindow) return;
    const [x, y] = overlayWindow.getPosition();
    if (x === overlayClampedX && y === overlayClampedY) return;  // our own resize, not the user
    overlayClampedX = overlayClampedY = null;
    overlayTrackedX = x; overlayTrackedY = y;
    noteOverlayDrag();
  });

  overlayWindow.on('close', () => {
    if (overlayDragging && !overlayDisplayRefreshPending) saveOverlayDrag(overlayWindow);
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
    overlayDisplayId = null;
    clearTimeout(overlayDragTimer);
    overlayDragging = overlayDisplayRefreshPending = false;
    overlayPendingSize = null;
    notifyOverlayState();
    clearInterval(overlayCursorTimer);
    overlayCursorTimer = null;
    overlayCursorInside = false;
  });
  watchOverlayCursor();

  // Send scale factor so overlay can adjust sizes
  overlayWindow.webContents.on('did-finish-load', () => {
    sendOverlayDisplayScale();
  });
}


// ── WebSocket ──
let ws = null, heartbeatInt = null, wsSessionId = null;

function wsConnect(sessionId) {
  wsDisconnect();
  wsSessionId = sessionId;
  if (HYPERAID_TRACE) tracePulse('WS', 'connecting');
  const url = `wss://app.hyperate.io/socket/websocket?token=${HYPERATE_API_KEY}`;
  ws = new WebSocket(url);

  ws.on('open', () => {
    currentConnType = 'cloud';
    ws.send(JSON.stringify({ topic:`hr:${sessionId}`, event:'phx_join', payload:{}, ref:'join' }));
    heartbeatInt = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:'hb' }));
    }, 25000);
  });

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    if (HYPERAID_TRACE && ['phx_reply', 'heartbeat', 'hr_update', 'hr_feed'].includes(msg.event)) {
      tracePulse('WS', msg.event);
    }
    if (msg.event === 'phx_reply') {
      sendToSettings('ws-status', { status: msg.payload?.status === 'ok' ? 'connected' : 'error', sessionId });
      return;
    }
    if (msg.event === 'hr_update' || msg.event === 'hr_feed') {
      const bpm = msg.payload?.hr ?? msg.payload?.bpm ?? msg.payload?.heart_rate;
      if (bpm != null) broadcastBpm(Number(bpm), 'cloud');
    }
  });

  ws.on('error', (err) => sendToSettings('ws-status', { status:'error', message: err.message }));
  ws.on('close', (code) => {
    clearInterval(heartbeatInt); heartbeatInt = null;
    sendToSettings('ws-status', { status:'closed', code });
  });
}

function wsDisconnect() {
  clearInterval(heartbeatInt); heartbeatInt = null;
  if (ws) { try { ws.terminate(); } catch {} ws = null; }
  if (process.platform === 'darwin' && tray) tray.setTitle('');
  discord.clearPresence(); // don't keep (or re-send after a Discord reconnect) a stale BPM
}

// During shutdown a window can still exist while its webContents is already gone
const alive = (w) => !!w && !w.isDestroyed() && !w.webContents.isDestroyed();
function sendToSettings(ch, d) { if (alive(settingsWindow)) settingsWindow.webContents.send(ch, d); }
function sendToOverlay(ch, d)  { if (alive(overlayWindow))  overlayWindow.webContents.send(ch, d); }

const hyperaid = createHyperaid(status => sendToSettings('hyperaid-status', status), {
  trace: HYPERAID_TRACE ? (event, detail) => tracePulse('HypeRaid', event, detail) : undefined,
});
const HYPERAID_CURSEFORGE_URL = '';
let hyperaidTimer;

// Game moments go to the overlay and to every output that wants them (MQTT today)
function emitGameMoment(moment) {
  sendToOverlay('game-moment', moment);
  mqtt.publishMoment(moment);
  sessions.recordMoment(moment);
  const m = moments.describe(moment);
  if (m) addons.emit('gameMoment', { game: m.game, type: m.type, title: m.title, detail: m.detail ?? null, bpm: m.bpm ?? null });
}

// Every BPM sample (cloud or BLE) goes through here
function broadcastBpm(bpm, source) {
  hyperaid.record(bpm);
  sendToSettings('bpm-update', source === 'ble' ? { bpm, source } : { bpm });
  sendToOverlay('heart-rate-update', { bpm });
  sendHeartRateOsc(bpm);
  discordBpmUpdate(bpm);
  mqtt.publishBpm(bpm, source, zoneForBpm(bpm) || {});
  addons.emit('heartRate', { bpm });
  const zone = zoneForBpm(bpm);
  if ((zone?.name || null) !== lastAddonZone) {
    lastAddonZone = zone?.name || null;
    addons.emit('zone', zone ? { name: zone.name, color: zone.color, min: zone.min, max: zone.max } : null);
  }
  sessions.recordBpm(bpm);
  moments.recordBpm(bpm);
  if (process.platform === 'darwin' && tray && showBpmInTray) tray.setTitle(` ${bpm}`);
}

// ── Showing and hiding the overlay ───────────────────────────────────────────
// This used to be the settings window's job alone, which left the tray entry and the hotkey
// dead whenever the overlay was closed. Main can open it by itself: the config it would send
// is already on disk, saved by the settings window on every change.
function overlayIsOpen() { return !!overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible(); }

function notifyOverlayState() {
  if (app.isQuitting) return;
  sendToSettings('overlay-state', { open: overlayIsOpen() });
  addons.setOverlayVisible(overlayIsOpen());   // addon windows come and go with the overlay
  if (tray) tray.setContextMenu(buildMenu());
}

// Whether the overlay was up when the app was left: it comes back with the next start. Closing
// windows while quitting does not count, only what the user did (button, tray, hotkey).
function rememberOverlay(open) {
  if (app.isQuitting) return;
  const store = loadStore();
  if ((store.overlayWasOpen === true) !== open) saveStore({ ...store, overlayWasOpen: open });
}

function showOverlay() {
  rememberOverlay(true);
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWanted = true;
    overlayWindow.show();
  } else {
    createOverlayWindow();
    const cfg = loadStore().config;
    if (cfg) setTimeout(() => sendToOverlay('config-update', cfg), 400);
  }
  notifyOverlayState();
}

function hideOverlay() {
  rememberOverlay(false);
  overlayWanted = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
  notifyOverlayState();
}

function toggleOverlay() { overlayIsOpen() ? hideOverlay() : showOverlay(); }

// ── Hotkey: toggles overlay visibility. CommandOrControl is Cmd on macOS, Ctrl elsewhere ──
const HOTKEY = 'CommandOrControl+Shift+H';
let hotkeyRegistered = false;

function registerHotkey() {
  hotkeyRegistered = globalShortcut.register(HOTKEY, toggleOverlay);
  // Another app may already own the combination; say so instead of failing quietly
  if (!hotkeyRegistered) console.warn(`[hotkey] ${HOTKEY} is taken by another app`);
  return hotkeyRegistered;
}

// What the settings panel should print on the keys
function hotkeyInfo() {
  return {
    keys: [process.platform === 'darwin' ? '⌘' : 'Ctrl', 'Shift', 'H'],
    registered: hotkeyRegistered,
  };
}

// ── User addons (src/addons) ─────────────────────────────────────────────────
// Off unless the master switch is on; each addon runs only after the user approved exactly
// this version and what it asks for.
let lastAddonZone = null;
let addonsChangedTimer = null;
// What addons may send through the app's own integrations (permissions discord, vrchat and
// homeAssistant; checked and rate limited in src/addons/host.js). Only while the user has that
// integration on: { ok: false, reason: 'off' } otherwise.
const bridged = (ok) => (ok ? { ok: true } : { ok: false, reason: 'off' });
const addonBridge = {
  discordStatus: (text) => bridged(discordEnabled && discord.setAddonText(text)),
  vrchatChatbox(text) {
    const cfg = oscSettings(loadStore());
    if (!cfg.oscEnabled) return { ok: false, reason: 'off' };
    oscSend(cfg.oscHost, cfg.oscPort, '/chatbox/input', [{ t: 's', v: text }, { t: 'T' }, { t: 'F' }]);
    _chatboxLastSent = Date.now();
    _addonChatUntil = Date.now() + 10000;
    return { ok: true };
  },
  vrchatParameter(name, value) {
    const cfg = oscSettings(loadStore());
    if (!cfg.oscEnabled) return { ok: false, reason: 'off' };
    const arg = typeof value === 'boolean' ? { t: value ? 'T' : 'F' }
      : Number.isInteger(value) && Math.abs(value) < 2 ** 31 ? { t: 'i', v: value } : { t: 'f', v: value };
    oscSend(cfg.oscHost, cfg.oscPort, `/avatar/parameters/${name}`, [arg]);
    return { ok: true };
  },
  homeAssistantEvent: (addonId, name, data) => bridged(mqtt.publishAddonEvent(addonId, name, data)),
};

const addons = createAddonHost({
  bridge: addonBridge,
  zoneFor: (bpm) => zoneForBpm(bpm),   // for test runs through the zones
  tampered: (entry) => galleryTampered(entry),
  onTampered: (entry) => repairGalleryAddon(entry),
  root: path.join(app.getPath('userData'), 'addons'),
  dataDir: path.join(app.getPath('userData'), 'addon-data'),
  loadStore, saveStore,
  appIcon: path.join(__dirname, '..', 'assets', 'icon.png'),
  // so an addon's overlay window starts next to the overlay and follows its spaces setting
  overlayInfo: () => ({
    allSpaces: loadStore().overlayAllSpaces === true,
    anchor: overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getBounds() : null,
  }),
  onChange: () => {   // many log lines at once become one update for the window
    if (addonsChangedTimer) return;
    addonsChangedTimer = setTimeout(() => { addonsChangedTimer = null; sendToSettings('addons-changed', {}); }, 250);
  },
});
const ADDONS_ROOT = path.join(app.getPath('userData'), 'addons');
ipcMain.handle('addons-list', () => addons.list());
ipcMain.handle('addons-set-master', (_, on) => addons.setMaster(on === true));
ipcMain.handle('addons-enable', (_, id, on) => addons.setEnabled(String(id), on === true));
ipcMain.handle('addons-approve', (_, id, print) => addons.approve(String(id), String(print)));
ipcMain.handle('addons-reload', (_, id) => addons.reload(String(id)));
ipcMain.handle('addons-simulate', (_, id, kind) => addons.simulate(String(id), kind == null ? null : String(kind)));
ipcMain.handle('addons-logs', (_, id) => addons.logs(String(id)));
ipcMain.handle('addons-remove', async (_, folder) => {
  // an addon from the gallery leaves its note too (version, fingerprint), so it is not "installed"
  const id = scanAddons(ADDONS_ROOT).find(e => e.folder === String(folder))?.manifest?.id;
  await addons.remove(String(folder));
  const store = loadStore();
  if (id && store.addonGallery?.[id]) { const { [id]: _gone, ...rest } = store.addonGallery; saveStore({ ...store, addonGallery: rest }); }
  return addons.list();
});
ipcMain.handle('addons-open-folder', () => { fs.mkdirSync(ADDONS_ROOT, { recursive: true }); return shell.openPath(ADDONS_ROOT); });
// A new addon from a name and what it should do: its folder with AGENTS.md (the guide for
// Claude, Codex and co.), the task written into it, and a main.js that only says it is ready.
// The assistant builds the rest; the app notices and asks for approval.
ipcMain.handle('addons-create', (_, { name, task } = {}) => {
  const title = String(name || '').trim().slice(0, 60) || 'My addon';
  const job = String(task || '').trim().slice(0, 2000);
  fs.mkdirSync(ADDONS_ROOT, { recursive: true });
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'addon';
  let folder = base.length >= 2 ? base : 'addon-' + base, n = 2;
  while (fs.existsSync(path.join(ADDONS_ROOT, folder))) folder = `${base}-${n++}`.slice(0, 40);
  const target = path.join(ADDONS_ROOT, folder);
  fs.mkdirSync(target);
  const template = path.join(__dirname, 'addons', 'template');
  fs.copyFileSync(path.join(template, 'main.js'), path.join(target, 'example.js.txt'));   // a working example to look at
  fs.writeFileSync(path.join(target, 'addon.json'), JSON.stringify({
    id: folder, name: title, version: '0.1.0', description: job.split('\n')[0].slice(0, 300), author: '',
    permissions: [], network: [], settings: [],
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(target, 'main.js'), `// ${title}\n// Built by an AI assistant from the task in AGENTS.md (see "Your task" at its end).\n\nhyperate.log('ready');\n`);
  fs.writeFileSync(path.join(target, 'AGENTS.md'), fs.readFileSync(path.join(template, 'AGENTS.md'), 'utf8')
    + `\n## Your task\n\n${job || '(The user has not described it yet. Ask them what the addon should do.)'}\n`);
  return { folder, dir: target, list: addons.list() };
});
ipcMain.handle('addons-set-overlay', (_, id, patch = {}) => addons.setOverlay(String(id), {
  on: typeof patch.on === 'boolean' ? patch.on : undefined, scale: Number(patch.scale) || undefined, resetPosition: patch.resetPosition === true }));
ipcMain.handle('addons-set-value', (_, id, key, value) => addons.setValue(String(id), String(key), value));
// The single addon: its main.js in the default editor, its folder in Finder / Explorer
const addonDir = (folder) => {
  const dir = path.resolve(ADDONS_ROOT, String(folder));
  return dir.startsWith(path.resolve(ADDONS_ROOT) + path.sep) && fs.existsSync(dir) ? dir : null;
};
ipcMain.handle('addons-open-editor', (_, folder) => { const d = addonDir(folder); return d ? shell.openPath(path.join(d, 'main.js')) : 'not found'; });
ipcMain.handle('addons-show-folder', (_, folder) => { const d = addonDir(folder); if (d) shell.showItemInFolder(path.join(d, 'addon.json')); return !!d; });

// Sharing an addon: it is on GitHub, HypeRate Push checks that repo and someone at HypeRate
// reviews the code. Sent along: the addon's id and version and the fingerprint of the folder
// here, so the review sees whether GitHub has exactly what was tested. What the user entered
// (link, name, social links) is kept for the next update; the links are public.
const SHARE_LINKS = ['x', 'youtube', 'twitch', 'website'];
ipcMain.handle('addons-share', async (_, folder, form = {}) => {
  const dir = addonDir(folder);
  if (!dir) return { ok: false, problems: ['no_addon_json'] };
  let manifest, print;
  try { manifest = readAddonManifest(dir); print = addonFingerprint(dir); }
  catch { return { ok: false, problems: ['bad_manifest'] }; }
  const links = Object.fromEntries(SHARE_LINKS.map(k => [k, wishText(form.links?.[k], 200)]).filter(([, v]) => v));
  const share = { repoUrl: wishText(form.repoUrl, 300), authorName: wishText(form.authorName, 60), links };
  const store = loadStore();
  saveStore({ ...store, addonShare: { ...(store.addonShare || {}), [manifest.id]: share } });
  try {
    const response = await pushRequest('addons', 'POST', { ...share, addonId: manifest.id, version: manifest.version, localFingerprint: print, appVersion: VERSION });
    const result = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, submission: result.submission };
    return { ok: false, problems: Array.isArray(result.problems) && result.problems.length ? result.problems : [response.status === 400 ? 'invalid' : 'error'] };
  } catch (error) {
    console.error('[Share] failed:', error.message);
    return { ok: false, problems: ['offline'] };
  }
});
ipcMain.handle('addons-shared', async () => {
  try {
    const response = await pushRequest('addons', 'GET');
    return response.ok ? ((await response.json())?.submissions || []) : null;
  } catch { return null; }
});
ipcMain.handle('addons-share-form', (_, id) => loadStore().addonShare?.[String(id)] || null);

// ── The gallery: approved addons from HypeRate Push, installed from GitHub ──
// Installing takes exactly the approved commit and checks its fingerprint against the one
// from the review: if GitHub hands out anything else, nothing is installed. Afterwards the
// addon asks for approval like any other. Installed ones are noted in addonGallery (version,
// commit), so updates can be offered and only they can be rated. An addon of the user's own
// with the same id is never replaced.
const GITHUB_API = (!app.isPackaged && process.env.HYPERATE_GITHUB_API) || 'https://api.github.com';
const GITHUB_RAW = (!app.isPackaged && process.env.HYPERATE_GITHUB_RAW) || 'https://raw.githubusercontent.com';
async function galleryList() {
  const response = await pushRequest('gallery', 'GET');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json())?.addons || [];
}
function installedAddons() {
  const fromGallery = loadStore().addonGallery || {};
  return Object.fromEntries(scanAddons(ADDONS_ROOT).filter(e => e.manifest).map(e =>
    [e.manifest.id, { folder: e.folder, version: e.manifest.version, gallery: fromGallery[e.manifest.id] || null }]));
}
ipcMain.handle('gallery-list', async () => {
  try { return { ok: true, addons: await galleryList(), installed: installedAddons() }; }
  catch (error) { console.error('[Gallery] list failed:', error.message); return { ok: false, installed: installedAddons() }; }
});
const SKIP_IN_ADDON = (rel) => /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(rel) || rel === 'AGENTS.md' || rel === 'WISHES.md';
ipcMain.handle('gallery-install', (_, addonId) => installFromGallery(String(addonId)));
async function installFromGallery(id) {
  let temp = null;
  try {
    const entry = (await galleryList()).find(a => a.addonId === id);
    if (!entry) return { ok: false, reason: 'gone' };
    const installed = installedAddons()[id];
    if (installed && !installed.gallery) return { ok: false, reason: 'own' };
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'HypeRate-Desktop' };
    const tree = await fetch(`${GITHUB_API}/repos/${entry.repoOwner}/${entry.repoName}/git/trees/${entry.commitSha}?recursive=1`, { headers, signal: AbortSignal.timeout(15000) });
    if (!tree.ok) return { ok: false, reason: 'github' };
    const prefix = entry.path ? entry.path.replace(/\/$/, '') + '/' : '';
    const files = ((await tree.json()).tree || []).filter(f => f.path.startsWith(prefix) && f.path.length > prefix.length)
      .map(f => ({ ...f, rel: f.path.slice(prefix.length) }));
    if (files.some(f => f.mode === '120000' || f.type === 'commit')) return { ok: false, reason: 'mismatch' };
    const blobs = files.filter(f => f.type === 'blob' && !SKIP_IN_ADDON(f.rel));
    if (blobs.length > 200 || blobs.some(f => f.rel.split('/').some(p => p === '..' || p === '.' || !p))) return { ok: false, reason: 'mismatch' };
    temp = path.join(app.getPath('userData'), 'addon-downloads', `${id}-${Date.now()}`);
    let bytes = 0;
    for (const f of blobs) {
      const target = path.join(temp, ...f.rel.split('/'));
      if (!target.startsWith(temp + path.sep)) return { ok: false, reason: 'mismatch' };
      const response = await fetch(`${GITHUB_RAW}/${entry.repoOwner}/${entry.repoName}/${entry.commitSha}/${f.path.split('/').map(encodeURIComponent).join('/')}`, { headers: { 'User-Agent': 'HypeRate-Desktop' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) return { ok: false, reason: 'github' };
      const data = Buffer.from(await response.arrayBuffer());
      bytes += data.length;
      if (bytes > 5 * 1024 * 1024) return { ok: false, reason: 'mismatch' };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    // exactly what was reviewed, or nothing
    let manifest;
    try { manifest = readAddonManifest(temp); } catch { return { ok: false, reason: 'mismatch' }; }
    if (manifest.id !== id || addonFingerprint(temp) !== entry.fingerprint) return { ok: false, reason: 'mismatch' };
    fs.mkdirSync(ADDONS_ROOT, { recursive: true });
    let folder = installed?.folder || id;
    if (!installed) { let n = 2; while (fs.existsSync(path.join(ADDONS_ROOT, folder))) folder = `${id}-${n++}`; }
    const dest = path.join(ADDONS_ROOT, folder);
    if (installed) {
      addons.reload(id);
      try { await shell.trashItem(dest); } catch { fs.rmSync(dest, { recursive: true, force: true }); }
    }
    // noted first (with the reviewed fingerprint), so the new files are never taken for a changed copy
    const store = loadStore();
    saveStore({ ...store, addonGallery: { ...(store.addonGallery || {}), [id]: { version: entry.version, commitSha: entry.commitSha, fingerprint: entry.fingerprint, installedAt: Date.now() } } });
    fs.renameSync(temp, dest);
    temp = null;
    addons.reload();
    return { ok: true, folder };
  } catch (error) {
    console.error('[Gallery] install failed:', error.message);
    return { ok: false, reason: 'offline' };
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}
// An installed addon runs only as HypeRate reviewed it. Its files changed by hand (it cannot be
// edited in the app): it does not start, and the reviewed version is fetched again.
function galleryTampered(entry) {
  const g = loadStore().addonGallery?.[entry.manifest?.id];
  return !!(g?.fingerprint && entry.fingerprint !== g.fingerprint);
}
const galleryRepairing = new Set();
function repairGalleryAddon(entry) {
  const id = entry.manifest.id;
  if (galleryRepairing.has(id)) return;
  galleryRepairing.add(id);
  console.warn(`[Gallery] ${id} differs from the reviewed version; fetching it again`);
  installFromGallery(id).then(r => { if (!r.ok) console.warn(`[Gallery] ${id} could not be restored: ${r.reason}`); })
    .finally(() => setTimeout(() => galleryRepairing.delete(id), 60000));   // offline: try again a minute later
}
ipcMain.handle('gallery-rate', async (_, addonId, stars) => {
  const id = String(addonId), n = Math.round(Number(stars));
  const mine = loadStore().addonGallery?.[id];
  if (!mine || !(n >= 1 && n <= 5)) return { ok: false };
  try {
    const response = await pushRequest('gallery/rate', 'POST', { addonId: id, stars: n, version: mine.version });
    return response.ok ? { ok: true, ...(await response.json()) } : { ok: false };
  } catch { return { ok: false }; }
});

// ── Hearts and fonts the user brings along ───────────────────────────────────
// Served as hr-asset://a/<file> from one folder only; see custom-assets.js
const ASSET_DIR = path.join(app.getPath('userData'), 'custom-assets');
protocol.registerSchemesAsPrivileged([
  { scheme: 'hr-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  ADDON_SCHEME,   // user addons: each one's own files, served into its own sandboxed session
]);

const ASSET_LIST = { heart: 'customHearts', font: 'customFonts' };
ipcMain.handle('assets-pick', async (_, kind) => {
  if (!ASSET_LIST[kind]) return { ok: false, code: 'kind' };
  const exts = customAssets.KINDS[kind].exts.map(e => e.slice(1));
  const res = await dialog.showOpenDialog(settingsWindow, { properties: ['openFile'], filters: [{ name: kind === 'heart' ? 'Images' : 'Fonts', extensions: exts }] });
  if (res.canceled || !res.filePaths[0]) return { ok: false, code: 'canceled' };
  try {
    const asset = customAssets.importAsset({ kind, source: res.filePaths[0], dir: ASSET_DIR });
    const store = loadStore();
    store[ASSET_LIST[kind]] = [...(store[ASSET_LIST[kind]] || []), asset];
    saveStore(store);
    return { ok: true, asset, list: store[ASSET_LIST[kind]] };
  } catch (error) {
    return { ok: false, code: error.code || 'error', detail: error.detail };
  }
});
ipcMain.handle('assets-remove', (_, kind, file) => {
  if (!ASSET_LIST[kind]) return [];
  const store = loadStore();
  store[ASSET_LIST[kind]] = (store[ASSET_LIST[kind]] || []).filter(a => a.file !== file);
  saveStore(store);
  customAssets.removeAsset({ file, dir: ASSET_DIR });
  return store[ASSET_LIST[kind]];
});

// ── Dock (macOS) or taskbar (Windows) icon ───────────────────────────────────
// The app lives in the menu bar / tray; showing it in the Dock or the taskbar as well is a choice.
function applyDockIcon(show) {
  if (process.platform === 'darwin') {
    if (show) {
      app.dock.show();
      // A packaged build has its icon in the bundle; a dev run would show Electron's otherwise
      if (!app.isPackaged) app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, '../assets/icon-mac.png')));
    } else app.dock.hide();
    // Hiding the Dock icon makes macOS drop the app's focus; keep the window the user is in
    if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) setTimeout(() => settingsWindow.focus(), 50);
    applyOverlaySpaces(loadStore().overlayAllSpaces === true);
  } else if (process.platform === 'win32' && settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setSkipTaskbar(!show);
  }
}
ipcMain.handle('dock-set', (_, on) => {
  const store = loadStore();
  store.showInDock = on === true;
  saveStore(store);
  applyDockIcon(store.showInDock);
  return store.showInDock;
});
// A click on the Dock icon opens the window
app.on('activate', () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); }
});

// ── Anonymous usage count (opt-in, see usage-stats.js) ───────────────────────
let usageCounted = false;   // once per start
function countVisit() {
  if (usageCounted || loadStore().analyticsEnabled !== true) return;
  usageCounted = true;
  const { width, height } = screen.getPrimaryDisplay().size;
  usageStats.sendVisit({ enabled: true, language: app.getLocale(), screen: `${width}x${height}`, userAgent: session.defaultSession.getUserAgent() })
    .then(r => { if (!r.sent) usageCounted = false; });
}
ipcMain.handle('analytics-set', (_, on) => {
  const store = loadStore();
  store.analyticsEnabled = on === true;
  saveStore(store);
  if (store.analyticsEnabled) countVisit();
  return store.analyticsEnabled;
});

// ── App ready ──
app.whenReady().then(() => {
  protocol.handle('hr-asset', (request) => {
    const found = customAssets.resolveAsset({ url: request.url, dir: ASSET_DIR });
    if (!found) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(found.path), { headers: { 'content-type': found.type, 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' } });
  });
  startDesktopPush();
  const settings = loadStore();
  if (settings.hyperaidEnabled) {
    hyperaid.configure({ enabled: true, folder: settings.hyperaidFolder || settings.wowPath }).catch(() => {});
  }
  hyperaidTimer = setInterval(() => hyperaid.tick(), 500);
  applyDockIcon(loadStore().showInDock === true);

  createSettingsWindow();
  addons.sync();
  countVisit();
  createTray();
  registerHotkey();
  // up again if it was up when the app was left (after the first start is done)
  if (settings.onboarded === true && settings.overlayWasOpen === true && settings.config) setTimeout(() => { if (!overlayIsOpen()) showOverlay(); }, 1200);
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, refreshOverlayDisplays);
  }

  // Steam updates the app itself and does not allow a second updater; only the GitHub build looks
  if (!edition.isSteam) {
    setTimeout(() => checkForUpdate(), 8000);            // nicht gleich in den Startvorgang hinein
    setInterval(() => checkForUpdate(), UPDATE_EVERY_MS);
    powerMonitor.on('resume', () => checkForUpdate());   // ein Notebook schläft auch mal drei Tage
  }

  // Bluetooth: connect the remembered strap again, and check it after sleep or unlock,
  // because a connection can die during sleep without the driver ever reporting it.
  if (process.platform !== 'linux') {
    bleManager.start();
    powerMonitor.on('resume', () => bleManager.onResume());
    powerMonitor.on('unlock-screen', () => bleManager.onResume());
  }

  if (IS_AUTOSTART) {
    // Started via autostart — stay in tray, don't show settings window
  } else {
    settingsWindow.show();   // on the first start it opens with its own welcome wizard
  }
});

// Quitting happens in two passes: the first one saves everything and lets go of the Bluetooth
// strap, then quits again. A strap still connected when the process ends kept it alive after
// quitting (on macOS), which would leave an installer or a Steam update waiting for the app.
let bleReleased = false;
app.on('before-quit', (event) => {
  app.isQuitting = true;
  if (bleReleased) return;
  bleReleased = true;
  clearInterval(hyperaidTimer);
  sessions.stop();   // die letzte halbe Minute soll nicht verloren gehen
  addons.stopAll();
  event.preventDefault();
  const released = Promise.resolve().then(() => ble.shutdown?.()).catch(() => {});
  // The second quit must come after this one has been cancelled completely: called straight away
  // (nothing to release, no strap) Electron ignored it, closed the windows and kept running.
  Promise.race([released, new Promise((r) => setTimeout(r, 2000))]).then(() => setTimeout(() => app.quit(), 50));
});
app.on('will-quit', () => globalShortcut.unregisterAll());
// App lives in tray — never auto-quit when windows are closed
app.on('window-all-closed', () => {});

// ── IPC ──
ipcMain.on('ws-connect', (_, id) => {
  if (bleConnected) ble.disconnect();
  wsConnect(id);
});
ipcMain.on('ws-disconnect', () => { wsDisconnect(); sessions.close(); });

ipcMain.handle('overlay-is-open', () => overlayIsOpen());
ipcMain.on('launch-overlay', (_, config) => {
  rememberOverlay(true);
  if (!overlayWindow) createOverlayWindow(config);
  else if (!overlayWindow.isDestroyed() && !overlayWindow.isVisible()) { overlayWanted = true; overlayWindow.show(); }   // hidden by the hotkey or the tray
  setTimeout(() => { if (overlayWindow) overlayWindow.webContents.send('config-update', config); }, 400);
  notifyOverlayState();
});
ipcMain.on('close-overlay',     ()       => { rememberOverlay(false); overlayWanted = false; if (overlayWindow) { overlayWindow.close(); overlayWindow=null; notifyOverlayState(); } });
ipcMain.on('update-config',     (_, cfg) => { if (overlayWindow) overlayWindow.webContents.send('config-update', cfg); });
ipcMain.on('minimize-settings', () => { if (settingsWindow) settingsWindow.minimize(); });
ipcMain.on('close-settings',    () => { if (settingsWindow) settingsWindow.hide(); });

ipcMain.on('ftue-complete', () => {
  const store = loadStore();
  store.onboarded = true;
  saveStore(store);
});

ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
  if (overlayWindow) overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.handle('get-overlay-position', () => {
  if (!overlayWindow) return { x: 0, y: 0 };
  const [x, y] = overlayWindow.getPosition();
  return { x, y };
});

// setIgnoreMouseEvents(…, { forward: true }) only delivers mouse moves while the app is active,
// so an overlay sitting on top of a game never hears the pointer. Poll the cursor instead and
// hand its position to the renderer, which decides whether the widget is under it.
const OVERLAY_CURSOR_MS = 100;

function watchOverlayCursor() {
  if (process.platform === 'linux') return;   // no click-through there, plain DOM hover works
  clearInterval(overlayCursorTimer);
  overlayCursorInside = false;
  overlayCursorTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
    const b = overlayWindow.getBounds();
    const p = screen.getCursorScreenPoint();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (!inside && !overlayCursorInside) return;
    overlayCursorInside = inside;
    sendToOverlay('overlay-cursor', inside ? { x: p.x - b.x, y: p.y - b.y } : null);
  }, OVERLAY_CURSOR_MS);
}

// While the user drags the widget, setBounds() would abort the native drag (macOS), so the
// window is left alone until the drag is over — a card that grows meanwhile is applied after.
const OVERLAY_DRAG_IDLE_MS = 450;

function noteOverlayDrag() {
  if (!overlayDragging) { overlayDragging = true; sendToOverlay('overlay-dragging', true); }
  clearTimeout(overlayDragTimer);
  overlayDragTimer = setTimeout(() => {
    overlayDragging = false;
    sendToOverlay('overlay-dragging', false);
    if (overlayDisplayRefreshPending) {
      overlayDisplayRefreshPending = false;
      refreshOverlayDisplays();
    } else if (overlayWindow) {
      saveOverlayDrag(overlayWindow);
    }
    if (overlayPendingSize) {
      const { width, height } = overlayPendingSize;
      overlayPendingSize = null;
      applyOverlaySize(width, height);
    }
  }, OVERLAY_DRAG_IDLE_MS);
}

function saveOverlayDrag(window) {
  if (!window || window.isDestroyed()) return;
  const bounds = window.getBounds();
  const display = screen.getDisplayMatching(bounds);
  overlayDisplayId = display.id;
  overlayTrackedX = bounds.x;
  overlayTrackedY = bounds.y;
  overlayTrackedW = bounds.width;
  overlayTrackedH = bounds.height;
  const a = display.bounds;
  overlayAnchor = {
    right: a.x + a.width - (bounds.x + bounds.width) < bounds.x - a.x,
    bottom: a.y + a.height - (bounds.y + bounds.height) < bounds.y - a.y,
  };
  sendToOverlay('overlay-anchor', overlayAnchor);
  saveStore({ ...loadStore(), ...overlayPlacementPreferences(display, bounds.x, bounds.y),
    overlayWidth: bounds.width, overlayHeight: bounds.height, overlayAnchorRight: overlayAnchor.right, overlayAnchorBottom: overlayAnchor.bottom });
  sendOverlayDisplayScale();
  notifyOverlayDisplays();
}

function sendOverlayDisplayScale() {
  const display = screen.getAllDisplays().find(item => item.id === overlayDisplayId);
  sendToOverlay('scale-factor', display?.scaleFactor || scaleFactor());
}

function refreshOverlayDisplays() {
  if (overlayDragging) {
    overlayDisplayRefreshPending = true;
    return;
  }
  if (overlayWindow) {
    const { display, x, y } = restoreOverlayPlacement(screen, loadStore(), overlayTrackedW, overlayTrackedH);
    overlayDisplayId = display.id;
    overlayTrackedX = x;
    overlayTrackedY = y;
    applyOverlaySize(overlayTrackedW, overlayTrackedH);
    sendOverlayDisplayScale();
  }
  notifyOverlayDisplays();
}

function applyOverlaySize(width, height) {
  if (!overlayWindow) return;
  const display = screen.getAllDisplays().find(item => item.id === overlayDisplayId) || screen.getPrimaryDisplay();
  // a widget kept at the right (or bottom) keeps that edge where it is
  if (overlayAnchor.right) overlayTrackedX += overlayTrackedW - width;
  if (overlayAnchor.bottom) overlayTrackedY += overlayTrackedH - height;
  const bounds = fitOverlay(display.bounds, overlayTrackedX, overlayTrackedY, width, height, OVERLAY_PAD);
  overlayTrackedW = bounds.width;
  overlayTrackedH = bounds.height;
  overlayClampedX = bounds.x;
  overlayClampedY = bounds.y;
  overlayWindow.setBounds(bounds);
  // The overlay waits for this before it animates a card open: growing a transparent window
  // can leave stale pixels behind, and those would be the other game's widget.
  sendToOverlay('overlay-resized', { width: bounds.width, height: bounds.height });
}

ipcMain.on('resize-overlay', (_, { width, height }) => {
  if (!overlayWindow) return;
  if (overlayDragging) { overlayPendingSize = { width, height }; return; }
  applyOverlaySize(width, height);
});

ipcMain.handle('get-overlay-displays', overlayDisplaySettings);
ipcMain.handle('set-overlay-display', (_, id) => {
  const target = screen.getAllDisplays().find(display => display.id === id);
  if (!target) return overlayDisplaySettings();
  const store = loadStore();
  const previous = restoreOverlayPlacement(screen, store, overlayTrackedW, overlayTrackedH);
  const area = target.workArea;
  const { x, y } = fitOverlay(target.bounds, area.x + previous.x - previous.display.workArea.x,
    area.y + previous.y - previous.display.workArea.y, overlayTrackedW, overlayTrackedH, OVERLAY_PAD);
  saveStore({ ...store, ...overlayPlacementPreferences(target, x, y) });
  refreshOverlayDisplays();
  return overlayDisplaySettings();
});
ipcMain.handle('set-overlay-all-spaces', (_, value) => {
  if (process.platform !== 'darwin') return;
  const enabled = value === true;
  saveStore({ ...loadStore(), overlayAllSpaces: enabled });
  applyOverlaySpaces(enabled);
});

ipcMain.handle('load-settings', () => ({ ...oscSettings(loadStore()), version: VERSION, distribution: edition.distribution, scaleFactor: scaleFactor(), hotkey: hotkeyInfo() }));

ipcMain.handle('save-osc-settings', (_, data) => {
  try {
    const keys = [...Object.keys(OSC_OUTPUT_DEFAULTS), 'oscEnabled', 'oscChatbox', 'oscChatboxFormat'];
    const updates = Object.fromEntries(keys.filter(key => Object.prototype.hasOwnProperty.call(data, key)).map(key => [key, data[key]]));
    const store = { ...oscSettings(loadStore()), ...updates };
    // Always allow the master switch to stop output, even while a field is invalid.
    if (store.oscEnabled) avatarHeartRatePackets(store, 72);
    // Replace only after the full write succeeds, so failed saves preserve settings.
    fs.writeFileSync(STORE_PATH + '.tmp', JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(STORE_PATH + '.tmp', STORE_PATH);
    return { ok: true };
  } catch (error) {
    try { fs.unlinkSync(STORE_PATH + '.tmp'); } catch {}
    return { ok: false, error: error.message };
  }
});

// OSC test — sends a dummy BPM of 72 to verify the connection
ipcMain.handle('test-osc', (_, settings) => sendHeartRateOsc(72, settings, true));
ipcMain.on('save-settings', (_, data) => {
  const store = loadStore();
  const previousHrId = String(store.hrId || '').trim();

  Object.assign(store, data);
  saveStore(store);

  if (data.lang && tray) tray.setContextMenu(buildMenu());
  if (data.config?.zones) sessions.setOptions({ zones: data.config.zones });

  if (Object.prototype.hasOwnProperty.call(data, 'hrId')) {
    const nextHrId = String(data.hrId || '').trim();

    if (nextHrId !== previousHrId) {
      registerDesktopPush().catch((error) => {
        console.error('[Push] HypeRate ID sync failed:', error);
      });
    }
  }
});

// ── Sessions ─────────────────────────────────────────────────────────────────
function sessionOptions(store = loadStore()) {
  return {
    enabled: !!store.sessionsEnabled,
    endAfterMs:  (Number(store.sessionsEndAfterMin)  || 5)  * 60000,
    minLengthMs: (Number(store.sessionsMinLengthMin) || 3)  * 60000,
    keepDays:     Number(store.sessionsKeepDays)     || 90,
    zones: store.config?.zones || [],
  };
}

sessions.init({
  dir: path.join(app.getPath('userData'), 'sessions'),
  onChange: (was) => sendToSettings('sessions-changed', { was }),
});
sessions.setOptions(sessionOptions());

ipcMain.handle('sessions-list',   () => sessions.list());
ipcMain.handle('sessions-delete', () => { sessions.deleteAll(); return true; });
// One whole session for the detail view: the curve and its moments
ipcMain.handle('sessions-read', (_, startedAt) => sessions.read(Number(startedAt)));
// Heart rate zones from the user's own sessions (Overlay → Zones)
ipcMain.handle('sessions-zone-suggestion', () => sessions.zoneSuggestion());
// Rendering the card needs the icon and the headline font as siblings of the html file,
// because a file:// page may not reach across directories for a font. They are copied into
// userData once and reused.
function cardAssets() {
  const dir = path.join(app.getPath('userData'), 'card');
  fs.mkdirSync(dir, { recursive: true });
  const kopien = [
    ['icon.png', path.join(__dirname, '..', 'assets', 'icon.png')],
    ['Alegreya.ttf', path.join(__dirname, 'windows', 'overlay', 'wow', 'Alegreya-Variable.ttf')],
  ];
  for (const [name, von] of kopien) {
    const nach = path.join(dir, name);
    if (!fs.existsSync(nach)) fs.copyFileSync(von, nach);
  }
  // The fonts ship with the app (assets/fonts); copied as a whole, they are small
  const fonts = path.join(dir, 'fonts');
  if (!fs.existsSync(path.join(fonts, 'fonts.css'))) fs.cpSync(path.join(__dirname, '..', 'assets', 'fonts'), fonts, { recursive: true });
  return dir;
}

// Renders a session's share card to an image (1920x1080). The last one is kept, so showing it,
// saving it and copying it do not render three times.
let lastCard = null;   // { startedAt, image }
async function renderCard(startedAt) {
  const lang = appLang();
  // reused for a minute: long enough for show, save and copy, short enough not to go stale
  // The line in zone colours while they are on, with the zones set right now (as in the app)
  const config = loadStore().config || {};
  const zones = config.zonesEnabled === true && Array.isArray(config.zones) && config.zones.length ? config.zones : null;
  const key = JSON.stringify(zones);
  if (lastCard?.startedAt === startedAt && lastCard.lang === lang && lastCard.key === key && Date.now() - lastCard.at < 60000) return lastCard.image;
  const session = sessions.read(startedAt);
  if (!session) return null;

  const dir = cardAssets();
  const seite = path.join(dir, 'card.html');
  fs.writeFileSync(seite, sessionCard.build(session, lang,
    { icon: 'icon.png', alegreya: 'Alegreya.ttf', fonts: 'fonts/fonts.css', zones }));

  // Halbe Fenstergröße bei doppelter Pixeldichte ergibt genau 1920x1080
  const win = new BrowserWindow({
    width: sessionCard.W / 2, height: sessionCard.H / 2, useContentSize: true, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  try {
    await win.loadFile(seite);
    win.webContents.setZoomFactor(0.5);
    await new Promise(r => setTimeout(r, 1500));               // Schriften und Layout
    const image = (await win.webContents.capturePage()).resize({ width: sessionCard.W, height: sessionCard.H });
    lastCard = { startedAt, lang, key, at: Date.now(), image };
    return image;
  } catch (err) {
    console.error('[session card]', err.message);
    return null;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function saveCard(startedAt, image) {
  // Ortszeit im Dateinamen, sonst passt er nicht zu den Uhrzeiten auf dem Bild
  const d = new Date(startedAt);
  const zwei = (n) => String(n).padStart(2, '0');
  const name = `HypeRate-${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}-${zwei(d.getHours())}-${zwei(d.getMinutes())}.png`;
  const ziel = path.join(app.getPath('pictures'), name);
  fs.writeFileSync(ziel, image.toPNG());
  shell.showItemInFolder(ziel);
  return ziel;
}

// The previous window: render and save in one go
ipcMain.handle('sessions-card', async (_, startedAt) => {
  const image = await renderCard(startedAt);
  return image ? saveCard(startedAt, image) : null;
});
// The new window: show it first, then save or copy
ipcMain.handle('sessions-card-preview', async (_, startedAt) => {
  const image = await renderCard(startedAt);
  return image ? image.resize({ width: 960 }).toDataURL() : null;
});
ipcMain.handle('sessions-card-save', async (_, startedAt) => {
  const image = await renderCard(startedAt);
  return image ? saveCard(startedAt, image) : null;
});
// Answers true, or the reason it failed, so the window can show it. Electron 45's clipboard is
// asynchronous and takes ClipboardItems (writeImage and readImage are gone): the card goes in as PNG.
ipcMain.handle('sessions-card-copy', async (_, startedAt) => {
  const image = await renderCard(startedAt);
  if (!image) return 'render';
  try {
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
    return (await clipboard.has('image/png')) ? true : 'empty';
  } catch (err) {
    console.error('[session card] copy:', err.message);
    return err.message || 'clipboard';
  }
});

ipcMain.on('sessions-set-options', (_, data = {}) => {
  const store = loadStore(); Object.assign(store, data); saveStore(store);
  sessions.setOptions(sessionOptions(store));
});

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.on('set-autostart', (_, enable) => {
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: !!enable, openAsHidden: !!enable });
  } else {
    app.setLoginItemSettings({ openAtLogin: !!enable, args: enable ? ['--hidden'] : [] });
  }
});

ipcMain.handle('get-system-fonts', () => systemFonts.list());

// ── Update check ─────────────────────────────────────────────────────────────
// Checking only at launch missed people who leave the app running for weeks. It now runs on
// a timer and after the machine wakes up, and it says so where the app actually lives: the
// tray menu, plus one notification per version. The badge in the settings needs the window
// to be open, which it usually is not.
const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
let newRelease = null;                 // { version, url } while something newer is out

async function checkForUpdate({ notify = true } = {}) {
  if (edition.isSteam) return { hasUpdate: false, steam: true };
  // A beta also looks at prereleases, so testers get the next beta (and then the release)
  const result = await fetchLatestRelease(VERSION, { prereleases: edition.isBeta });
  if (!result.hasUpdate) return result;

  newRelease = { version: result.latestVersion, url: result.downloadUrl };
  sendToSettings('update-available', newRelease);
  if (tray) tray.setContextMenu(buildMenu());

  // One notification per version, ever. The marker has to live in the store: the settings
  // window asks on its own when it opens, and an in-memory flag would count that as told.
  const store = loadStore();
  if (notify && store.updateNotified !== result.latestVersion && Notification.isSupported()) {
    const n = new Notification({
      title: tl('updateTitle').replace('%s', result.latestVersion),
      body: tl('updateBody'),
    });
    n.on('click', () => shell.openExternal(newRelease.url));
    n.show();
    store.updateNotified = result.latestVersion;
    saveStore(store);
  }
  return result;
}

ipcMain.handle('check-update', () => (newRelease
  ? { hasUpdate: true, latestVersion: newRelease.version, downloadUrl: newRelease.url }
  : checkForUpdate({ notify: false })));

// ── BLE ──────────────────────────────────────────────────────────────────────
// The drivers in ble.js / ble-win.js only talk to the device; how a connection is kept alive
// (remembering the strap, reconnecting, noticing silence, waking up) is ble-manager.js.
const BLE_LOG_PATH = path.join(app.getPath('userData'), 'ble.log');
function writeBleLog(line) {
  try {
    if (fs.existsSync(BLE_LOG_PATH) && fs.statSync(BLE_LOG_PATH).size > 1024 * 1024) {
      fs.renameSync(BLE_LOG_PATH, BLE_LOG_PATH + '.1');
    }
    fs.appendFileSync(BLE_LOG_PATH, line + '\n', 'utf8');
  } catch {}
}

const bleManager = createBleManager({
  driver: ble,
  store: {
    get: () => {
      const s = loadStore();
      return { device: s.bleLastDevice, active: s.bleLastDevice?.active, autoReconnect: s.bleAutoReconnect };
    },
    set: (patch) => {
      const s = loadStore();
      if ('device' in patch || 'active' in patch) {
        s.bleLastDevice = { ...(s.bleLastDevice || {}), ...(patch.device || {}), ...('active' in patch ? { active: patch.active } : {}) };
      }
      if ('autoReconnect' in patch) s.bleAutoReconnect = patch.autoReconnect;
      saveStore(s);
    },
  },
  meta: { platform: `${process.platform} ${process.arch}`, version: app.getVersion() },
  writeLog: writeBleLog,
  onDeviceFound: (id, name, rssi) => sendToSettings('ble-device-found', { id, name, rssi }),
  onSignalLost: () => {
    sendToOverlay('heart-rate-lost');
    if (process.platform === 'darwin' && tray && showBpmInTray) tray.setTitle(' --');
  },
  emit: (state, extra = {}) => {
    sendToSettings('ble-status', { state, ...extra });
    if (state === 'connected') {
      bleConnected = true;
      currentConnType = 'ble';
      if (ws) wsDisconnect();
      if (process.platform === 'darwin' && tray) tray.setContextMenu(buildMenu());
    }
    // A drop now goes straight to "reconnecting" instead of passing through "disconnected"
    const gone = ['disconnected', 'connect-error', 'idle', 'reconnecting', 'ble-unavailable'].includes(state);
    if (gone) bleConnected = false;
    if (gone && state !== 'connect-error') {
      if (process.platform === 'darwin' && tray && showBpmInTray) tray.setTitle('');
      discord.clearPresence();
    }
    if (state === 'signal-lost' || state === 'no-contact') discord.clearPresence();
  },
  onBpm: (bpm) => broadcastBpm(bpm, 'ble'),
  onVitals: (vitals) => sendToSettings('ble-vitals', vitals),   // battery and reception, or null
});

ipcMain.on('ble-scan-start',        ()              => bleManager.startScan());
ipcMain.on('ble-scan-stop',         ()              => bleManager.stopScan());
ipcMain.on('ble-connect', (_, { id, name }) => {
  if (ws) wsDisconnect();
  bleManager.connect(id, name);
});
ipcMain.on('ble-disconnect',        ()              => { bleManager.disconnect(); sessions.close(); });
ipcMain.on('ble-set-auto-reconnect',(_, enabled)   => {
  if (process.platform !== 'linux') bleManager.setAutoReconnect(enabled);
});
ipcMain.handle('ble-get-state', () => (process.platform === 'linux' ? null : bleManager.snapshot()));
ipcMain.handle('ble-get-log', (_, count) => (process.platform === 'linux' ? [] : bleManager.recentLog(Math.min(100, Number(count) || 20))));
ipcMain.handle('ble-copy-diagnostics', () => {
  const text = process.platform === 'linux'
    ? 'Bluetooth on Linux runs in the settings window; no diagnostics are collected here yet.'
    : bleManager.diagnostics();
  return clipboard.writeText(text).then(() => true, () => false);
});

ipcMain.on('ble-web-status', (_, { state, ...extra }) => {
  if (process.platform !== 'linux') return;

  sendToSettings('ble-status', { state, ...extra });

  if (state === 'connected') {
    bleConnected = true;
    currentConnType = 'ble';
    if (ws) wsDisconnect();
  }

  if (state === 'disconnected' || state === 'connect-error' || state === 'idle') {
    bleConnected = false;
  }

  if (state === 'disconnected' || state === 'idle') {
    discord.clearPresence();
  }
});

ipcMain.on('ble-web-bpm', (_, bpm) => {
  if (process.platform !== 'linux') return;
  const value = Number(bpm);
  if (value > 0 && value < 300) broadcastBpm(value, 'ble');
});

// ── Discord ──────────────────────────────────────────────────────────────────
discord.init({
  onStatus: (state, extra = {}) => sendToSettings('discord-status', { state, ...extra }),
});

ipcMain.on('discord-enable', () => {
  discordEnabled = true;
  discord.connect();
});
ipcMain.on('discord-disable', () => {
  discordEnabled = false;
  discord.disconnect();
});

// ── Game integrations: World of Warcraft ─────────────────────────────────────
const WOW_DIAGNOSTICS = path.join(app.getPath('userData'), 'wow-diagnostics.log');

wow.init({
  onStatus:  (state, extra = {}) => sendToSettings('wow-status', { state, ...extra }),
  onResult:  (result) => emitGameMoment(moments.build(result)),
  onInsight: (card)   => emitGameMoment({ game: 'wow', card }),
  diagnosticsPath: WOW_DIAGNOSTICS,
  sessionsPath: path.join(app.getPath('userData'), 'wow-sessions.json'),
});

ipcMain.on('wow-enable',      (_, opts) => wow.start(opts || {}));
ipcMain.on('wow-disable',     ()        => wow.stop());
ipcMain.on('wow-set-options', (_, opts) => wow.setOptions(opts || {}));
ipcMain.handle('wow-default-path', () => wow.defaultPath());
ipcMain.handle('hyperaid-status', () => ({ ...hyperaid.status(), curseforgeUrl: HYPERAID_CURSEFORGE_URL }));
ipcMain.handle('hyperaid-configure', async (_, options) => {
  const store = loadStore();
  store.hyperaidEnabled = options?.enabled === true;
  store.hyperaidFolder = typeof options?.folder === 'string' ? options.folder.trim() : '';
  saveStore(store);
  await hyperaid.configure({ enabled: store.hyperaidEnabled, folder: store.hyperaidFolder }).catch(() => {});
  return hyperaid.status();
});
ipcMain.handle('hyperaid-install', async () => {
  await hyperaid.install().catch(() => {});
  return hyperaid.status();
});
ipcMain.handle('wow-pick-folder', async (_, current) => {
  const res = await dialog.showOpenDialog(settingsWindow, {
    properties: ['openDirectory'],
    defaultPath: current || wow.defaultPath(),
  });
  return res.canceled ? null : res.filePaths[0];
});
ipcMain.on('wow-show-diagnostics', () => {
  if (fs.existsSync(WOW_DIAGNOSTICS)) shell.showItemInFolder(WOW_DIAGNOSTICS);
  else shell.openPath(app.getPath('userData'));
});

// ── Game integrations: League of Legends ────────────────────────────────────
// No setup needed: Riot's Live Client Data API is there while a match runs.
lol.init({
  onStatus: (state, extra = {}) => sendToSettings('lol-status', { state, ...extra }),
  onCard:   (card) => emitGameMoment({ game: 'lol', card }),
});

ipcMain.on('lol-enable',      (_, opts) => lol.start(opts || {}));
ipcMain.on('lol-disable',     ()        => lol.stop());
ipcMain.on('lol-set-options', (_, opts) => lol.setOptions(opts || {}));
// Test cards carry test: true, so the overlay shows them even while that game is switched off
ipcMain.on('lol-test',        (_, style) => emitGameMoment({ game: 'lol', card: lol.demoCard(style), test: true }));

// Preview a result card; uses real BPM history when there is some
const WOW_TEST_RESULTS = {
  close: { durationMs: 134000, lowestHealthPct: 7,  peakBpm: 168, hrIncrease: 41 },
  boss:  { durationMs: 278000, lowestHealthPct: 12, peakBpm: 171, hrIncrease: 52, name: 'Test Encounter' },
  death: { durationMs: 112000, lowestHealthPct: 0,  peakBpm: 164, hrIncrease: 47 },
};
ipcMain.on('wow-test', (_, type) => {
  if (type === 'insight') { emitGameMoment({ game: 'wow', card: wow.demoInsight(), test: true }); return; }
  const demo = WOW_TEST_RESULTS[type];
  if (!demo) return;
  const now = Date.now();
  const moment = moments.build({
    game: 'wow', type, name: demo.name || null,
    startedAt: now - demo.durationMs, endedAt: now, lowestHealthPct: demo.lowestHealthPct,
  });
  moment.peakBpm    ??= demo.peakBpm;
  moment.hrIncrease ??= demo.hrIncrease;
  moment.test = true;
  emitGameMoment(moment);
});
// ─────────────────────────────────────────────────────────────────────────────

// ── MQTT / Home Assistant ────────────────────────────────────────────────────
// The broker password is kept encrypted by the OS keychain, never in plain settings.json.
function encryptSecret(plain) {
  if (!plain) return '';
  try { return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(plain).toString('base64') : plain; }
  catch { return plain; }
}
// Returns null when something is stored but this machine cannot read it. safeStorage keeps its
// key in the keychain under the app's name, so a secret written by a differently named build,
// or on another machine, or before a keychain reset, is simply gone. Swallowing that and
// returning an empty string made the app connect with no password at all, which looks like a
// wrong password and leaves the settings showing dots for a secret that is not there.
function decryptSecret(stored) {
  if (!stored) return '';
  if (!String(stored).startsWith('enc:')) return stored;
  try { return safeStorage.decryptString(Buffer.from(String(stored).slice(4), 'base64')); }
  catch { return null; }
}

// An unreadable secret is worse than none: it keeps the settings claiming a password is set.
// This only reports; it deliberately does not rewrite the store. Several handlers load, mutate
// and save the store independently, so a write from here can be undone by one that read the
// file a moment earlier. The stale value is harmless once the user types a new one.
function readableSecret(store) {
  const plain = decryptSecret(store.mqttPassword);
  if (plain !== null) return plain;
  sendToSettings('mqtt-password-lost', {});
  return '';
}

function mqttOptions(opts = {}) {
  const store = loadStore();
  return {
    ...opts,
    password: opts.password !== undefined && opts.password !== null
      ? opts.password                                   // freshly typed in the settings
      : readableSecret(store),
    zonesEnabled: !!store.config?.zonesEnabled,
    appVersion: VERSION,
    discoverySignature: store.mqttDiscoverySignature || '',
  };
}

mqtt.init({
  onStatus: (state, extra = {}) => sendToSettings('mqtt-status', { state, ...extra }),
  // Remembered across restarts, otherwise every launch re-announces and Home Assistant
  // rebuilds the entities
  onDiscovery: (signature) => { const store = loadStore(); store.mqttDiscoverySignature = signature; saveStore(store); },
});

ipcMain.on('mqtt-enable', (_, opts = {}) => {
  if (opts.password) { const store = loadStore(); store.mqttPassword = encryptSecret(opts.password); saveStore(store); }
  mqtt.start(mqttOptions(opts.password ? opts : { ...opts, password: undefined }));
});
ipcMain.on('mqtt-disable', () => mqtt.stop());
ipcMain.on('mqtt-set-options', (_, opts = {}) => {
  if (opts.password) { const store = loadStore(); store.mqttPassword = encryptSecret(opts.password); saveStore(store); }
  mqtt.setOptions(mqttOptions(opts.password ? opts : { ...opts, password: undefined }));
});
ipcMain.handle('mqtt-test', () => mqtt.test());
// 'ok' | 'lost' | 'none'. The settings window asks on load, because a message pushed from here
// can go out before that window is listening.
ipcMain.handle('mqtt-has-password', () => {
  const store = loadStore();
  if (!store.mqttPassword) return 'none';
  return readableSecret(store) ? 'ok' : 'lost';
});

// Only web pages and mail links: a window must not be able to make the system open a local
// file or another program's URL scheme.
ipcMain.on('open-external', (_, url) => {
  try {
    const { protocol } = new URL(String(url));
    if (protocol === 'https:' || protocol === 'mailto:') shell.openExternal(String(url));
  } catch {}
});

ipcMain.handle('fetch-news', () => new Promise((resolve) => {
  const https = require('https');
  const req = https.get('https://blog.hyperate.io/feed.xml',
    { headers: { 'User-Agent': 'HypeRate-Overlay/1.0' } },
    (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }
  );
  req.on('error', () => resolve(null));
  req.setTimeout(8000, () => { req.destroy(); resolve(null); });
}));
