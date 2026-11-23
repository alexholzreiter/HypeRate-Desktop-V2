// Bluetooth connection manager, shared by the macOS (noble) and Windows (WinRT helper) drivers.
//
// The drivers only scan, connect, disconnect and report what happens. Everything that decides
// how a connection survives lives here, once, so it behaves the same on every platform:
//
//   - the last strap is remembered and connected again when the app starts
//   - after a drop it reconnects on its own, waiting a little longer after each failed attempt
//   - a strap that stays connected but sends nothing is noticed: first "signal lost",
//     then the connection is dropped and rebuilt
//   - after sleep, or when Bluetooth comes back on, the connection is checked straight away
//   - every step is logged, and the log can be copied for support
//
// Linux still connects through Web Bluetooth in the settings window (see preload.js) and does
// not go through this module.

const DEFAULTS = {
  // Wait before attempt 1, 2, 3 … (the last value repeats). Capped at 15s: a strap carried back
  // into range should not wait half a minute for the next try.
  backoffMs: [3000, 6000, 12000, 15000],
  startDelayMs: 1500,      // give the Bluetooth stack a moment after launch
  resumeDelayMs: 2000,     // and after waking up
  watchdogEveryMs: 5000,
  firstPacketMs: 10000,    // a fresh connection that has not sent a single measurement is dead
  stallAfterMs: 15000,     // no heart rate for this long: "signal lost" (or "no skin contact")
  dropAfterMs: 30000,      // no measurement at all for this long: drop and build it again
  logLines: 300,
};

