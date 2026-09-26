// World of Warcraft integration — follows the newest WoWCombatLog*.txt of any game flavor
// (_retail_, _classic_, _classic_era_, …) and reports fight results.
//
// WoW writes the log in ~49 KB blocks: in groups that is every few seconds, solo it can take minutes.
// Results that arrive fresh (≤ LIVE_MAX_AGE_MS) are shown live; stale ones only feed session stats,
// and a slow block shows a session insight card instead (see insights.js).

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { createTracker } = require('./tracker');
const { parseLine }     = require('./parser');
const { createInsights, DEMO_CARDS } = require('./insights');

const POLL_MS        = 1000;
const STALE_MS       = 30 * 60 * 1000;    // log untouched longer than this → assume /combatlog is off
const MAX_READ_BYTES = 4 * 1024 * 1024;   // per poll, keeps the main process responsive
const LOG_FILE_RE    = /^WoWCombatLog.*\.txt$/i;
const DIAG_MAX_LINES = 400;
const LIVE_MAX_AGE_MS = 20 * 1000;        // older results/blocks are too late to show as live events

let onStatus = null, onResult = null, onInsight = null, diagPath = null;
let insights = createInsights();
let options  = null;  // { path, closeCallPct, cards }
let timer    = null;
let tracker  = null;
let current  = null;  // { file, offset, partial: Buffer, mtimeMs }
let knownAtStart = new Map(); // file → size when watching started (existing logs are read from their end)
let lastStatusKey = '';
let info = {};
let diagLines = 0, unparsedLogged = 0, blocksLogged = 0, demoIndex = 0;

function init(callbacks) {
  onStatus  = callbacks.onStatus;
  onResult  = callbacks.onResult;
  onInsight = callbacks.onInsight;
  diagPath  = callbacks.diagnosticsPath || null;
  const sessionsPath = callbacks.sessionsPath;
  insights = createInsights({
    load: () => (sessionsPath && fs.existsSync(sessionsPath) ? JSON.parse(fs.readFileSync(sessionsPath, 'utf8')) : {}),
    save: (data) => { if (sessionsPath) fs.writeFileSync(sessionsPath, JSON.stringify(data)); },
  });
}

// ── Paths ────────────────────────────────────────────────────────────────────
const FLAVOR_DIR_RE = /^_.+_$/; // _retail_, _classic_, _classic_era_, _anniversary_, _ptr_, …

function isWowInstall(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some(e => e.isDirectory() && FLAVOR_DIR_RE.test(e.name));
  } catch { return false; }
}

// Battle.net's agent database (protobuf) stores every game's install folder as plain text,
// so scan it for path-like strings and keep the ones that contain WoW flavor folders.
function installsFromBattleNet() {
  const db = process.platform === 'win32'
    ? path.join(process.env.ProgramData || 'C:\\ProgramData', 'Battle.net', 'Agent', 'product.db')
    : process.platform === 'darwin' ? '/Users/Shared/Battle.net/Agent/product.db' : null;
  if (!db) return [];
  let raw;
  try { raw = fs.readFileSync(db).toString('latin1'); } catch { return []; }
  const found = new Set();
  for (const m of raw.matchAll(/(?:[A-Za-z]:[\\/]|\/)[^\x00-\x1f\x7f]+/g)) {
    // Protobuf strings are length-prefixed (varint) — use it so a following printable tag byte isn't included
    const b1 = raw.charCodeAt(m.index - 1), b0 = raw.charCodeAt(m.index - 2);
    const len = b0 & 0x80 ? (b0 & 0x7f) | (b1 << 7) : b1;
    const candidates = len > 0 && len < m[0].length ? [m[0].slice(0, len), m[0]] : [m[0]];
    for (const c of candidates) {
      const p = path.normalize(Buffer.from(c, 'latin1').toString('utf8'));
      if (isWowInstall(p)) { found.add(p); break; }
    }
  }
  return [...found];
}

function defaultPath() {
  const home = os.homedir();
  const common = process.platform === 'win32'
    ? ['C:\\Program Files (x86)\\World of Warcraft', 'C:\\Program Files\\World of Warcraft',
       'D:\\World of Warcraft', 'D:\\Games\\World of Warcraft', 'D:\\Program Files (x86)\\World of Warcraft']
    : process.platform === 'darwin'
      ? ['/Applications/World of Warcraft', path.join(home, 'Applications/World of Warcraft')]
      : [path.join(home, 'Games/world-of-warcraft/drive_c/Program Files (x86)/World of Warcraft')];
  return installsFromBattleNet()[0] || common.find(isWowInstall) || common[0];
}

