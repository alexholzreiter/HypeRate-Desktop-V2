// BLE Heart Rate manager — wraps @abandonware/noble
// HR Service: 0x180D | HR Measurement Characteristic: 0x2A37
// Also: the Battery service (0x180F / 0x2A19) where a device has it, and the signal strength of
// the connection.

if (process.platform === 'win32') {
  module.exports = require('./ble-win');
  return;
}

const HR_SERVICE        = '180d';
const HR_CHARACTERISTIC = '2a37';
const BATTERY_SERVICE   = '180f';
const BATTERY_LEVEL     = '2a19';
const RSSI_EVERY_MS     = 5000;
const BATTERY_EVERY_MS  = 10 * 60 * 1000;
const RECONNECT_DELAY   = 3000; // ms between reconnect attempts
const CONNECT_TIMEOUT   = 20000;
const DISCOVER_TIMEOUT  = 30000;
const SUBSCRIBE_TIMEOUT = 12000;
const WIN_SCAN_SETTLE_DELAY = 750;
const WIN_POST_CONNECT_DELAY = 2000;
const WIN_DISCOVERY_RETRY_DELAY = 1500;

let noble = null;
let nobleError = null;

let scanWhenReady = false;   // a scan was asked for before Bluetooth was on

function getNobile() {
  if (nobleError) throw nobleError;
  if (!noble) {
    try {
      noble = require('@abandonware/noble');
    } catch (err) {
      nobleError = err;
      throw err;
    }
    // One listener for the whole lifetime. Bluetooth being switched off and on again is
    // reported, so a connection can be rebuilt as soon as the adapter is back.
    noble.on('stateChange', (state) => {
      if (state === 'poweredOn') {
        onStatus?.('ble-ready');
        if (scanWhenReady) { scanWhenReady = false; _beginScan(noble); }
      } else if (state !== 'unknown' && state !== 'resetting') {
        scanWhenReady = false;
        onStatus?.('ble-unavailable', { reason: state });
      }
    });
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
let onPacket      = null; // cb({ bpm, contact }) for every measurement, valid or not
let onBattery     = null; // cb(percent)
let onRssi        = null; // cb(dBm) of the connection

function init(callbacks) {
  onDeviceFound = callbacks.onDeviceFound;
  onStatus      = callbacks.onStatus;
  onBpm         = callbacks.onBpm;
  onPacket      = callbacks.onPacket;
  onBattery     = callbacks.onBattery;
  onRssi        = callbacks.onRssi;
}

function advertisedName(peripheral) {
  const raw = peripheral.advertisement?.localName || peripheral.advertisement?.completeName || peripheral.name;
  return raw && raw.trim() ? raw.trim() : null;
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
    scanWhenReady = true;   // started by the stateChange listener in getNobile
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
  onDeviceFound?.(peripheral.id, advertisedName(peripheral) || 'HR Monitor', peripheral.rssi);
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

  // Right after launch the adapter is not on yet; say so instead of "device not found".
  // The connection manager tries again as soon as the stateChange listener reports it ready.
  if (n.state !== 'poweredOn') {
    onStatus?.('connect-error', { reason: `Bluetooth is not ready yet (${n.state}).` });
    return;
  }

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
    const batteryChar = characteristics.find(c => c.uuid === BATTERY_LEVEL);
    if (!hrChar) {
      peripheral.disconnect();
      onStatus?.('connect-error', { reason: 'Heart Rate characteristic not found on this device.' });
      return;
    }

    hrChar.on('data', _onHrData);
    await subscribe(hrChar, 'Connected, but could not subscribe to heart rate data.');

    const raw  = peripheral.advertisement?.localName;
    const name = deviceName || ((raw && raw.trim()) ? raw.trim() : 'HR Monitor');
    connectedDevice = { id: peripheralId, peripheral, characteristic: hrChar, name, disconnectHandler, timers: [] };
    lastConnected   = { id: peripheralId, name };
    // Extras: they must never cost the connection
    try { if (batteryChar) watchBattery(batteryChar); } catch {}
    try { watchRssi(peripheral); } catch {}
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
      [HR_SERVICE, BATTERY_SERVICE], [HR_CHARACTERISTIC, BATTERY_LEVEL],
      (err, _svcs, chars) => err ? reject(err) : resolve({ characteristics: chars || [] })
    );
  }), DISCOVER_TIMEOUT, 'Connected, but the heart rate service did not respond.');
}

function subscribe(characteristic, message) {
  return withTimeout(new Promise((resolve, reject) => {
    characteristic.subscribe((err) => err ? reject(err) : resolve());
  }), SUBSCRIBE_TIMEOUT, message);
}

// The standard Battery service: read now and every ten minutes, and listen if it notifies
function watchBattery(characteristic) {
  const read = () => characteristic.read((err, data) => { if (!err && data?.length && data[0] <= 100) onBattery?.(data[0]); });
  if ((characteristic.properties || []).includes('notify')) {
    characteristic.on('data', (data) => { if (data?.length && data[0] <= 100) onBattery?.(data[0]); });
    characteristic.subscribe(() => {});
  }
  read();
  connectedDevice?.timers.push(setInterval(read, BATTERY_EVERY_MS));
}

// How strong the connection is (dBm), every few seconds
function watchRssi(peripheral) {
  if (typeof peripheral.updateRssi !== 'function') return;
  const update = () => peripheral.updateRssi((err, rssi) => { if (!err && Number.isFinite(rssi) && rssi < 0) onRssi?.(rssi); });
  update();
  connectedDevice?.timers.push(setInterval(update, RSSI_EVERY_MS));
}

function isDiscoveryTimeout(err) {
  return /heart rate service did not respond/i.test(err?.message || '');
}

function cleanupConnectedDevice() {
  if (!connectedDevice) return;
  const { peripheral, characteristic, disconnectHandler, timers } = connectedDevice;
  connectedDevice = null;
  for (const t of timers || []) clearInterval(t);
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

const FIND_TIMEOUT = 10000;

function _findPeripheral(n, id) {
  // Use the peripheral object from the scan — required on Windows WinRT
  if (peripheralCache.has(id)) {
    return Promise.resolve(peripheralCache.get(id));
  }
  if (n.state !== 'poweredOn') return Promise.resolve(null);

  // Fallback: short re-scan in case cache was cleared. It must not end a scan the user started
  // in the meantime, and its timeout must not fire after the device was already found: that
  // used to stop whatever scan was running ten seconds later.
  return new Promise((resolve) => {
    let done = false;
    const finish = (peripheral) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      n.removeListener('discover', onDisc);
      if (!scanning) n.stopScanning();
      resolve(peripheral);
    };
    const onDisc = (p) => {
      if (p.id === id) {
        peripheralCache.set(p.id, p);
        finish(p);
      }
    };
    const timer = setTimeout(() => finish(null), FIND_TIMEOUT);
    n.on('discover', onDisc);
    if (!scanning) {
      n.startScanning([HR_SERVICE], false, (err) => { if (err) finish(null); });
    }
  });
}

function _onHrData(data) {
  const flag    = data[0];
  const is16bit = (flag & 0x01) !== 0;
  const bpm     = is16bit ? data.readUInt16LE(1) : data[1];
  // Heart Rate Measurement flags: bit 2 = the strap can tell skin contact, bit 1 = it has it.
  // A strap without contact keeps sending, typically with 0 BPM, so the link is alive even
  // though there is nothing to show.
  const contactSupported = (flag & 0x04) !== 0;
  onPacket?.({ bpm, contact: contactSupported ? (flag & 0x02) !== 0 : null });
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
