// Discord Rich Presence manager
// Application ID: 1506611163868172308
// Assets: heart_green/yellow/orange/red/blue/purple, hyperate_logo, badge_ble, badge_cloud

const ipc = require('./discord-ipc');

const CLIENT_ID       = '1506611163868172308';
const UPDATE_INTERVAL = 15000; // Discord rate limit: min 15s between updates
const RETRY_DELAYS    = [5000, 10000, 20000, 30000]; // backoff while Discord is unreachable; last value repeats

let enabled     = false; // user wants Discord presence — keeps retrying while true
let client      = null;  // live connection (after READY)
let connecting  = false;
let retryTimer  = null;
let retryCount  = 0;
let startTime   = null;  // survives reconnects so Discord's elapsed timer doesn't restart
let lastUpdate  = 0;
let lastData    = null;  // latest presence — re-sent after a reconnect
let updateTimer = null;
let onStatus    = null;  // cb(state: 'waiting' | 'connected' | 'error', extra?)

function init(callbacks) {
  onStatus = callbacks.onStatus;
}

// ── Color → asset key ────────────────────────────────────────────────────────
function _hue(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  if (max === min) return 0;
  const d = max - min;
  let h = max === r ? (g-b)/d + (g<b?6:0)
        : max === g ? (b-r)/d + 2
                    : (r-g)/d + 4;
  return (h / 6) * 360;
}

function colorToAsset(hex) {
  if (!hex || hex.length < 7) return 'hyperate_logo';
  try {
    const h = _hue(hex);
    if (h >= 330 || h <  20) return 'heart_red';
    if (h >=  20 && h <  45) return 'heart_orange';
    if (h >=  45 && h <  75) return 'heart_yellow';
    if (h >=  75 && h < 165) return 'heart_green';
    if (h >= 165 && h < 265) return 'heart_blue';
    if (h >= 265 && h < 330) return 'heart_purple';
  } catch {}
  return 'hyperate_logo';
}

// ── Connect / Disconnect ─────────────────────────────────────────────────────
// connect() enables presence and keeps (re)connecting until disconnect() —
// covers Discord starting after us (autostart), Discord updates/restarts and sleep/wake.
function connect() {
  if (enabled) {
    onStatus?.(client ? 'connected' : 'waiting'); // re-sync a reloaded settings window
    return;
  }
  enabled    = true;
  retryCount = 0;
  onStatus?.('waiting');
  _attempt();
}

function _attempt() {
  if (!enabled || client || connecting) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  connecting = true;

  let conn = null;
  ipc.connect(CLIENT_ID, {
    onClose: () => { if (conn && conn === client) _onConnectionLost(); },
  }).then((c) => {
    connecting = false;
    if (!enabled) { c.close(); return; } // disabled while connecting
    conn = client = c;
    retryCount = 0;
    startTime ??= new Date();
    lastUpdate = 0;
    onStatus?.('connected');
    _flush();
  }).catch((err) => {
    connecting = false;
    if (!enabled) return;
    // Discord running but refusing us → show its reason; otherwise just wait for Discord
    if (err.rejected) onStatus?.('error', { reason: err.message });
    else              onStatus?.('waiting');
    _scheduleRetry();
  });
}

function _onConnectionLost() {
  client = null;
  clearTimeout(updateTimer);
  updateTimer = null;
  if (!enabled) return;
  onStatus?.('waiting');
  _scheduleRetry();
}

function _scheduleRetry() {
  clearTimeout(retryTimer);
  const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
  retryCount++;
  retryTimer = setTimeout(_attempt, delay);
}

function disconnect() {
  enabled = false;
  clearTimeout(retryTimer);
  clearTimeout(updateTimer);
  retryTimer = updateTimer = null;
  client?.close();
  client     = null;
  lastData   = null;
  startTime  = null;
  lastUpdate = 0;
}

// ── Presence update ──────────────────────────────────────────────────────────
function updatePresence({ bpm, zoneName, zoneColor, connectionType }) {
  if (!enabled) return;
  lastData = { bpm, zoneName, zoneColor, connectionType };
  if (!client) return; // sent as soon as the connection is (re)established

  const sinceLast = Date.now() - lastUpdate;
  if (sinceLast >= UPDATE_INTERVAL) {
    _flush();
  } else if (!updateTimer) {
    updateTimer = setTimeout(() => { updateTimer = null; _flush(); }, UPDATE_INTERVAL - sinceLast);
  }
}

function _flush() {
  if (!lastData || !client) return;
  const { bpm, zoneName, zoneColor, connectionType } = lastData;
  lastUpdate = Date.now();

  const isBle = connectionType === 'ble';
  client.setActivity({
    details: `❤️  ${bpm} BPM`,
    state:   zoneName || 'Active session',
    timestamps: { start: startTime.getTime() },
    assets: {
      large_image: zoneColor ? colorToAsset(zoneColor) : 'hyperate_logo',
      large_text:  'HypeRate Desktop',
      small_image: isBle ? 'badge_ble' : 'badge_cloud',
      small_text:  isBle ? 'Bluetooth Direct' : 'HypeRate Cloud',
    },
    buttons: [
      { label: 'Get HypeRate Desktop for free', url: 'https://desktop.hyperate.io' },
    ],
    instance: false,
  }).catch(() => {});
}

function clearPresence() {
  clearTimeout(updateTimer);
  updateTimer = null;
  lastData    = null;
  client?.clearActivity().catch(() => {});
}

module.exports = { init, connect, disconnect, updatePresence, clearPresence, colorToAsset };
