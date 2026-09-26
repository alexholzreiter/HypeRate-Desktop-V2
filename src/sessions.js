// Records a heart rate session and the game moments inside it.
//
// A session starts with the first heart rate and ends after a stretch of silence, because
// nobody wants to press record before a raid. Samples are stored one per second, indexed
// from the start, which keeps a two hour session at about 30 kB instead of 200.
//
// This writes health data to disk, so it is off unless switched on, sessions expire, and
// there is one call that removes everything.

const fs = require('fs');
const path = require('path');
const moments = require('./moments');

const CHECK_MS = 15000;    // how often we look whether the current session has gone quiet
const FLUSH_MS = 30000;    // a crash may cost this much of the current session

let dir = null, onChange = null, timer = null;
let options = {
  enabled: false,
  endAfterMs: 5 * 60 * 1000,
  minLengthMs: 3 * 60 * 1000,
  keepDays: 90,
  zones: [],
};

let current = null;        // { startedAt, lastAt, bpm: [], events: [], dirty }

// ── Storage ──────────────────────────────────────────────────────────────────
const file = (startedAt) => path.join(dir, `${startedAt}.json`);

function writeFile(session) {
  fs.mkdirSync(dir, { recursive: true });
  const target = file(session.startedAt);
  const tmp = target + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({
    v: 1,
    startedAt: session.startedAt,
    endedAt: session.lastAt,
    game: dominantGame(session.events),
    zones: session.zones,
    bpm: session.bpm,                                  // one entry per second, null for gaps
    events: session.events,                            // t is seconds since startedAt
  }));
  fs.renameSync(tmp, target);                          // never leave a half written file behind
}

// A session can span both games; the one with more moments names it
function dominantGame(events) {
  const zaehler = {};
  for (const e of events) if (e.game) zaehler[e.game] = (zaehler[e.game] || 0) + 1;
  const beste = Object.entries(zaehler).sort((a, b) => b[1] - a[1])[0];
  return beste ? beste[0] : null;
}

// ── Recording ────────────────────────────────────────────────────────────────
function recordBpm(bpm, now = Date.now()) {
  if (!options.enabled || !Number.isFinite(bpm) || bpm <= 0) return;
  if (!current) {
    current = { startedAt: now, lastAt: now, bpm: [], events: [], zones: options.zones, dirty: false };
    onChange?.('started');
  }
  const i = Math.floor((now - current.startedAt) / 1000);
  if (i < 0) return;
  while (current.bpm.length < i) current.bpm.push(null);   // a gap stays a gap
  current.bpm[i] = bpm;
  current.lastAt = now;
  current.dirty = true;
}

function recordMoment(moment, now = Date.now()) {
  if (!options.enabled || !current) return;              // no heart rate, no session to attach to
  const m = moments.describe(moment);
  if (!m) return;
  current.events.push({
    t: Math.round((now - current.startedAt) / 1000),
    style: m.style, type: m.type, game: m.game, title: m.title, detail: m.detail, bpm: m.bpm,
  });
  current.dirty = true;
}

// ── Boundaries ───────────────────────────────────────────────────────────────
// Called on a timer. Closes the session once it has been quiet for long enough.
function check(now = Date.now()) {
  if (!current) return;
  if (now - current.lastAt >= options.endAfterMs) { close(); return; }
  // Nothing is written before the session is worth keeping. Otherwise a crash leaves a
  // one-sample file behind that close() would have thrown away.
  if (current.dirty && current.lastAt - current.startedAt >= options.minLengthMs) {
    writeFile(current);
    current.dirty = false;
  }
}

function close() {
  if (!current) return;
  const dauer = current.lastAt - current.startedAt;
  const startedAt = current.startedAt;
  if (dauer < options.minLengthMs) {
    // Strap put on for a minute to test something: not a session
    try { fs.unlinkSync(file(startedAt)); } catch {}
    current = null;
    onChange?.('discarded');
    return;
  }
  writeFile(current);
  current = null;
  prune();
  onChange?.('ended', startedAt);
}

// ── Reading ──────────────────────────────────────────────────────────────────
function files() {
  try { return fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)); } catch { return []; }
}

function read(startedAt) {
  try { return JSON.parse(fs.readFileSync(file(startedAt), 'utf8')); } catch { return null; }
}

// Summaries for the settings list, newest first. Never loads a whole session into the answer.
function list() {
  return files().map(f => {
    const s = read(Number(path.basename(f, '.json')));
    if (!s) return null;
    const werte = s.bpm.filter(b => b != null);
    if (!werte.length) return null;
    return {
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      game: s.game,
      minutes: Math.round((s.endedAt - s.startedAt) / 60000),
      avg: Math.round(werte.reduce((a, b) => a + b, 0) / werte.length),
      peak: Math.max(...werte),
      events: s.events.length,
    };
  }).filter(Boolean).sort((a, b) => b.startedAt - a.startedAt);
}

function prune(now = Date.now()) {
  if (!options.keepDays) return;
  const grenze = now - options.keepDays * 24 * 60 * 60 * 1000;
  for (const f of files()) {
    if (Number(path.basename(f, '.json')) < grenze) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  }
}

function deleteAll() {
  current = null;
  for (const f of files()) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
  onChange?.('cleared');
}

// ── Setup ────────────────────────────────────────────────────────────────────
function init(config = {}) {
  dir = config.dir;
  onChange = config.onChange;
  clearInterval(timer);
  timer = setInterval(() => check(), CHECK_MS);
  if (timer.unref) timer.unref();
  prune();
  dropTooShort();          // leftovers from a version that wrote them, or from a hard kill
}

function dropTooShort() {
  for (const f of files()) {
    const s = read(Number(path.basename(f, '.json')));
    if (s && s.endedAt - s.startedAt < options.minLengthMs) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  }
}

function setOptions(next = {}) {
  const war = options.enabled;
  options = { ...options, ...next };
  if (war && !options.enabled) close();      // switching off keeps what is already recorded
}

// Closing the app should not lose the last half minute
function stop() {
  clearInterval(timer);
  timer = null;
  if (current && current.lastAt - current.startedAt >= options.minLengthMs) writeFile(current);
  current = null;
}

module.exports = {
  init, setOptions, dropTooShort, recordBpm, recordMoment, check, close, list, read, deleteAll, prune, stop,
  get options() { return { ...options }; },
  get current() { return current ? { startedAt: current.startedAt, samples: current.bpm.length, events: current.events.length } : null; },
  FLUSH_MS, CHECK_MS,
};
