// Session insights — for solo play, where WoW writes the combat log minutes late and live
// result cards would be stale. Aggregates fights, kills and deaths per character session and
// hands out one card per slow log block, at most every MIN_CARD_GAP_MS.
// Cards only reappear with real news (see the `news` rule in each builder); Closest Call is the
// exception and may repeat. The same card never shows twice in a row within SAME_CARD_GAP_MS.

const moments = require('../../moments');

const SESSION_GAP_MS         = 30 * 60 * 1000; // no log activity this long → next data starts a new session
const MIN_CARD_GAP_MS        = 2 * 60 * 1000;
const SAME_CARD_GAP_MS       = 5 * 60 * 1000;
const NEWS_BPM_STEP          = 5;               // Most Intense Enemy: avg increase / highest must move this much
const NEWS_PEAK_STEP         = 3;               // Peak Heart Rate: new record by at least this much
const STREAK_MILESTONES      = [5, 10, 15, 25, 50, 75, 100, 150, 200, 300, 500];
const INTENSE_MIN_ENCOUNTERS = 5;
const STREAK_MIN_KILLS       = 5;
const KEEP_SESSIONS          = 10;              // stored summaries per character (for "vs last session")
const SAVE_THROTTLE_MS       = 30 * 1000;
const CARD_ORDER = ['intense', 'peak', 'closest', 'nemesis', 'streak'];

const signed = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`;
const bpm = (v) => (v != null ? `${v} BPM` : '–');

function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h}:${String(m).padStart(2, '0')} h` : `${m} min`;
}

function ago(ms) {
  const min = Math.floor(ms / 60000);
  return min < 1 ? 'Just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ago`;
}

