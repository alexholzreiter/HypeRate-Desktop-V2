// Game-agnostic "moments" core.
// Game modules (src/games/*) report fight results with a time window;
// this module adds the heart-rate side (peak BPM, BPM increase) from its own history.

const HISTORY_MS = 3 * 60 * 60 * 1000; // long raid pulls + some slack

const history = []; // [{ t, bpm }] ascending by t

function recordBpm(bpm, t = Date.now()) {
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  history.push({ t, bpm });
  const cutoff = t - HISTORY_MS;
  let drop = 0;
  while (drop < history.length && history[drop].t < cutoff) drop++;
  if (drop) history.splice(0, drop);
}

// Peak BPM inside [start, end] and increase from the BPM at fight start to that peak.
function heartRateStats(startedAt, endedAt) {
  let peak = null, atStart = null;
  for (const { t, bpm } of history) {
    if (t <= startedAt) atStart = bpm;          // last sample before/at start
    if (t >= startedAt && t <= endedAt) {
      if (atStart === null) atStart = bpm;      // no sample before start → first inside
      if (peak === null || bpm > peak) peak = bpm;
    }
  }
  return { peakBpm: peak, hrIncrease: peak !== null && atStart !== null ? peak - atStart : null };
}

// BPM at a moment: the latest sample at or before t (ignored if older than maxAgeMs)
function bpmAt(t, maxAgeMs = 15000) {
  let found = null;
  for (const s of history) {
    if (s.t > t) break;
    found = s;
  }
  return found && t - found.t <= maxAgeMs ? found.bpm : null;
}

function averageBpm(start, end) {
  let sum = 0, n = 0;
  for (const { t, bpm } of history) {
    if (t >= start && t <= end) { sum += bpm; n++; }
  }
  return n ? Math.round(sum / n) : null;
}

// result: { game, type: 'boss'|'close'|'death', name?, startedAt, endedAt, lowestHealthPct? }
function build(result) {
  const startedAt = Math.min(result.startedAt, result.endedAt);
  return {
    ...result,
    startedAt,
    durationMs: Math.max(0, result.endedAt - startedAt),
    lowestHealthPct: result.lowestHealthPct ?? null,
    ...heartRateStats(startedAt, result.endedAt),
  };
}

// Which style a moment has, and the type name every output uses for it.
// The MQTT entity and the session recorder must agree here, so it lives in one place.
const EVENT_TYPES = {
  boss: 'boss_defeated', close: 'close_call', death: 'death',
  intense: 'intense_enemy', peak: 'peak_heart_rate', closest: 'closest_call',
  nemesis: 'nemesis', streak: 'kill_streak',
  penta: 'pentakill', multikill: 'multikill', kill: 'kill', firstblood: 'first_blood',
  objective: 'objective', steal: 'objective_stolen', ace: 'ace', win: 'victory', lose: 'defeat',
};

// A WoW fight result arrives without a card; the overlay titles it from the type, so do we.
const RESULT_TITLES = { close: 'Close Call', boss: 'Boss Defeated', death: 'You Died' };

// moment: a game result from build(), or { game, card } for ready-made cards.
// Returns null for anything no output knows how to name.
function describe(moment) {
  if (!moment) return null;
  const card = moment.card || null;
  const style = card?.style || moment.type;
  const type = EVENT_TYPES[style];
  if (!type) return null;
  const vs = moment.killer || moment.by;
  return {
    style,                                     // 'boss', 'penta', … as the overlay knows it
    type,                                      // 'boss_defeated', 'pentakill', … for outputs
    game: moment.game || card?.game || 'wow',
    title: card?.title || RESULT_TITLES[style] || null,
    detail: card?.kicker || moment.name || (vs?.name ? `vs. ${vs.name}` : null),
    bpm: moment.peakBpm ?? null,
  };
}

module.exports = { recordBpm, build, heartRateStats, bpmAt, averageBpm, describe, EVENT_TYPES };
