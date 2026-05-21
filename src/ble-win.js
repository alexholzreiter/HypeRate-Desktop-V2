// Windows BLE manager backed by a native WinRT helper.
// Noble remains in use on macOS/Linux via src/ble.js.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RECONNECT_DELAY = 3000;

let helper = null;
let helperBuffer = '';
let helperStopping = false;
let logPath = null;

let onDeviceFound = null;
let onStatus = null;
let onBpm = null;

let connected = false;
let manualDisconnect = false;
let autoReconnect = false;
let reconnectTimer = null;
let lastConnected = null;

function init(callbacks) {
  onDeviceFound = callbacks.onDeviceFound;
  onStatus = callbacks.onStatus;
  onBpm = callbacks.onBpm;
}

function setAutoReconnect(enabled) {
  autoReconnect = !!enabled;
  if (!autoReconnect) {
    clearReconnect();
    return;
  }
  if (!connected && lastConnected) {
    scheduleReconnect(true);
  }
}

function startScan() {
  manualDisconnect = false;
  if (send({ cmd: 'scan-start' })) {
    onStatus?.('scanning');
  }
}

function stopScan({ silent = false } = {}) {
  if (send({ cmd: 'scan-stop' }) && !silent) {
    onStatus?.('idle');
  }
}

function connect(id, name) {
  manualDisconnect = false;
  clearReconnect();
  lastConnected = { id, name };
  connected = false;

  if (send({ cmd: 'connect', id, name })) {
    onStatus?.('connecting', { name });
  }
}

function disconnect(internal = false) {
  if (!internal) manualDisconnect = true;
  clearReconnect();
  connected = false;
  send({ cmd: 'disconnect' });
}

function send(message) {
  if (!ensureHelper()) return false;

  try {
    helper.stdin.write(JSON.stringify(message) + '\n');
    return true;
  } catch (err) {
    onStatus?.('ble-unavailable', { reason: err.message });
    return false;
  }
}

function ensureHelper() {
  if (helper && !helper.killed) return true;

  const helperPath = findHelperPath();
  if (!helperPath) {
    writeLog('Windows BLE helper is missing.');
    onStatus?.('ble-unavailable', {
      reason: 'Windows BLE helper is missing. Rebuild the app installer.',
    });
    return false;
  }

  helperStopping = false;
  helperBuffer = '';
  writeLog(`Starting Windows BLE helper: ${helperPath}`);
  helper = spawn(helperPath, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', handleStdout);
  helper.stderr.setEncoding('utf8');
  helper.stderr.on('data', chunk => {
    const text = String(chunk).trim();
    if (text) {
      writeLog(`stderr: ${text}`);
      console.error('[BLE-WIN]', text);
    }
  });

  helper.on('error', err => {
    writeLog(`helper error: ${err.message}`);
    helper = null;
    onStatus?.('ble-unavailable', { reason: err.message });
  });

  helper.on('exit', (code, signal) => {
    const wasStopping = helperStopping;
    helper = null;
    helperBuffer = '';
    connected = false;

    if (!wasStopping) {
      const reason = signal
        ? `Windows BLE helper stopped (${signal}).`
        : `Windows BLE helper exited (${code ?? 'unknown'}).`;
      writeLog(reason);
      onStatus?.('ble-unavailable', { reason });
      if (!manualDisconnect && autoReconnect && lastConnected) {
        scheduleReconnect(true);
      }
    }
  });

  return true;
}

function findHelperPath() {
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'native', 'win-ble', 'HypeRate.BleWin.exe'));
  }

  candidates.push(path.join(__dirname, 'native', 'win-ble', 'publish-self', 'HypeRate.BleWin.exe'));
  candidates.push(path.join(__dirname, 'native', 'win-ble', 'publish', 'HypeRate.BleWin.exe'));
  candidates.push(path.join(__dirname, '..', 'src', 'native', 'win-ble', 'publish-self', 'HypeRate.BleWin.exe'));
  candidates.push(path.join(__dirname, '..', 'src', 'native', 'win-ble', 'publish', 'HypeRate.BleWin.exe'));

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function handleStdout(chunk) {
  helperBuffer += chunk;
  const lines = helperBuffer.split(/\r?\n/);
  helperBuffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleMessage(JSON.parse(line));
    } catch (err) {
      console.error('[BLE-WIN] Invalid helper message:', line, err.message);
    }
  }
}

function handleMessage(message) {
  switch (message.type) {
    case 'device':
      writeLog(`device ${message.id} ${message.name || 'HR Monitor'} ${message.rssi ?? ''}`);
      onDeviceFound?.(message.id, message.name || 'HR Monitor', message.rssi);
      break;
    case 'bpm':
      if (Number.isFinite(message.bpm)) onBpm?.(message.bpm);
      break;
    case 'log':
      if (message.message) {
        writeLog(message.message);
        console.log('[BLE-WIN]', message.message);
      }
      break;
    case 'status':
      writeLog(`status ${message.state}${message.reason ? `: ${message.reason}` : ''}`);
      handleStatus(message);
      break;
    default:
      break;
  }
}

function handleStatus(message) {
  const { type, state, ...extra } = message;

  if (state === 'ready') return;

  if (state === 'connected') {
    connected = true;
    manualDisconnect = false;
    clearReconnect();
    if (extra.name && lastConnected) lastConnected.name = extra.name;
  } else if (state === 'disconnected') {
    const shouldReconnect = !manualDisconnect && autoReconnect && lastConnected;
    connected = false;
    onStatus?.(state, extra);
    if (shouldReconnect) scheduleReconnect(true);
    return;
  } else if (state === 'connect-error') {
    connected = false;
    if (!manualDisconnect && autoReconnect && lastConnected) {
      scheduleReconnect(false);
    }
  } else if (state === 'ble-unavailable') {
    connected = false;
  }

  onStatus?.(state, extra);
}

function scheduleReconnect(force = false) {
  if (reconnectTimer || !lastConnected || (!autoReconnect && !force)) return;

  onStatus?.('reconnecting', { name: lastConnected.name });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!connected && lastConnected && (autoReconnect || force)) {
      connect(lastConnected.id, lastConnected.name);
    }
  }, RECONNECT_DELAY);
}

function clearReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function writeLog(message) {
  try {
    const target = getLogPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });

    try {
      const { size } = fs.statSync(target);
      if (size > 1024 * 1024) {
        fs.renameSync(target, `${target}.1`);
      }
    } catch {}

    fs.appendFileSync(target, `${new Date().toISOString()} ${message}\n`, 'utf8');
  } catch {}
}

function getLogPath() {
  if (logPath) return logPath;

  try {
    const { app } = require('electron');
    if (app?.getPath) {
      logPath = path.join(app.getPath('userData'), 'ble-win.log');
      return logPath;
    }
  } catch {}

  logPath = path.join(process.cwd(), 'ble-win.log');
  return logPath;
}

process.once('exit', () => {
  helperStopping = true;
  try { helper?.stdin?.write(JSON.stringify({ cmd: 'shutdown' }) + '\n'); } catch {}
  try { helper?.kill(); } catch {}
});

module.exports = {
  init,
  startScan,
  stopScan,
  connect,
  disconnect,
  setAutoReconnect,
};
