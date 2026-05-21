// BLE Heart Rate manager — wraps @abandonware/noble
// HR Service: 0x180D | HR Measurement Characteristic: 0x2A37

if (process.platform === 'win32') {
  module.exports = require('./ble-win');
  return;
}

const HR_SERVICE        = '180d';
const HR_CHARACTERISTIC = '2a37';
const RECONNECT_DELAY   = 3000; // ms between reconnect attempts
const CONNECT_TIMEOUT   = 20000;
const DISCOVER_TIMEOUT  = 30000;
const SUBSCRIBE_TIMEOUT = 12000;
const WIN_SCAN_SETTLE_DELAY = 750;
const WIN_POST_CONNECT_DELAY = 2000;
const WIN_DISCOVERY_RETRY_DELAY = 1500;

let noble = null;
let nobleError = null;

function getNobile() {
  if (nobleError) throw nobleError;
  if (!noble) {
    try {
      noble = require('@abandonware/noble');
    } catch (err) {
      nobleError = err;
      throw err;
    }
  }
  return noble;
}

let scanning         = false;
let connectedDevice  = null;  // { id, peripheral, characteristic, name, disconnectHandler }
let lastConnected    = null;  // { id, name } — persists across disconnects for reconnect
let autoReconnect    = false;
let reconnectTimer   = null;
let manualDisconnect = false; // true when user intentionally disconnects
const peripheralCache = new Map(); // id -> peripheral, populated during scan

let onDeviceFound = null; // cb(id, name, rssi)
let onStatus      = null; // cb(state, extra?)
let onBpm         = null; // cb(bpm)

function init(callbacks) {
  onDeviceFound = callbacks.onDeviceFound;
  onStatus      = callbacks.onStatus;
  onBpm         = callbacks.onBpm;
}

