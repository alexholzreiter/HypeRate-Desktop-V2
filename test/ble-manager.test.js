// The Bluetooth connection manager against a simulated strap and a simulated clock:
// drops, silence, sleep, Bluetooth switched off, app restarts.
const assert = require('node:assert/strict');
const { createBleManager } = require('../src/ble-manager');

// ── A clock that only moves when the test says so ──
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const jobs = new Map(); // id -> { at, fn, every }
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = nextId++; jobs.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => jobs.delete(id),
    setInterval: (fn, ms) => { const id = nextId++; jobs.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id) => jobs.delete(id),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs.entries()].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, job] = due;
        now = job.at;
        if (job.every) job.at += job.every; else jobs.delete(id);
        job.fn();
      }
      now = end;
    },
  };
}

// ── A strap that does whatever the test tells it ──
function fakeDriver() {
  const d = {
    cb: null,
    calls: [],
    autoReconnect: null,
    init(cb) { d.cb = cb; },
    setAutoReconnect(v) { d.autoReconnect = v; },
    startScan() { d.calls.push('scan'); },
    stopScan() { d.calls.push('stop-scan'); },
    connect(id, name) { d.calls.push(`connect ${id}`); d.cb.onStatus('connecting', { name }); },
    disconnect(internal) { d.calls.push(internal ? 'drop' : 'disconnect'); },
    // what a real strap/driver would report
    accept(name = 'Polar H10') { d.cb.onStatus('connected', { name }); },
    refuse(reason = 'Device not found') { d.cb.onStatus('connect-error', { reason }); },
    drop() { d.cb.onStatus('disconnected'); },
    beat(bpm = 100) { d.cb.onBpm(bpm); },
    // what the noble driver reports for every measurement, before deciding whether it is usable
    packet(bpm, contact) { d.cb.onPacket({ bpm, contact }); if (bpm > 0) d.cb.onBpm(bpm); },
    status(state, extra) { d.cb.onStatus(state, extra); },
    connects() { return d.calls.filter(c => c.startsWith('connect')).length; },
  };
  return d;
}

function setup(saved = {}) {
  const timers = fakeTimers();
  const driver = fakeDriver();
  const states = [];
  const bpms = [];
  let lost = 0;
  let stored = { ...saved };
  const manager = createBleManager({
    driver,
    timers,
    store: { get: () => stored, set: (patch) => { stored = { ...stored, ...patch }; } },
    emit: (state, extra) => states.push({ state, ...extra }),
    onBpm: (bpm) => bpms.push(bpm),
    onSignalLost: () => { lost++; },
    meta: { platform: 'test', version: '0' },
  });
  return {
    manager, driver, timers, states, bpms,
    get lost() { return lost; },
    get stored() { return stored; },
    last: () => states[states.length - 1]?.state,
  };
}

const strap = { id: 'AA:BB:CC:DD:7A:3C', name: 'Polar H10' };

function check(name, fn) {
  fn();
  console.log('PASS ' + name);
}

check('the drivers no longer reconnect on their own', () => {
  const t = setup();
  assert.equal(t.driver.autoReconnect, false);
});

check('choosing a strap connects it and remembers it for next time', () => {
  const t = setup();
  t.manager.start();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  assert.equal(t.last(), 'connected');
  assert.deepEqual(t.stored.device, strap);
  assert.equal(t.stored.active, true);
});

check('after an app restart the remembered strap connects by itself', () => {
  const t = setup({ device: strap, active: true });
  t.manager.start();
  assert.equal(t.last(), 'reconnecting');
  t.timers.advance(1500);
  assert.equal(t.driver.connects(), 1);
  t.driver.accept();
  assert.equal(t.last(), 'connected');
});

check('a strap disconnected by hand stays disconnected after a restart', () => {
  const t = setup({ device: strap, active: false });
  t.manager.start();
  t.timers.advance(60000);
  assert.equal(t.driver.connects(), 0);
});

check('auto-reconnect is on unless it was switched off', () => {
  const off = setup({ device: strap, active: true, autoReconnect: false });
  off.manager.start();
  off.timers.advance(60000);
  assert.equal(off.driver.connects(), 0);
  const on = setup({ device: strap, active: true });
  on.manager.start();
  on.timers.advance(2000);
  assert.equal(on.driver.connects(), 1);
});

check('a drop goes straight to reconnecting, without a "disconnected" in between', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.drop();
  assert.equal(t.last(), 'reconnecting');
  assert.ok(!t.states.slice(-2).some(s => s.state === 'disconnected'));
  t.timers.advance(3000);
  assert.equal(t.driver.connects(), 2);
});

