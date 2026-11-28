// Steam achievements: which ones there are and when each is earned. The app reports what
// happens (a heartbeat, the overlay showing, a game moment, ...) and this module decides what
// that unlocks. It knows nothing about Steam: src/steam.js hands it a store that unlocks and
// keeps the two counters, and the GitHub build never creates one.
//
// The texts and icons for the Steamworks portal live in steam/achievements/.

/** Our id → its API name in the Steamworks portal. Order is the order in the portal. */
const ACHIEVEMENTS = [
  'first_heartbeat', 'first_overlay', 'ble_direct', 'own_look', 'zones_set',
  'hours_1', 'hours_10', 'hours_100', 'hours_500', 'sessions_10', 'sessions_100', 'marathon', 'share_card',
  'first_moment', 'boss_down', 'ice_cold', 'close_call', 'pentakill',
  'discord_live', 'vrchat_live', 'smart_home', 'addon_first',
  'heart_christmas', 'heart_new_year',
].map((id) => ({ id, api: id.toUpperCase() }));

/** Counters kept by Steam (integers), so it can show the progress. */
const STATS = { minutes: 'stat_minutes', sessions: 'stat_sessions' };

const HOURS = [[1, 'hours_1'], [10, 'hours_10'], [100, 'hours_100'], [500, 'hours_500']];
const SESSIONS = [[10, 'sessions_10'], [100, 'sessions_100']];

const SAMPLE_MAX_MS = 10_000;           // a heartbeat counts for the time since the last one, at most this much
const SESSION_GAP_MS = 5 * 60_000;      // silence that ends a session (as src/sessions.js)
const SESSION_MIN_MS = 3 * 60_000;      // shorter is putting the strap on to try something
const MARATHON_MS = 4 * 60 * 60_000;
const ICE_COLD_RISE = 10;               // BPM a boss kill may raise the heart rate at most
const CLOSE_CALL_PCT = 5;               // health left, in percent, below which a survival counts
const STORE_EVERY_MS = 5 * 60_000;      // how often the counters are sent to Steam

/**
 * store: { unlock(api) → boolean, getStat(name) → number|null, setStat(name, value), save() }
 */
function createAchievements(store, { now = () => Date.now() } = {}) {
  const done = new Set();
  let minutes = Math.max(0, store.getStat(STATS.minutes) ?? 0);
  let sessions = Math.max(0, store.getStat(STATS.sessions) ?? 0);
  let pendingMs = 0;
  let run = null;           // { startedAt, lastAt, counted }
  let dirty = false, savedAt = now();

  function unlock(id) {
    if (done.has(id)) return false;
    done.add(id);
    return store.unlock(id.toUpperCase());
  }

  function save(force = false) {
    if (!dirty || (!force && now() - savedAt < STORE_EVERY_MS)) return;
    store.setStat(STATS.minutes, minutes);
    store.setStat(STATS.sessions, sessions);
    store.save();
    dirty = false;
    savedAt = now();
  }

  function checkCounters() {
    for (const [hours, id] of HOURS) if (minutes >= hours * 60) unlock(id);
    for (const [count, id] of SESSIONS) if (sessions >= count) unlock(id);
  }
  checkCounters();   // earned before (another computer, a crash before unlocking)

  function heartbeat(bpm, source, t = now()) {
    if (!Number.isFinite(bpm) || bpm <= 0) return;
    unlock('first_heartbeat');
    if (source === 'ble') unlock('ble_direct');

    const day = new Date(t);
    if (day.getMonth() === 11 && (day.getDate() === 24 || day.getDate() === 25)) unlock('heart_christmas');
    if (day.getMonth() === 0 && day.getDate() === 1 && day.getHours() === 0 && day.getMinutes() < 15) unlock('heart_new_year');

    if (!run || t - run.lastAt > SESSION_GAP_MS) {
      run = { startedAt: t, lastAt: t, counted: false };
    } else {
      pendingMs += Math.min(Math.max(0, t - run.lastAt), SAMPLE_MAX_MS);
      run.lastAt = t;
    }
    if (pendingMs >= 60_000) {
      const whole = Math.floor(pendingMs / 60_000);
      minutes += whole;
      pendingMs -= whole * 60_000;
      dirty = true;
    }
    // A session counts once it is long enough, not when it ends: a crash must not lose it
    if (!run.counted && run.lastAt - run.startedAt >= SESSION_MIN_MS) {
      run.counted = true;
      sessions += 1;
      dirty = true;
    }
    if (run.lastAt - run.startedAt >= MARATHON_MS) unlock('marathon');
    checkCounters();
    save();
  }

  /** A game moment as main.js emits it (moments.build for WoW, { game, card } for LoL). */
  function moment(m) {
    if (!m || m.test) return;
    unlock('first_moment');
    if (m.game === 'wow' && m.type === 'boss') {
      unlock('boss_down');
      if (Number.isFinite(m.hrIncrease) && m.hrIncrease < ICE_COLD_RISE) unlock('ice_cold');
    }
    if (m.game === 'wow' && m.type === 'close' && Number.isFinite(m.lowestHealthPct) && m.lowestHealthPct < CLOSE_CALL_PCT) {
      unlock('close_call');
    }
    if (m.game === 'lol' && m.card?.style === 'penta') unlock('pentakill');
  }

  // Things that only happen once to count
  const EVENTS = {
    overlay: 'first_overlay', look: 'own_look', zones: 'zones_set', card: 'share_card',
    discord: 'discord_live', osc: 'vrchat_live', mqtt: 'smart_home', addon: 'addon_first',
  };
  function event(name) {
    if (EVENTS[name]) unlock(EVENTS[name]);
  }

  return {
    heartbeat, moment, event,
    /** Before quitting: the last minutes go to Steam. */
    flush: () => save(true),
    get counters() { return { minutes, sessions }; },
  };
}

/** Whether a saved overlay config uses something of the user's own (heart, font, look). */
function usesOwnLook(config) {
  return /hr-asset:\/\//.test(JSON.stringify(config ?? null));
}

module.exports = { ACHIEVEMENTS, STATS, createAchievements, usesOwnLook };