// load() → { [character]: [{ startedAt, endedAt, peakBpm, kills, deaths }] }, save(data)
// closeCallPct: the user's CLOSE CALL threshold — Closest Call only counts fights at or below it
function createInsights({ load, save, now = () => Date.now(), closeCallPct = 10, cards = {} } = {}) {
  let stored = {};
  try { stored = load?.() || {}; } catch {}
  let session = null;
  let lastCardAt = 0, lastCardId = null, lastSaveAt = 0;
  const shown = {}; // id → { at, ...state when last shown }

  function persist(force = false) {
    if (!save || (!force && now() - lastSaveAt < SAVE_THROTTLE_MS)) return;
    lastSaveAt = now();
    try { save(stored); } catch {}
  }

  // Current session for this character; resumes a stored one that ended less than SESSION_GAP_MS ago.
  // `since` = log time of the data that triggered it — blocks arrive late, the session started earlier.
  function touch(character, t = now(), since = t) {
    if (!character) return null;
    if (!session || session.character !== character || t - session.record.endedAt > SESSION_GAP_MS) {
      const list = stored[character] ||= [];
      const last = list.at(-1);
      let record;
      if (last && t - last.endedAt <= SESSION_GAP_MS) {
        record = last;
      } else {
        const startedAt = Math.min(since ?? t, t);
        record = { startedAt, endedAt: startedAt, peakBpm: null, kills: 0, deaths: 0 };
        list.push(record);
        if (list.length > KEEP_SESSIONS) list.splice(0, list.length - KEEP_SESSIONS);
      }
      for (const id in shown) delete shown[id]; // news is judged per session
      lastCardId = null;
      session = {
        character, record, peakCheckedAt: record.endedAt,
        enemies: new Map(), closest: null, deathLog: [],
        streakKills: 0, streakStart: record.startedAt,
      };
      persist(true);
    }
    const { record } = session;
    const { peakBpm } = moments.heartRateStats(session.peakCheckedAt, t);
    if (peakBpm != null && (record.peakBpm == null || peakBpm > record.peakBpm)) record.peakBpm = peakBpm;
    session.peakCheckedAt = t;
    record.endedAt = t;
    persist();
    return session;
  }

  function addFight(character, f) {
    const s = touch(character, now(), f.startedAt);
    if (!s) return;
    const hr = moments.heartRateStats(f.startedAt, f.endedAt);
    for (const e of f.enemies) {
      if (!s.enemies.has(e.key)) s.enemies.set(e.key, { name: e.name, guids: new Set(), incSum: 0, incN: 0, highest: null });
      const entry = s.enemies.get(e.key);
      entry.name = e.name;
      e.guids.forEach(g => entry.guids.add(g));
      if (hr.hrIncrease != null) { entry.incSum += hr.hrIncrease; entry.incN++; }
      if (hr.peakBpm != null && (entry.highest == null || hr.peakBpm > entry.highest)) entry.highest = hr.peakBpm;
    }
    if (!f.died && f.lowestHp > 0 && f.lowestHp <= closeCallPct && (!s.closest || f.lowestHp < s.closest.raw)) {
      s.closest = { raw: f.lowestHp, pct: Math.max(1, Math.round(f.lowestHp)), at: f.lowestAt, by: f.lowestBy, bpm: moments.bpmAt(f.lowestAt) };
    }
  }

  function addKill(character, at) {
    const s = touch(character, now(), at);
    if (!s) return;
    s.record.kills++;
    s.streakKills++;
  }

  function addDeath(character, result) {
    const s = touch(character, now(), result.startedAt ?? result.endedAt);
    if (!s) return;
    s.record.deaths++;
    s.deathLog.push({ at: result.endedAt, killer: result.killer || null, bpm: moments.bpmAt(result.endedAt) });
    s.streakKills = 0;
    s.streakStart = result.endedAt;
    persist(true);
  }

  // ── Cards: { style, kicker, title, stats: [{ icon, value, label }] } ──────────
  // Each builder returns { card, state, news } — `news` compares with `prev`, the state last shown.
  const builders = {
    intense(t, prev) {
      let best = null;
      for (const [key, e] of session.enemies) {
        if (e.guids.size < INTENSE_MIN_ENCOUNTERS || !e.incN) continue;
        const avg = Math.round(e.incSum / e.incN);
        if (!best || avg > best.avg) best = { ...e, key, avg };
      }
      if (!best) return null;
      return {
        state: { key: best.key, avg: best.avg, highest: best.highest },
        news: !prev || prev.key !== best.key || best.avg >= prev.avg + NEWS_BPM_STEP || best.highest >= prev.highest + NEWS_BPM_STEP,
        card: { style: 'intense', kicker: best.name, title: 'Most Intense Enemy', stats: [
          { icon: 'swords', value: String(best.guids.size), label: 'Encounters' },
          { icon: 'arrow',  value: `${signed(best.avg)} BPM`, label: 'Avg increase' },
          { icon: 'heart',  value: bpm(best.highest), label: 'Highest' },
        ] },
      };
    },

    peak(t, prev) {
      const { record } = session;
      if (record.peakBpm == null) return null;
      const list = stored[session.character] || [];
      const last = list.slice(0, list.indexOf(record)).reverse().find(r => r.peakBpm != null);
      return {
        state: { peak: record.peakBpm },
        news: !prev || record.peakBpm >= prev.peak + NEWS_PEAK_STEP,
        card: { style: 'peak', kicker: 'This session', title: 'Peak Heart Rate', stats: [
          { icon: 'heart', value: bpm(record.peakBpm), label: 'Session peak' },
          last
            ? { icon: 'arrow', value: `${signed(record.peakBpm - last.peakBpm)} BPM`, label: 'vs last session' }
            : { icon: 'arrow', value: 'New', label: 'First session' },
          { icon: 'clock', value: duration(t - record.startedAt), label: 'Session time' },
        ] },
      };
    },

    closest(t) {
      const c = session.closest;
      if (!c) return null;
      return {
        state: { pct: c.pct, at: c.at },
        news: true, // may repeat — the only card allowed to come back without a change
        card: { style: 'closest', kicker: c.by ? `vs. ${c.by.name}` : 'This session', title: 'Closest Call', stats: [
          { icon: 'drop',  value: `${c.pct}%`, label: 'Health left' },
          { icon: 'heart', value: bpm(c.bpm), label: 'Heart rate' },
          { icon: 'clock', value: ago(t - c.at), label: 'When' },
        ] },
      };
    },

    nemesis(t, prev) {
      const byKiller = new Map();
      for (const d of session.deathLog) {
        if (!d.killer) continue;
        const e = byKiller.get(d.killer.key) || { key: d.killer.key, name: d.killer.name, n: 0, maxBpm: null, lastAt: 0 };
        e.n++;
        e.lastAt = d.at;
        if (d.bpm != null && (e.maxBpm == null || d.bpm > e.maxBpm)) e.maxBpm = d.bpm;
        byKiller.set(d.killer.key, e);
      }
      let best = null;
      for (const e of byKiller.values()) {
        if (!best || e.n > best.n || (e.n === best.n && e.lastAt > best.lastAt)) best = e;
      }
      if (!best) return null;
      return {
        state: { key: best.key, n: best.n },
        news: !prev || prev.key !== best.key || best.n > prev.n,
        card: { style: 'nemesis', kicker: best.name, title: 'Nemesis', stats: [
          { icon: 'skull',  value: `${best.n}×`, label: 'Killed you' },
          { icon: 'heart',  value: bpm(best.maxBpm), label: 'At death' },
          { icon: 'swords', value: String(session.record.deaths), label: 'Session deaths' },
        ] },
      };
    },

    streak(t, prev) {
      if (session.streakKills < STREAK_MIN_KILLS) return null;
      const milestone = STREAK_MILESTONES.filter(m => session.streakKills >= m).at(-1) ?? 0;
      return {
        state: { milestone, streakStart: session.streakStart },
        news: !prev || prev.streakStart !== session.streakStart || milestone > prev.milestone,
        card: { style: 'streak', kicker: session.record.deaths ? 'Since your last death' : 'This session', title: 'Kill Streak', stats: [
          { icon: 'swords', value: String(session.streakKills), label: 'Kills in a row' },
          { icon: 'heart',  value: bpm(moments.averageBpm(session.streakStart, t)), label: 'Avg heart rate' },
          { icon: 'clock',  value: duration(t - session.streakStart), label: 'Streak time' },
        ] },
      };
    },
  };

  // Next card with news, in rotation after the last one; the last card itself only after SAME_CARD_GAP_MS
  function nextCard(t = now()) {
    if (!session || t - lastCardAt < MIN_CARD_GAP_MS) return null;
    const last = lastCardId ? CARD_ORDER.indexOf(lastCardId) : -1;
    for (let i = 1; i <= CARD_ORDER.length; i++) {
      const id = CARD_ORDER[(last + i) % CARD_ORDER.length];
      if (cards[id] === false) continue;                      // switched off in the settings
      if (id === lastCardId && t - shown[id].at < SAME_CARD_GAP_MS) continue;
      const built = builders[id](t, shown[id]);
      if (!built?.news) continue;
      shown[id] = { ...built.state, at: t };
      lastCardId = id;
      lastCardAt = t;
      return built.card;
    }
    return null;
  }

  // Live result cards count towards the gap, so an insight never follows right after one
  function noteCardShown(t = now()) { lastCardAt = t; }

  return {
    touch, addFight, addKill, addDeath, nextCard, noteCardShown,
    setCloseCallPct(pct) { closeCallPct = pct; },
    setCards(next = {}) { cards = { ...cards, ...next }; },
    flush: () => persist(true),
    get session() { return session; },
  };
}