check('failed attempts wait longer each time, up to 15 seconds', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.drop();
  const waits = [];
  let at = t.timers.now();
  for (let i = 0; i < 7; i++) {
    const before = t.driver.connects();
    while (t.driver.connects() === before) t.timers.advance(500);
    waits.push(t.timers.now() - at);
    t.driver.refuse();
    at = t.timers.now();
  }
  assert.deepEqual(waits, [3000, 6000, 12000, 15000, 15000, 15000, 15000]);
});

check('a good connection resets the waiting time', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.drop();
  t.timers.advance(3000); t.driver.refuse();
  t.timers.advance(6000); t.driver.accept(); t.driver.beat();
  t.driver.drop();
  const before = t.driver.connects();
  t.timers.advance(3000);
  assert.equal(t.driver.connects(), before + 1);
});

check('an automatic attempt keeps saying "reconnecting" while it connects', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.drop();
  t.timers.advance(3000);
  assert.equal(t.last(), 'reconnecting');
});

check('disconnecting by hand stops all reconnecting', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.manager.disconnect();
  t.driver.drop();
  t.timers.advance(120000);
  assert.equal(t.driver.connects(), 1);
  assert.equal(t.last(), 'disconnected');
  assert.equal(t.stored.active, false);
});

check('silence while connected shows "signal lost", then rebuilds the connection', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.beat(120);
  t.timers.advance(10000);
  assert.equal(t.last(), 'connected');
  t.timers.advance(5000);
  assert.equal(t.last(), 'signal-lost');
  assert.equal(t.lost, 1);
  t.timers.advance(15000);
  assert.ok(t.driver.calls.includes('drop'), 'the dead connection is dropped');
  assert.equal(t.last(), 'reconnecting');
  t.timers.advance(3000);
  assert.equal(t.driver.connects(), 2);
});

check('heart rate coming back clears "signal lost"', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.beat(80);
  t.timers.advance(15000);
  assert.equal(t.last(), 'signal-lost');
  t.driver.beat(95);
  assert.equal(t.last(), 'connected');
  assert.deepEqual(t.bpms, [80, 95]);
  t.timers.advance(20000);
  assert.ok(!t.driver.calls.includes('drop'));
});

check('a steady heart rate never trips the watchdog', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  for (let i = 0; i < 120; i++) { t.timers.advance(1000); t.driver.beat(100 + (i % 5)); }
  assert.equal(t.last(), 'connected');
  assert.equal(t.lost, 0);
});

check('after sleep, a connection that is silently dead is noticed within seconds', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.beat(100);
  t.timers.advance(1000);
  t.manager.onResume();
  t.timers.advance(5000);
  assert.equal(t.last(), 'signal-lost');
});

check('after sleep, a dropped strap is reconnected without waiting for the backoff', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.drop();
  for (let i = 0; i < 4; i++) { t.timers.advance(30000); t.driver.refuse(); }
  const before = t.driver.connects();
  t.manager.onResume();
  t.timers.advance(2000);
  assert.equal(t.driver.connects(), before + 1);
});

check('Bluetooth switched back on reconnects right away', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.status('ble-unavailable', { reason: 'poweredOff' });
  assert.equal(t.last(), 'reconnecting');
  t.driver.status('ble-ready');
  t.timers.advance(0);
  assert.equal(t.driver.connects(), 2);
});

check('stopping a scan does not hide a connected strap', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.beat();
  t.manager.startScan();
  t.driver.status('scanning');
  t.driver.status('idle');
  assert.equal(t.last(), 'connected');
  t.timers.advance(15000);
  assert.equal(t.last(), 'signal-lost', 'the watchdog kept running during the scan');
});

check('switching auto-reconnect on picks up a strap that dropped earlier', () => {
  const t = setup({ autoReconnect: false });
  t.manager.start();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.drop();
  assert.equal(t.last(), 'disconnected');
  t.manager.setAutoReconnect(true);
  t.timers.advance(3000);
  assert.equal(t.driver.connects(), 2);
  assert.equal(t.stored.autoReconnect, true);
});

check('the same auto-reconnect value sent again changes nothing', () => {
  const t = setup({ device: strap, active: false });
  t.manager.start();
  t.manager.setAutoReconnect(true);
  t.timers.advance(60000);
  assert.equal(t.driver.connects(), 0);
});

check('diagnostics name the state and the recent steps, not the full device address', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.drop();
  const text = t.manager.diagnostics();
  assert.match(text, /state: reconnecting/);
  assert.match(text, /connected to Polar H10/);
  assert.match(text, /reconnect attempt 1/);
  assert.ok(!text.includes(strap.id), 'only the last characters of the address');
  assert.match(text, /…A:3C/);
});

check('a connection that never sends a measurement is rebuilt after 10 seconds', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.timers.advance(5000);
  assert.ok(!t.driver.calls.includes('drop'));
  t.timers.advance(5000);
  assert.ok(t.driver.calls.includes('drop'), 'rebuilt at 10s, not after 30s');
  assert.equal(t.last(), 'reconnecting');
});