function setAutoReconnect(enabled) {
  autoReconnect = enabled;
  // If just enabled and we're disconnected with a known device, try now
  if (enabled && !connectedDevice && lastConnected) {
    _scheduleReconnect(true);
  }
  if (!enabled) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function startScan() {
  let n;
  try { n = getNobile(); } catch (err) {
    onStatus?.('ble-unavailable', { reason: err.message });
    return;
  }
  if (n.state === 'poweredOn') {
    _beginScan(n);
  } else {
    n.once('stateChange', (state) => {
      if (state === 'poweredOn') _beginScan(n);
      else onStatus?.('ble-unavailable', { reason: state });
    });
  }
}

function _beginScan(n) {
  if (scanning) return;
  scanning = true;
  peripheralCache.clear();
  onStatus?.('scanning');
  n.on('discover', _onDiscover);
  n.startScanning([HR_SERVICE], false, (err) => {
    if (err) { scanning = false; onStatus?.('scan-error', { reason: err.message }); }
  });
}

function stopScan({ silent = false } = {}) {
  if (!scanning) return;
  scanning = false;
  const n = getNobile();
  n.removeListener('discover', _onDiscover);
  n.stopScanning();
  if (!silent) onStatus?.('idle');
}

function _onDiscover(peripheral) {
  peripheralCache.set(peripheral.id, peripheral);
  const raw  = peripheral.advertisement?.localName
            || peripheral.advertisement?.completeName
            || peripheral.name;
  const name = (raw && raw.trim()) ? raw.trim() : 'HR Monitor';
  onDeviceFound?.(peripheral.id, name, peripheral.rssi);
}

async function connect(peripheralId, deviceName) {
  return _connect(peripheralId, deviceName, { retriedDiscovery: false });
}

async function _connect(peripheralId, deviceName, { retriedDiscovery }) {
  let n;
  try { n = getNobile(); } catch (err) {
    onStatus?.('ble-unavailable', { reason: err.message });
    return;
  }
  manualDisconnect = false;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  if (scanning) {
    stopScan({ silent: true });
    if (process.platform === 'win32') await delay(WIN_SCAN_SETTLE_DELAY);
  }
  await disconnect(true);

  onStatus?.('connecting');

  const peripheral = await _findPeripheral(n, peripheralId);
  if (!peripheral) {
    onStatus?.('connect-error', { reason: 'Device not found — try scanning again.' });
    if (autoReconnect && lastConnected) _scheduleReconnect(true);
    return;
  }

  const disconnectHandler = () => {
    const wasManual = manualDisconnect;
    cleanupConnectedDevice();
    peripheralCache.delete(peripheral.id);
    onStatus?.('disconnected');

    if (!wasManual && lastConnected && (autoReconnect || process.platform === 'win32')) {
      _scheduleReconnect(process.platform === 'win32');
    }
  };
  peripheral.once('disconnect', disconnectHandler);

  try {
    await withTimeout(new Promise((resolve, reject) => {
      peripheral.connect((err) => err ? reject(err) : resolve());
    }), CONNECT_TIMEOUT, `Could not connect to ${deviceName || 'device'} within ${CONNECT_TIMEOUT / 1000}s.`);

    if (process.platform === 'win32') await delay(WIN_POST_CONNECT_DELAY);

    const { characteristics } = await discoverHeartRate(peripheral);

    const hrChar = characteristics.find(c => c.uuid === HR_CHARACTERISTIC);
    if (!hrChar) {
      peripheral.disconnect();
      onStatus?.('connect-error', { reason: 'Heart Rate characteristic not found on this device.' });
      return;
    }

    hrChar.on('data', _onHrData);
    await withTimeout(new Promise((resolve, reject) => {
      hrChar.subscribe((err) => err ? reject(err) : resolve());
    }), SUBSCRIBE_TIMEOUT, 'Connected, but could not subscribe to heart rate data.');

    const raw  = peripheral.advertisement?.localName;
    const name = deviceName || ((raw && raw.trim()) ? raw.trim() : 'HR Monitor');
    connectedDevice = { id: peripheralId, peripheral, characteristic: hrChar, name, disconnectHandler };
    lastConnected   = { id: peripheralId, name };
    onStatus?.('connected', { name });

  } catch (err) {
    cleanupConnectedDevice();
    peripheral.removeListener('disconnect', disconnectHandler);
    peripheralCache.delete(peripheral.id);
    try { peripheral.disconnect(); } catch {}
    if (
      process.platform === 'win32' &&
      !retriedDiscovery &&
      isDiscoveryTimeout(err)
    ) {
      await delay(WIN_DISCOVERY_RETRY_DELAY);
      onStatus?.('reconnecting', { name: deviceName || 'HR Monitor' });
      return _connect(peripheralId, deviceName, { retriedDiscovery: true });
    }
    onStatus?.('connect-error', { reason: err.message });
    if (autoReconnect && lastConnected) _scheduleReconnect(true);
  }
}

function discoverHeartRate(peripheral) {
  return withTimeout(new Promise((resolve, reject) => {
    peripheral.discoverSomeServicesAndCharacteristics(
      [HR_SERVICE], [HR_CHARACTERISTIC],
      (err, _svcs, chars) => err ? reject(err) : resolve({ characteristics: chars })
    );
  }), DISCOVER_TIMEOUT, 'Connected, but the heart rate service did not respond.');
}

function isDiscoveryTimeout(err) {
  return /heart rate service did not respond/i.test(err?.message || '');
}

function cleanupConnectedDevice() {
  if (!connectedDevice) return;
  const { peripheral, characteristic, disconnectHandler } = connectedDevice;
  connectedDevice = null;
  try { characteristic?.removeListener?.('data', _onHrData); } catch {}
  try { peripheral?.removeListener?.('disconnect', disconnectHandler); } catch {}
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function _scheduleReconnect(force = false) {
  if (reconnectTimer) return;
  onStatus?.('reconnecting', { name: lastConnected?.name });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!connectedDevice && lastConnected && (autoReconnect || force)) {
      connect(lastConnected.id, lastConnected.name);
    }
  }, RECONNECT_DELAY);
}

function _findPeripheral(n, id) {
  // Use the peripheral object from the scan — required on Windows WinRT
  if (peripheralCache.has(id)) {
    return Promise.resolve(peripheralCache.get(id));
  }
  // Fallback: short re-scan in case cache was cleared
  return new Promise((resolve) => {
    const onDisc = (p) => {
      if (p.id === id) {
        peripheralCache.set(p.id, p);
        n.removeListener('discover', onDisc);
        n.stopScanning();
        resolve(p);
      }
    };
    n.on('discover', onDisc);
    n.startScanning([HR_SERVICE], false, (err) => {
      if (err) {
        n.removeListener('discover', onDisc);
        resolve(null);
      }
    });
    setTimeout(() => { n.removeListener('discover', onDisc); n.stopScanning(); resolve(null); }, 10000);
  });
}

function _onHrData(data) {
  const flag    = data[0];
  const is16bit = (flag & 0x01) !== 0;
  const bpm     = is16bit ? data.readUInt16LE(1) : data[1];
  if (bpm > 0 && bpm < 300) onBpm?.(bpm);
}

async function disconnect(internal = false) {
  if (!internal) manualDisconnect = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (!connectedDevice) return;
  const { id, peripheral, characteristic, disconnectHandler } = connectedDevice;
  cleanupConnectedDevice();
  try { await new Promise((r) => characteristic.unsubscribe(r)); } catch {}
  try { peripheral.removeListener('disconnect', disconnectHandler); } catch {}
  try { await new Promise((r) => peripheral.disconnect(r)); } catch {}
  peripheralCache.delete(id);
}

module.exports = { init, startScan, stopScan, connect, disconnect, setAutoReconnect };