function createBleManager({
  driver,
  store,                    // { get() -> { device, active, autoReconnect }, set(patch) }
  emit,                     // (state, extra) -> status for the settings window and the rest of main
  onDeviceFound = () => {}, // (id, name, rssi) while scanning
  onBpm,                    // (bpm)
  onSignalLost = () => {},  // heart rate went quiet while still connected
  writeLog = () => {},      // (line) -> persist a log line, e.g. to a file
  meta = {},                // { platform, version } for the diagnostics header
  timers = { setTimeout, clearTimeout, setInterval, clearInterval, now: () => Date.now() },
  options = {},
}) {
  const o = { ...DEFAULTS, ...options };

  let state = 'idle';         // what the settings window shows
  let stateExtra = {};
  let link = null;            // the connection itself: 'connected', 'signal-lost', 'no-contact' or
                              // null. Kept apart from `state`, which also shows a scan in progress.
  let connectedAt = 0;
  let packets = 0;            // measurements since this connection came up, valid or not
  let lastPacketAt = 0;
  let lastPacketEmpty = false; // the last measurement had no usable heart rate (no skin contact)
  let device = null;          // { id, name } of the strap to keep connected
  let autoReconnect = true;
  let userDisconnected = false;
  let attempt = 0;            // failed attempts since the last good connection
  let reconnectTimer = null;
  let connecting = false;     // a connect is under way
  let automatic = false;      // … and it was started by this module, not by the user
  let watchdog = null;
  let lastBpmAt = 0;
  let lastBpm = null;
  const lines = [];

  function log(message) {
    const line = `${new Date(timers.now()).toISOString()} ${message}`;
    lines.push(line);
    if (lines.length > o.logLines) lines.shift();
    try { writeLog(line); } catch {}
  }

  function setState(next, extra = {}) {
    state = next;
    stateExtra = extra;
    emit(next, extra);
  }

  function persist(patch) {
    try { store.set(patch); } catch (error) { log(`could not save Bluetooth settings: ${error.message}`); }
  }

  const shouldReconnect = () => autoReconnect && !!device && !userDisconnected;
  const busy = () => !!link || connecting || !!reconnectTimer;

  function lostLink() {
    link = null;
    connecting = false;
    automatic = false;
    stopWatchdog();
  }

  // ── Reconnecting ──────────────────────────────────────────────────────────

  function clearReconnect() {
    if (reconnectTimer) timers.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function scheduleReconnect(reason, delayMs) {
    if (!shouldReconnect() || reconnectTimer) return;
    const wait = delayMs ?? o.backoffMs[Math.min(attempt, o.backoffMs.length - 1)];
    attempt++;
    log(`reconnect attempt ${attempt} to ${device.name} in ${Math.round(wait / 1000)}s (${reason})`);
    setState('reconnecting', { name: device.name, attempt, reason });
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      if (!shouldReconnect() || link) return;
      connecting = true;
      automatic = true;
      driver.connect(device.id, device.name);
    }, wait);
  }

  // ── Watching the heart rate ───────────────────────────────────────────────

  function startWatchdog() {
    stopWatchdog();
    watchdog = timers.setInterval(checkSignal, o.watchdogEveryMs);
  }

  function stopWatchdog() {
    if (watchdog) timers.clearInterval(watchdog);
    watchdog = null;
  }

  function rebuild(reason) {
    log(`${reason}, rebuilding the connection`);
    lostLink();
    try { driver.disconnect(true); } catch (error) { log(`disconnect failed: ${error.message}`); }
    scheduleReconnect(reason);
  }

  function checkSignal() {
    if (!link) return;
    const now = timers.now();
    const sinceBpm = now - lastBpmAt;
    const sincePacket = now - (lastPacketAt || connectedAt);

    // Connected, subscribed, and yet not one measurement: the subscription did not take
    if (packets === 0 && now - connectedAt >= o.firstPacketMs) {
      rebuild(`no measurement within ${Math.round(o.firstPacketMs / 1000)}s of connecting`);
      return;
    }
    // Nothing at all for a long time: the link is dead, whatever the driver believes
    if (sincePacket >= o.dropAfterMs) {
      rebuild(`no measurement for ${Math.round(sincePacket / 1000)}s`);
      return;
    }
    if (link === 'connected' && sinceBpm >= o.stallAfterMs) {
      // Measurements still arrive, just without a heart rate: the strap is not on the skin
      const noContact = sincePacket < o.stallAfterMs && lastPacketEmpty;
      link = noContact ? 'no-contact' : 'signal-lost';
      log(noContact
        ? `${device?.name} is sending, but without skin contact`
        : `no heart rate from ${device?.name} for ${Math.round(sinceBpm / 1000)}s`);
      if (state !== 'scanning') setState(link, { name: device?.name });
      onSignalLost();
    }
  }

  function onDriverPacket({ bpm, contact } = {}) {
    lastPacketAt = timers.now();
    lastPacketEmpty = !(bpm > 0) || contact === false;
    if (++packets === 1) {
      attempt = 0;   // only a connection that delivers counts as good
      log(`first measurement: ${bpm} BPM, skin contact ${contact === null || contact === undefined ? 'not reported' : contact ? 'yes' : 'no'}`);
    }
  }

  // ── What the driver reports ───────────────────────────────────────────────

  function onDriverStatus(driverState, extra = {}) {
    switch (driverState) {
      case 'connected': {
        clearReconnect();
        connecting = false;
        automatic = false;
        userDisconnected = false;
        link = 'connected';
        connectedAt = timers.now();
        packets = 0;
        lastPacketAt = 0;
        lastPacketEmpty = false;
        if (device && extra.name) device = { ...device, name: extra.name };
        if (device) persist({ device, active: true });
        lastBpmAt = timers.now();
        log(`connected to ${extra.name || device?.name}`);
        setState('connected', { name: extra.name || device?.name });
        startWatchdog();
        break;
      }
      case 'disconnected':
        lostLink();
        log(`disconnected${extra.reason ? ` (${extra.reason})` : ''}`);
        if (shouldReconnect()) scheduleReconnect(extra.reason || 'connection dropped');
        else if (!reconnectTimer) setState('disconnected', extra);
        break;
      case 'connect-error':
        lostLink();
        log(`connect failed: ${extra.reason || 'unknown reason'}`);
        if (shouldReconnect()) scheduleReconnect(extra.reason || 'connect failed');
        else setState('connect-error', extra);
        break;
      case 'ble-unavailable':
        lostLink();
        log(`Bluetooth unavailable${extra.reason ? `: ${extra.reason}` : ''}`);
        setState('ble-unavailable', extra);
        if (shouldReconnect()) scheduleReconnect(extra.reason || 'Bluetooth unavailable');
        break;
      case 'ble-ready':
        log('Bluetooth is on');
        if (shouldReconnect() && !link && !connecting) {
          clearReconnect();
          scheduleReconnect('Bluetooth came back', 0);
        } else if (state === 'ble-unavailable') {
          setState('idle');
        }
        break;
      case 'connecting':
        connecting = true;
        // An automatic attempt keeps saying "reconnecting" instead of flickering to "connecting"
        if (automatic) setState('reconnecting', { name: device?.name, attempt });
        else setState('connecting', extra);
        break;
      case 'idle':
        // Stopping a scan says "idle", even while a strap is connected
        if (link) setState(link, { name: device?.name });
        else if (reconnectTimer || connecting) setState('reconnecting', { name: device?.name, attempt });
        else setState('idle', extra);
        break;
      default:
        // scanning, scan-error, reconnecting (the Windows driver retries discovery once)
        setState(driverState, extra);
    }
  }

  function onDriverBpm(bpm) {
    // The Windows helper only reports usable values; each one is a measurement as well
    if (!driverReportsPackets) onDriverPacket({ bpm, contact: null });
    else lastPacketEmpty = false;
    lastBpmAt = timers.now();
    lastBpm = bpm;
    if (link === 'signal-lost' || link === 'no-contact') {
      link = 'connected';
      log(`heart rate is back (${bpm} BPM)`);
      if (state !== 'scanning') setState('connected', { name: device?.name });
    }
    onBpm(bpm);
  }

  let driverReportsPackets = false;
  driver.init({
    onDeviceFound,
    onStatus: onDriverStatus,
    onBpm: onDriverBpm,
    onPacket: (packet) => { driverReportsPackets = true; onDriverPacket(packet); },
  });
  // The drivers still carry their own reconnect logic from before; this module owns it now.
  driver.setAutoReconnect(false);

  // ── What the app asks for ─────────────────────────────────────────────────

  return {
    start() {
      const saved = store.get() || {};
      autoReconnect = saved.autoReconnect !== false;
      device = saved.device?.id ? { id: saved.device.id, name: saved.device.name || 'HR Monitor' } : null;
      userDisconnected = saved.active === false;   // disconnected by hand last time: leave it be
      log(`start: ${meta.platform || process.platform} ${meta.version || ''}, auto-reconnect ${autoReconnect ? 'on' : 'off'}, remembered ${device ? device.name : 'none'}`);
      if (device && saved.active && autoReconnect) scheduleReconnect('app started', o.startDelayMs);
    },

    startScan() { log('scan started'); driver.startScan(); },
    stopScan(opts) { log('scan stopped'); driver.stopScan(opts); },

    connect(id, name) {
      clearReconnect();
      attempt = 0;
      userDisconnected = false;
      connecting = true;
      automatic = false;
      device = { id, name: name || 'HR Monitor' };
      persist({ device, active: true });
      log(`connect to ${device.name} (chosen in settings)`);
      driver.connect(id, name);
    },

    disconnect() {
      userDisconnected = true;
      clearReconnect();
      lostLink();
      persist({ active: false });
      log('disconnected in settings');
      driver.disconnect();
      setState('disconnected');
    },

    setAutoReconnect(enabled) {
      if (!!enabled === autoReconnect) return;   // the settings window repeats it on every load
      autoReconnect = !!enabled;
      persist({ autoReconnect });
      log(`auto-reconnect ${autoReconnect ? 'on' : 'off'}`);
      if (!autoReconnect) {
        if (reconnectTimer) { clearReconnect(); setState('disconnected'); }
      } else if (!busy()) {
        scheduleReconnect('auto-reconnect switched on');
      }
    },

    // After sleep or unlock: an old connection may be dead without anyone having said so.
    onResume() {
      log('system woke up');
      if (link) {
        // Let the watchdog decide quickly: no heart rate within a few seconds means it is gone
        lastBpmAt = Math.min(lastBpmAt, timers.now() - o.stallAfterMs + o.resumeDelayMs * 2);
      } else if (shouldReconnect() && !connecting) {
        clearReconnect();
        attempt = 0;
        scheduleReconnect('system woke up', o.resumeDelayMs);
      }
    },

    snapshot() { return { state, ...stateExtra }; },

    diagnostics() {
      const quiet = lastBpm != null ? Math.round((timers.now() - lastBpmAt) / 1000) + 's ago' : 'none received';
      return [
        'HypeRate Desktop – Bluetooth diagnostics',
        `platform: ${meta.platform || process.platform}  version: ${meta.version || '?'}`,
        `state: ${state}  link: ${link || 'none'}  auto-reconnect: ${autoReconnect ? 'on' : 'off'}  failed attempts: ${attempt}`,
        `device: ${device ? `${device.name} (…${String(device.id).slice(-4)})` : 'none'}`,
        `last heart rate: ${lastBpm ?? '-'} BPM, ${quiet}`,
        `measurements on this connection: ${link ? packets : '-'}${link && lastPacketEmpty ? ' (last one without skin contact)' : ''}`,
        '',
        ...lines,
      ].join('\n');
    },
  };
}

module.exports = { createBleManager, DEFAULTS };
