// Discord Rich Presence manager
// Application ID: 1506611163868172308
// Assets: heart_green/yellow/orange/red/blue/purple, hyperate_logo, badge_ble, badge_cloud

const CLIENT_ID      = '1506611163868172308';
const UPDATE_INTERVAL = 15000; // Discord rate limit: min 15s between updates

let rpc         = null;
let connected   = false;
let startTime   = null;
let lastUpdate  = 0;
let pendingData = null;
let updateTimer = null;
let onStatus    = null;

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
async function connect() {
  if (connected) return;
  try {
    const { Client } = require('discord-rpc');
    rpc = new Client({ transport: 'ipc' });

    rpc.on('ready', () => {
      connected = true;
      startTime = new Date();
      onStatus?.('connected');
      if (pendingData) _flush();
    });

    rpc.transport?.on?.('close', _onDisconnect);
    rpc.on('disconnected', _onDisconnect);

    await rpc.login({ clientId: CLIENT_ID });
  } catch (err) {
    rpc = null;
    _onDisconnect();
    onStatus?.('error', { reason: _friendlyError(err.message) });
  }
}

function _onDisconnect() {
  if (!connected && !rpc) return;
  connected = false;
  rpc       = null;
  clearTimeout(updateTimer);
  updateTimer = null;
  onStatus?.('disconnected');
}

async function disconnect() {
  clearTimeout(updateTimer);
  updateTimer = null;
  pendingData = null;
  if (rpc) { try { await rpc.destroy(); } catch {} rpc = null; }
  connected = false;
  startTime = null;
  lastUpdate = 0;
}

// ── Presence update ──────────────────────────────────────────────────────────
function updatePresence({ bpm, zoneName, zoneColor, connectionType }) {
  if (!connected || !rpc) return;
  pendingData = { bpm, zoneName, zoneColor, connectionType };

  const sinceLast = Date.now() - lastUpdate;
  if (sinceLast >= UPDATE_INTERVAL) {
    _flush();
  } else if (!updateTimer) {
    updateTimer = setTimeout(() => { updateTimer = null; _flush(); }, UPDATE_INTERVAL - sinceLast);
  }
}

function _flush() {
  if (!pendingData || !connected || !rpc) return;
  const { bpm, zoneName, zoneColor, connectionType } = pendingData;
  pendingData = null;
  lastUpdate  = Date.now();

  const largeImageKey  = zoneColor ? colorToAsset(zoneColor) : 'hyperate_logo';
  const smallImageKey  = connectionType === 'ble' ? 'badge_ble' : 'badge_cloud';
  const smallImageText = connectionType === 'ble' ? 'Bluetooth Direct' : 'HypeRate Cloud';

  rpc.setActivity({
    details:        `❤️  ${bpm} BPM`,
    state:          zoneName || 'Active session',
    largeImageKey,
    largeImageText: 'HypeRate Desktop',
    smallImageKey,
    smallImageText,
    startTimestamp: startTime,
    buttons: [
      { label: 'Get HypeRate Desktop for free', url: 'https://desktop.hyperate.io' },
    ],
    instance: false,
  }).catch(() => {});
}

function clearPresence() {
  if (!connected || !rpc) return;
  clearTimeout(updateTimer);
  updateTimer = null;
  pendingData = null;
  rpc.clearActivity().catch(() => {});
}

function _friendlyError(msg = '') {
  if (msg.includes('ENOENT') || msg.includes('connect'))
    return 'Discord is not running.';
  return msg;
}

module.exports = { init, connect, disconnect, updatePresence, clearPresence, colorToAsset };
