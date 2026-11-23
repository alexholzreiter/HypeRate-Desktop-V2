// The noble driver (src/ble.js) against a stand-in for @abandonware/noble.
// Covers two bugs: a late timeout that stopped whatever scan was running ten seconds after a
// reconnect had found its strap, and Bluetooth power changes that were not reported.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { mock } = require('node:test');

if (process.platform === 'win32') {
  console.log('SKIP ble.js is replaced by the WinRT helper on Windows');
  process.exit(2);
}

// ── Stand-in for noble ──
const noble = new EventEmitter();
noble.state = 'poweredOn';
noble.calls = [];
noble.startScanning = (uuids, dups, cb) => { noble.calls.push('start'); cb?.(); };
noble.stopScanning = () => { noble.calls.push('stop'); };

function fakePeripheral(id) {
  const p = new EventEmitter();
  p.id = id;
  p.advertisement = { localName: 'Polar H10' };
  const characteristic = new EventEmitter();
  characteristic.uuid = '2a37';
  characteristic.subscribe = (cb) => cb();
  characteristic.unsubscribe = (cb) => cb();
  p.connect = (cb) => cb();
  p.disconnect = (cb) => cb?.();
  p.discoverSomeServicesAndCharacteristics = (s, c, cb) => cb(null, [], [characteristic]);
  p.characteristic = characteristic;
  return p;
}

require.cache[require.resolve('@abandonware/noble')] = { exports: noble, loaded: true, id: 'noble' };
const ble = require('../src/ble');

const statuses = [];
const bpms = [];
const packets = [];
ble.init({
  onDeviceFound: () => {},
  onStatus: (state, extra) => statuses.push({ state, ...extra }),
  onBpm: (bpm) => bpms.push(bpm),
  onPacket: (p) => packets.push(p),
});

const flush = () => new Promise((r) => setImmediate(r));

async function run() {
  mock.timers.enable({ apis: ['setTimeout'] });

  // A reconnect to a strap that is not in the scan cache scans for it, finds it and connects.
  noble.calls.length = 0;
  const strap = fakePeripheral('strap-1');
  const connecting = ble.connect('strap-1', 'Polar H10');
  await flush();
  assert.deepEqual(noble.calls, ['start'], 'scans for the remembered strap');
  noble.emit('discover', strap);
  await flush();
  await connecting;
  assert.ok(statuses.some(s => s.state === 'connected'), 'connected after finding it');
  assert.deepEqual(noble.calls, ['start', 'stop'], 'the short scan is stopped once found');
  console.log('PASS a reconnect finds a strap that is not in the scan cache');

  // The user starts a scan afterwards; the old ten-second timeout must not stop it.
  noble.calls.length = 0;
  ble.startScan();
  assert.deepEqual(noble.calls, ['start']);
  mock.timers.tick(11000);
  await flush();
  assert.deepEqual(noble.calls, ['start'], 'nothing stopped the user\'s scan');
  console.log('PASS a finished reconnect scan no longer stops a later scan');
  ble.stopScan({ silent: true });

  // The strap's heart rate reaches the app
  strap.characteristic.emit('data', Buffer.from([0x00, 72]));
  assert.deepEqual(bpms, [72]);
  console.log('PASS heart rate data is decoded');

  // Skin contact flags: 0x06 = supported and detected, 0x04 = supported but not detected
  packets.length = 0;
  strap.characteristic.emit('data', Buffer.from([0x06, 81]));
  strap.characteristic.emit('data', Buffer.from([0x04, 0]));
  assert.deepEqual(packets, [{ bpm: 81, contact: true }, { bpm: 0, contact: false }]);
  assert.deepEqual(bpms, [72, 81], 'a measurement without contact is not shown as heart rate');
  console.log('PASS every measurement is reported with its skin contact flag');

  // Bluetooth switched off and on again is reported both ways
  statuses.length = 0;
  noble.state = 'poweredOff';
  noble.emit('stateChange', 'poweredOff');
  noble.state = 'poweredOn';
  noble.emit('stateChange', 'poweredOn');
  assert.deepEqual(statuses.map(s => s.state), ['ble-unavailable', 'ble-ready']);
  assert.equal(statuses[0].reason, 'poweredOff');
  console.log('PASS Bluetooth power changes are reported');

  // Scans asked for while Bluetooth is off start once it is on, and only once
  noble.calls.length = 0;
  noble.state = 'poweredOff';
  ble.startScan(); ble.startScan(); ble.startScan();
  assert.deepEqual(noble.calls, []);
  noble.state = 'poweredOn';
  noble.emit('stateChange', 'poweredOn');
  assert.deepEqual(noble.calls, ['start'], 'one scan, not one per request');
  console.log('PASS a scan waiting for Bluetooth starts exactly once');

  mock.timers.reset();
}

run().catch((error) => { console.error(error); process.exit(1); });