// Accepts the install folder, a flavor folder (_retail_) or a Logs folder directly
function logDirs(root) {
  const dirs = [root, path.join(root, 'Logs')];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && /^_.+_$/.test(entry.name)) dirs.push(path.join(root, entry.name, 'Logs'));
    }
  } catch {}
  return dirs.filter(d => { try { return fs.statSync(d).isDirectory(); } catch { return false; } });
}

function listLogs(root) {
  const logs = [];
  for (const dir of logDirs(root)) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!LOG_FILE_RE.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (st.isFile()) logs.push({ file, size: st.size, mtimeMs: st.mtimeMs });
      } catch {}
    }
  }
  return logs;
}

// ── Diagnostics (helps with log format differences we couldn't test against) ─
function diag(msg) {
  if (!diagPath || diagLines >= DIAG_MAX_LINES) return;
  diagLines++;
  try { fs.appendFileSync(diagPath, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

// ── Start / stop ─────────────────────────────────────────────────────────────
function start(opts) {
  stop();
  options = { path: opts.path || defaultPath(), closeCallPct: Number(opts.closeCallPct) || 10, cards: { ...(opts.cards || {}) } };
  diagLines = unparsedLogged = blocksLogged = 0;
  if (diagPath) { try { fs.writeFileSync(diagPath, ''); } catch {} }
  diag(`start platform=${process.platform} path="${options.path}" closeCall=${options.closeCallPct}%`);

  info = {};
  insights.setCloseCallPct(options.closeCallPct);
  insights.setCards(options.cards);
  tracker = createTracker({
    closeCallPct: options.closeCallPct,
    onResult: handleResult,
    onFight:  (f) => insights.addFight(tracker?.playerGUID, f),
    onKill:   (k) => insights.addKill(tracker?.playerGUID, k.at),
    onInfo: (i) => {
      Object.assign(info, i);
      if (i.version) diag(`COMBAT_LOG_VERSION ${i.version} build=${i.build}`);
      if (i.playerGUID) diag(`player detected ${i.playerGUID}`);
      if (i.advanced !== undefined) diag(`advanced logging ${i.advanced}`);
      emitStatus(true);
    },
    onUnparsed: (line) => { if (unparsedLogged++ < 30) diag(`unparsed: ${line.slice(0, 300)}`); },
  });

  knownAtStart = new Map(listLogs(options.path).map(l => [l.file, l.size]));
  diag(`log dirs: ${logDirs(options.path).join(' | ') || '(none)'}; existing logs: ${knownAtStart.size}`);
  current = null;
  lastStatusKey = '';
  poll();
  timer = setInterval(poll, POLL_MS);
}

function stop() {
  insights.flush();
  clearInterval(timer);
  timer = null;
  tracker = null;
  current = null;
  options = null;
}

function setOptions(opts) {
  if (!options) return;
  const nextPath = opts.path || defaultPath();
  if (nextPath !== options.path) { start({ ...options, ...opts, path: nextPath }); return; }
  if (opts.closeCallPct !== undefined) {
    options.closeCallPct = Number(opts.closeCallPct) || 10;
    tracker?.setCloseCallPct(options.closeCallPct);
    insights.setCloseCallPct(options.closeCallPct);
  insights.setCards(options.cards);
  }
}

// ── Polling ──────────────────────────────────────────────────────────────────
function poll() {
  if (!options) return;
  const now = Date.now();

  if (!fs.existsSync(options.path)) {
    emitStatus();
    return;
  }

  const logs = listLogs(options.path);
  const newest = logs.reduce((a, b) => (!a || b.mtimeMs > a.mtimeMs ? b : a), null);

  if (newest && newest.file !== current?.file) {
    // Existing file → continue from where it was when we started; new file (/combatlog) → from the top
    const offset = knownAtStart.has(newest.file) ? Math.min(knownAtStart.get(newest.file), newest.size) : 0;
    current = { file: newest.file, offset, partial: Buffer.alloc(0), mtimeMs: newest.mtimeMs };
    if (offset === 0) tracker.reset();
    else feedHeader(newest.file, offset); // joining mid-file: still learn whether advanced logging is on
    diag(`following ${newest.file} from byte ${offset}`);
  }

  if (current && newest) {
    current.mtimeMs = newest.mtimeMs;
    readAppended(newest.size, now);
  }
  tracker?.tick(now);
  emitStatus();
}

// Every /combatlog start writes a COMBAT_LOG_VERSION line (… ADVANCED_LOG_ENABLED,0|1 …).
// Classic appends to one file, so the relevant one is the last before `offset` —
// search backwards in chunks (bounded, logs can be huge).
const HEADER_CHUNK = 256 * 1024, HEADER_MAX_SCAN = 16 * 1024 * 1024;
const VERSION_TAG = Buffer.from('COMBAT_LOG_VERSION');

function feedHeader(file, offset) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    for (let end = offset; end > 0 && offset - end < HEADER_MAX_SCAN; end -= HEADER_CHUNK) {
      const start = Math.max(0, end - HEADER_CHUNK);
      const buf = Buffer.alloc(end - start + VERSION_TAG.length); // overlap so the tag can't be split
      const read = fs.readSync(fd, buf, 0, Math.min(buf.length, offset - start), start);
      const at = buf.subarray(0, read).lastIndexOf(VERSION_TAG);
      if (at === -1) continue;
      const lineStart = buf.lastIndexOf(0x0a, at) + 1;
      const lineEnd = buf.indexOf(0x0a, at);
      tracker.feed(buf.toString('utf8', lineStart, lineEnd === -1 ? read : lineEnd));
      return;
    }
  } catch (err) {
    diag(`header read error: ${err.message}`);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function readAppended(size, now) {
  if (size < current.offset) {        // truncated or replaced
    diag(`file shrank (${current.offset} → ${size}), restarting from top`);
    current.offset = 0;
    current.partial = Buffer.alloc(0);
    tracker.reset();
  }
  if (size === current.offset) return;

  const length = Math.min(size - current.offset, MAX_READ_BYTES);
  const chunk = Buffer.alloc(length);
  let fd;
  try {
    fd = fs.openSync(current.file, 'r');
    const read = fs.readSync(fd, chunk, 0, length, current.offset);
    current.offset += read;
    processChunk(read === length ? chunk : chunk.subarray(0, read), now);
  } catch (err) {
    diag(`read error: ${err.message}`);
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
  }
}

function processChunk(chunk, now) {
  // Split on newline bytes so multi-byte characters are never cut in half
  const data = current.partial.length ? Buffer.concat([current.partial, chunk]) : chunk;
  let pos = 0, nl, firstTime = null;
  while ((nl = data.indexOf(0x0a, pos)) !== -1) {
    const line = data.toString('utf8', pos, nl);
    pos = nl + 1;
    if (firstTime === null) firstTime = parseLine(line, now)?.time ?? null;
    tracker.feed(line, now);
  }
  current.partial = Buffer.from(data.subarray(pos));
  if (firstTime !== null) handleBlock(now - firstTime, now, firstTime);
}

// ── Live results vs. session insights ────────────────────────────────────────
function handleResult(r) {
  if (r.type === 'death') insights.addDeath(tracker?.playerGUID, r);
  const age = Date.now() - r.endedAt;
  if (age > LIVE_MAX_AGE_MS) {
    diag(`result arrived ${Math.round(age / 1000)}s late — stats only: ${JSON.stringify(r)}`);
    return;
  }
  if (options?.cards?.[r.type] === false) {
    diag(`result hidden by settings (${r.type})`);
    return;
  }
  diag(`result live: ${JSON.stringify(r)}`);
  insights.noteCardShown();
  onResult?.(r);
}

// ageMs = age of the oldest line WoW just wrote, i.e. how late this block's events arrive
function handleBlock(ageMs, now, since) {
  const slow = ageMs > LIVE_MAX_AGE_MS;
  if (blocksLogged < 20 || slow) { blocksLogged++; diag(`log block: oldest line ${Math.round(ageMs / 1000)}s old${slow ? ' (slow)' : ''}`); }
  const character = tracker?.playerGUID;
  if (!character) return;
  insights.touch(character, now, since);
  if (!slow) return;
  const card = insights.nextCard(now);
  if (card) {
    diag(`insight: ${card.style} ${JSON.stringify(card.stats.map(st => st.value))}`);
    onInsight?.(card);
  }
}

function demoInsight() {
  return DEMO_CARDS[demoIndex++ % DEMO_CARDS.length];
}

// ── Status ───────────────────────────────────────────────────────────────────
// 'no-folder' | 'waiting' (no log, or untouched for STALE_MS — /combatlog probably off) | 'active'
// WoW writes the log in ~49 KB blocks, so solo play can leave it unchanged for minutes while
// logging is on — "active" therefore goes by the file's last write, not by recently read data.
function emitStatus(force = false) {
  if (!options) return;
  let state;
  if (!fs.existsSync(options.path)) state = 'no-folder';
  else if (current && Date.now() - current.mtimeMs < STALE_MS) state = 'active';
  else state = 'waiting';

  const extra = {
    file: current ? path.basename(current.file) : null,
    advanced: info.advanced ?? null,
    lastWriteAt: current ? Math.round(current.mtimeMs) : null,
  };
  const key = state + JSON.stringify(extra);
  if (!force && key === lastStatusKey) return;
  lastStatusKey = key;
  onStatus?.(state, extra);
}

module.exports = { init, start, stop, setOptions, defaultPath, demoInsight };