// Example cards for the preview button in settings
const DEMO_CARDS = [
  { style: 'intense', kicker: 'Black Dragon Whelp', title: 'Most Intense Enemy', stats: [
    { icon: 'swords', value: '23', label: 'Encounters' }, { icon: 'arrow', value: '+34 BPM', label: 'Avg increase' }, { icon: 'heart', value: '167 BPM', label: 'Highest' } ] },
  { style: 'peak', kicker: 'This session', title: 'Peak Heart Rate', stats: [
    { icon: 'heart', value: '171 BPM', label: 'Session peak' }, { icon: 'arrow', value: '+12 BPM', label: 'vs last session' }, { icon: 'clock', value: '48 min', label: 'Session time' } ] },
  { style: 'closest', kicker: 'vs. Black Dragon Whelp', title: 'Closest Call', stats: [
    { icon: 'drop', value: '6%', label: 'Health left' }, { icon: 'heart', value: '148 BPM', label: 'Heart rate' }, { icon: 'clock', value: '12 min ago', label: 'When' } ] },
  { style: 'nemesis', kicker: 'Blackrock Scout', title: 'Nemesis', stats: [
    { icon: 'skull', value: '2×', label: 'Killed you' }, { icon: 'heart', value: '152 BPM', label: 'At death' }, { icon: 'swords', value: '3', label: 'Session deaths' } ] },
  { style: 'streak', kicker: 'Since your last death', title: 'Kill Streak', stats: [
    { icon: 'swords', value: '31', label: 'Kills in a row' }, { icon: 'heart', value: '97 BPM', label: 'Avg heart rate' }, { icon: 'clock', value: '38 min', label: 'Streak time' } ] },
];

module.exports = { createInsights, DEMO_CARDS, SESSION_GAP_MS, MIN_CARD_GAP_MS };
