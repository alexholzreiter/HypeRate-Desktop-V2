// League of Legends integration — polls Riot's Live Client Data API (https://127.0.0.1:2999),
// which the game client itself provides. Read-only, nothing is installed into the game and
// there is nothing for the user to set up: the endpoint exists while a match is running.

const api = require('./api');
const { createTracker, DEFAULT_CARDS } = require('./tracker');

const POLL_MS       = 250;    // health resolution for close calls; one request per tick
const IDLE_POLL_MS  = 2000;   // no game running → don't hammer a closed port
const LOST_AFTER_MS = 8000;   // tolerate short hiccups (loading screen, alt-tab) before "waiting"

let onStatus = null, onCard = null;
let tracker = null, timer = null, options = null;
let inGame = false, lastOkAt = 0, lastStatusKey = '', lastError = null;
let game = {};   // { mode, champion, name }
let demoIndex = 0;

function init(callbacks = {}) {
  onStatus = callbacks.onStatus;
  onCard   = callbacks.onCard;
}

function start(opts = {}) {
  stop();
  options = { closeCallPct: Number(opts.closeCallPct) || 10, cards: { ...DEFAULT_CARDS, ...(opts.cards || {}) } };
  tracker = createTracker({ ...options, onCard: (card) => onCard?.(card) });
  inGame = false; lastOkAt = 0; lastStatusKey = ''; lastError = null; game = {};
  schedule(0);
  emitStatus(true);
}

function stop() {
  clearTimeout(timer);
  timer = null; tracker = null; options = null; inGame = false; game = {};
}

function setOptions(opts = {}) {
  if (!options) return;
  if (opts.closeCallPct !== undefined) options.closeCallPct = Number(opts.closeCallPct) || 10;
  if (opts.cards) options.cards = { ...options.cards, ...opts.cards };
  tracker?.setOptions(options);
}

function schedule(ms) {
  clearTimeout(timer);
  if (options) timer = setTimeout(poll, ms);
}

async function poll() {
  if (!options) return;
  const started = Date.now();
  try {
    const raw = await api.allGameData();
    const snap = api.snapshot(raw);
    lastError = null;
    // The endpoint already answers during champion select and the loading screen, but without
    // a player — only a payload that actually has one counts as a running match.
    if (snap.me) {
      lastOkAt = Date.now();
      if (!inGame) {                    // new match → forget the previous one
        inGame = true;
        tracker.reset();
      }
      game = { mode: snap.gameMode, champion: snap.me.champion, name: snap.me.name };
      tracker.feed(snap, lastOkAt);
    } else if (inGame && Date.now() - lastOkAt > LOST_AFTER_MS) {
      inGame = false; game = {};
    }
  } catch (err) {
    // ECONNREFUSED is the normal "no match running" answer, everything else is worth remembering
    lastError = err.code === 'ECONNREFUSED' ? null : err.code || err.message;
    if (inGame && Date.now() - lastOkAt > LOST_AFTER_MS) { inGame = false; game = {}; }
  }
  emitStatus();
  schedule(Math.max(0, (inGame ? POLL_MS : IDLE_POLL_MS) - (Date.now() - started)));
}

// 'waiting' (no match running) | 'active' (reading a live match) | 'error'
function emitStatus(force = false) {
  if (!options) return;
  const state = inGame ? 'active' : lastError ? 'error' : 'waiting';
  const extra = { mode: game.mode || null, champion: game.champion || null, error: lastError };
  const key = state + JSON.stringify(extra);
  if (!force && key === lastStatusKey) return;
  lastStatusKey = key;
  onStatus?.(state, extra);
}

// Preview cards for the settings panel — same shapes the tracker produces
const DEMO_CARDS = [
  { game: 'lol', style: 'penta', title: 'Pentakill', kicker: 'Jinx', stats: [
    { icon: 'heart', value: '178 BPM', label: 'Peak' }, { icon: 'swords', value: '5', label: 'Kills in a row' }, { icon: 'clock', value: '24:18', label: 'Game time' } ] },
  { game: 'lol', style: 'close', title: 'Close Call', kicker: 'Survived', stats: [
    { icon: 'heart', value: '166 BPM', label: 'Peak' }, { icon: 'drop', value: '4%', label: 'Health left' }, { icon: 'clock', value: '0:21', label: 'Fight duration' } ] },
  { game: 'lol', style: 'death', title: 'You Died', kicker: 'vs. Lee Sin', stats: [
    { icon: 'heart', value: '171 BPM', label: 'Peak' }, { icon: 'arrow', value: '+46 BPM', label: 'HR increase' }, { icon: 'clock', value: '12:04', label: 'Game time' } ] },
  { game: 'lol', style: 'steal', title: 'Baron Stolen', kicker: 'Jinx', stats: [
    { icon: 'heart', value: '182 BPM', label: 'Peak' }, { icon: 'bolt', value: 'Stolen', label: 'Objective' }, { icon: 'clock', value: '31:47', label: 'Game time' } ] },
  { game: 'lol', style: 'objective', title: 'Dragon Slain', kicker: 'Infernal Dragon', stats: [
    { icon: 'heart', value: '154 BPM', label: 'Peak' }, { icon: 'dragon', value: 'Secured', label: 'Objective' }, { icon: 'clock', value: '18:33', label: 'Game time' } ] },
  { game: 'lol', style: 'firstblood', title: 'First Blood', kicker: 'Jinx', stats: [
    { icon: 'heart', value: '149 BPM', label: 'Peak' }, { icon: 'drop', value: 'First', label: 'Blood' }, { icon: 'clock', value: '3:52', label: 'Game time' } ] },
  { game: 'lol', style: 'win', title: 'Victory', kicker: 'Jinx', stats: [
    { icon: 'heart', value: '184 BPM', label: 'Match peak' }, { icon: 'swords', value: '14/3/9', label: 'K/D/A' }, { icon: 'clock', value: '32:15', label: 'Match time' } ] },
];

function demoCard(style) {
  if (style) return DEMO_CARDS.find((c) => c.style === style) || DEMO_CARDS[0];
  return DEMO_CARDS[demoIndex++ % DEMO_CARDS.length];
}

module.exports = { init, start, stop, setOptions, demoCard, DEMO_CARDS, DEFAULT_CARDS };