check('connections that keep delivering nothing back off instead of hammering the strap', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  const waits = [];
  for (let i = 0; i < 4; i++) {
    t.driver.accept();
    t.timers.advance(10000);                     // no measurement: rebuilt
    const at = t.timers.now();
    const before = t.driver.connects();
    while (t.driver.connects() === before) t.timers.advance(500);
    waits.push(t.timers.now() - at);
  }
  assert.deepEqual(waits, [3000, 6000, 12000, 15000]);
});

check('measurements without skin contact show "no contact" and keep the connection', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  for (let i = 0; i < 60; i++) { t.timers.advance(1000); t.driver.packet(0, false); }
  assert.equal(t.last(), 'no-contact');
  assert.equal(t.lost, 1);
  assert.ok(!t.driver.calls.includes('drop'), 'a strap that is sending is not torn down');
  assert.deepEqual(t.bpms, []);
});

check('skin contact coming back brings the heart rate back', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  for (let i = 0; i < 20; i++) { t.timers.advance(1000); t.driver.packet(0, false); }
  assert.equal(t.last(), 'no-contact');
  t.driver.packet(88, true);
  assert.equal(t.last(), 'connected');
  assert.deepEqual(t.bpms, [88]);
});

check('a strap that stops sending entirely is rebuilt after 30 seconds of silence', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.packet(90, true);
  t.timers.advance(15000);
  assert.equal(t.last(), 'signal-lost');
  t.timers.advance(15000);
  assert.ok(t.driver.calls.includes('drop'));
});

check('diagnostics show how many measurements the connection delivered', () => {
  const t = setup();
  t.manager.connect(strap.id, strap.name);
  t.driver.accept();
  t.driver.packet(0, false);
  t.driver.packet(0, false);
  const text = t.manager.diagnostics();
  assert.match(text, /measurements on this connection: 2 \(last one without skin contact\)/);
  assert.match(text, /first measurement: 0 BPM, skin contact no/);
});

// ── Battery and reception ──
{
  const { createBleManager, barsFromRssi, barsFromRate } = require('../src/ble-manager');
  const chk = (n, ok, i = '') => console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${i}`);
  let now = 0; const jobs = [];
  const timers = { now: () => now, setTimeout: (fn, ms) => { jobs.push({ fn, at: now + ms }); return jobs.length; }, clearTimeout: () => {},
    setInterval: (fn, ms) => { jobs.push({ fn, at: now + ms, every: ms }); return jobs.length; }, clearInterval: (i) => { if (jobs[i - 1]) jobs[i - 1].dead = true; } };
  const run = (ms) => { const end = now + ms; for (;;) { const j = jobs.filter(x => !x.dead && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!j) break; now = j.at; if (j.every) j.at += j.every; else j.dead = true; j.fn(); } now = end; };
  let cb = {}; const seen = [];
  const driver = { init: (c) => { cb = c; }, setAutoReconnect: () => {}, connect: () => {}, disconnect: () => {}, startScan: () => {}, stopScan: () => {} };
  const m = createBleManager({ driver, store: { get: () => ({}), set: () => {} }, emit: () => {}, onBpm: () => {}, onVitals: (v) => seen.push(v), timers });
  m.connect('strap-1', 'Polar H10');
  cb.onStatus('connected', { name: 'Polar H10' });
  chk('a connected strap reports its vitals, battery still unknown', seen.at(-1)?.battery === null, JSON.stringify(seen.at(-1)));
  cb.onBattery(64);
  chk('its battery is passed on', seen.at(-1)?.battery === 64, JSON.stringify(seen.at(-1)));
  for (let i = 0; i < 10; i++) { run(1000); cb.onPacket({ bpm: 80, contact: true }); cb.onBpm(80); }
  run(100);
  chk('without a signal strength, reception comes from regular measurements', seen.at(-1)?.bars === 4 && seen.at(-1)?.barsFrom === 'rate', JSON.stringify(seen.at(-1)));
  cb.onRssi(-84);
  chk('with a signal strength, reception comes from it', seen.at(-1)?.bars === 1 && seen.at(-1)?.rssi === -84 && seen.at(-1)?.barsFrom === 'rssi', JSON.stringify(seen.at(-1)));
  run(20000);
  chk('an old signal strength no longer counts, and missing measurements lower the bars', seen.at(-1)?.barsFrom === 'rate' && seen.at(-1)?.bars === 0, JSON.stringify(seen.at(-1)));
  m.disconnect();
  chk('disconnecting clears it', seen.at(-1) === null);
  chk('bars from signal strength and from the share of measurements',
    barsFromRssi(-55) === 4 && barsFromRssi(-75) === 2 && barsFromRssi(-95) === 0 && barsFromRate(1) === 4 && barsFromRate(0.5) === 2 && barsFromRate(0) === 0);
}
