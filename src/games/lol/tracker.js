// Turns a stream of Live Client Data snapshots into overlay cards.
// Kept free of I/O so it can be replayed against recorded games in tests.

const moments = require('../../moments');
const { sameName } = require('./api');

// Health window used to spot a close call: a fight opens when health drops below SAFE_PCT and
// closes once it is back up (or nothing happened for a while). The lowest point decides.
const SAFE_PCT = 88, RECOVER_MS = 2500, FIGHT_IDLE_MS = 12000;
const KILL_WINDOW_MS = 20000;   // heart rate window for events without a fight window of their own
const OBJECTIVE_REPEAT_MS = 25000;  // pushing a lane takes several turrets in a row — don't show every one

const DEFAULT_CARDS = {
  deaths: true, closeCalls: true, multikills: true, kills: false,
  firstBlood: true, objectives: true, steals: true, ace: true, matchResult: true,
};

const MULTIKILL = { 2: 'Double Kill', 3: 'Triple Kill', 4: 'Quadra Kill', 5: 'Pentakill' };
const OBJECTIVES = {
  DragonKill:  { title: 'Dragon Slain',     icon: 'dragon', style: 'objective' },
  HeraldKill:  { title: 'Herald Slain',     icon: 'herald', style: 'objective' },
  BaronKill:   { title: 'Baron Slain',      icon: 'baron',  style: 'objective' },
  TurretKilled:{ title: 'Turret Destroyed', icon: 'tower',  style: 'objective' },
  InhibKilled: { title: 'Inhibitor Down',   icon: 'tower',  style: 'objective' },
};

const clock = (seconds) => {
  const s = Math.max(0, Math.round(seconds)), m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};
const bpmText = (v) => (v == null ? '–' : `${v} BPM`);
const signed  = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${v} BPM`);
const isTrue  = (v) => v === true || v === 'True' || v === 'true';
// Names arrive in several shapes: players as a riot id game name (sometimes with #tag), bots as
// "Annie-Bot", and everything else as an internal id like "Turret_T1_C_05_A" or "SRU_Baron12.1.1".
const ENVIRONMENT = [
  [/^Turret_/i,        'a turret'],
  [/^Minion_/i,        'minions'],
  [/^SRU_Baron/i,      'Baron Nashor'],
  [/^SRU_RiftHerald/i, 'Rift Herald'],
  [/^SRU_Dragon|^Dragon_/i, 'a dragon'],
];
function displayName(raw) {
  const n = String(raw || '').trim();
  if (!n) return '';
  for (const [re, label] of ENVIRONMENT) if (re.test(n)) return label;
  if (/^(SRU|HA)_/i.test(n)) {                       // jungle camps: SRU_Krug1.1.1 → Krug
    return n.replace(/^(SRU|HA)_/i, '').replace(/[\d.]+$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return n.replace(/-Bot$/i, ' Bot').split('#')[0].trim();
}

function createTracker({ closeCallPct = 10, cards = {}, hr = moments, onCard, now = Date.now } = {}) {
  let opts = { closeCallPct: Number(closeCallPct) || 10, cards: { ...DEFAULT_CARDS, ...cards } };
  let seenEventId = -1;          // events are numbered and never re-sent
  let gameStartWall = null;      // wall clock of gameTime 0, so game time maps to BPM history
  let fight = null;              // { startedAt, lowestPct, lastLowAt }
  let last = null;               // previous snapshot
  let ended = false;
  let lastObjective = {};        // title → time, so a lane push doesn't queue four identical cards

  const on = (key) => opts.cards[key] !== false;
  const wall = (gameTime) => (gameStartWall == null ? now() : gameStartWall + gameTime * 1000);

  function emit(card) { if (card) onCard?.(card); }

  function statsFor(startedAt, endedAt, extra = []) {
    const { peakBpm, hrIncrease } = hr.heartRateStats(startedAt, endedAt);
    return { peakBpm, hrIncrease, base: [{ icon: 'heart', value: bpmText(peakBpm), label: 'Peak' }, ...extra] };
  }

  // ── Health window ──────────────────────────────────────────────────────────
  function trackHealth(snap, t) {
    const pct = snap.me?.hpPct;
    if (pct == null) return;
    if (snap.me.dead) { fight = null; return; }   // health stays at 0 during the death timer
    if (pct < SAFE_PCT) {
      if (!fight) fight = { startedAt: t, lowestPct: pct, lastLowAt: t };
      else if (pct < fight.lowestPct) { fight.lowestPct = pct; fight.lastLowAt = t; }
      return;
    }
    // back to (nearly) full health — close the window once it stayed there for a moment
    if (fight && t - fight.lastLowAt > RECOVER_MS) closeFight(t, true);
  }

  function closeFight(t, survived) {
    const f = fight;
    fight = null;
    if (!f || !survived) return;
    const lowest = Math.round(f.lowestPct);
    if (!on('closeCalls') || lowest <= 0 || lowest > opts.closeCallPct) return;
    const { peakBpm, base } = statsFor(f.startedAt, t, [
      { icon: 'drop',  value: `${lowest}%`, label: 'Health left' },
      { icon: 'clock', value: clock((t - f.startedAt) / 1000), label: 'Fight duration' },
    ]);
    emit({ game: 'lol', style: 'close', title: 'Close Call', kicker: 'Survived', peakBpm, stats: base });
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  function handleEvent(ev, snap) {
    const me = snap.me?.name;
    const t = wall(ev.EventTime);
    const gt = clock(ev.EventTime);
    const mine = (n) => sameName(n, me);
    // Objectives are usually a team effort — an assist counts as taking part
    const involved = () => mine(ev.KillerName) || (ev.Assisters || []).some((a) => mine(a));

    switch (ev.EventName) {
      case 'ChampionKill': {
        if (mine(ev.VictimName)) {
          if (fight) { fight.startedAt = Math.min(fight.startedAt, t - KILL_WINDOW_MS); }
          const from = fight?.startedAt ?? t - KILL_WINDOW_MS;
          fight = null;
          if (!on('deaths')) return;
          const { peakBpm, hrIncrease } = hr.heartRateStats(from, t);
          emit({
            game: 'lol', style: 'death', title: 'You Died',
            kicker: ev.KillerName ? `vs. ${displayName(ev.KillerName)}` : 'Slain',
            stats: [
              { icon: 'heart', value: bpmText(peakBpm), label: 'Peak' },
              { icon: 'arrow', value: signed(hrIncrease), label: 'HR increase' },
              { icon: 'clock', value: gt, label: 'Game time' },
            ],
          });
          return;
        }
        if (mine(ev.KillerName) && on('kills')) {
          const { base } = statsFor(t - KILL_WINDOW_MS, t, [
            { icon: 'swords', value: String(snap.me?.kills ?? '–'), label: 'Kills' },
            { icon: 'clock',  value: gt, label: 'Game time' },
          ]);
          emit({ game: 'lol', style: 'kill', title: 'Champion Slain', kicker: ev.VictimName ? `vs. ${displayName(ev.VictimName)}` : '', stats: base });
        }
        return;
      }
      case 'Multikill': {
        if (!mine(ev.KillerName) || !on('multikills')) return;
        const streak = Number(ev.KillStreak) || 2;
        const { base } = statsFor(t - KILL_WINDOW_MS, t, [
          { icon: 'swords', value: String(streak), label: 'Kills in a row' },
          { icon: 'clock',  value: gt, label: 'Game time' },
        ]);
        emit({
          game: 'lol', style: streak >= 5 ? 'penta' : 'multikill',
          title: MULTIKILL[streak] || `${streak}× Kill`,
          kicker: snap.me?.champion || '', stats: base,
        });
        return;
      }
      case 'FirstBlood': {
        if (!mine(ev.Recipient) || !on('firstBlood')) return;
        const { base } = statsFor(t - KILL_WINDOW_MS, t, [
          { icon: 'drop',  value: 'First', label: 'Blood' },
          { icon: 'clock', value: gt, label: 'Game time' },
        ]);
        emit({ game: 'lol', style: 'firstblood', title: 'First Blood', kicker: snap.me?.champion || '', stats: base });
        return;
      }
      case 'Ace': {
        if (!on('ace') || !mine(ev.Acer)) return;
        const { base } = statsFor(t - KILL_WINDOW_MS, t, [
          { icon: 'swords', value: 'Ace', label: 'Team wiped' },
          { icon: 'clock',  value: gt, label: 'Game time' },
        ]);
        emit({ game: 'lol', style: 'ace', title: 'Ace', kicker: 'You finished it', stats: base });
        return;
      }
      case 'DragonKill': case 'HeraldKill': case 'BaronKill': case 'TurretKilled': case 'InhibKilled': {
        const def = OBJECTIVES[ev.EventName];
        const stolen = isTrue(ev.Stolen);
        if (!involved()) return;
        if (stolen ? !on('steals') : !on('objectives')) return;
        const title = stolen ? `${def.title.split(' ')[0]} Stolen` : def.title;
        if (!stolen && t - (lastObjective[title] || 0) < OBJECTIVE_REPEAT_MS) return;
        lastObjective[title] = t;
        const name = ev.EventName === 'DragonKill' && ev.DragonType ? `${ev.DragonType} Dragon` : (snap.me?.champion || '');
        const { base } = statsFor(t - KILL_WINDOW_MS, t, [
          { icon: stolen ? 'bolt' : def.icon, value: stolen ? 'Stolen' : 'Secured', label: 'Objective' },
          { icon: 'clock', value: gt, label: 'Game time' },
        ]);
        emit({
          game: 'lol', style: stolen ? 'steal' : def.style,
          title,
          icon: stolen ? 'bolt' : def.icon,
          kicker: name, stats: base,
        });
        return;
      }
      case 'GameEnd': {
        if (ended) return;
        ended = true;
        if (!on('matchResult')) return;
        const win = String(ev.Result || '').toLowerCase() === 'win';
        const from = gameStartWall ?? t - ev.EventTime * 1000;
        const { base } = statsFor(from, t, [
          { icon: 'swords', value: `${snap.me?.kills ?? 0}/${snap.me?.deaths ?? 0}/${snap.me?.assists ?? 0}`, label: 'K/D/A' },
          { icon: 'clock',  value: gt, label: 'Match time' },
        ]);
        base[0].label = 'Match peak';
        emit({ game: 'lol', style: win ? 'win' : 'lose', title: win ? 'Victory' : 'Defeat', kicker: snap.me?.champion || '', stats: base });
        return;
      }
    }
  }

  return {
    feed(rawSnapshot, t = now()) {
      const snap = rawSnapshot;
      if (!snap) return;
      if (gameStartWall == null && snap.gameTime > 0) gameStartWall = t - snap.gameTime * 1000;

      for (const ev of snap.events) {
        if (ev.EventID <= seenEventId) continue;
        seenEventId = ev.EventID;
        if (last === null && ev.EventName !== 'GameEnd') continue; // first poll: don't replay a game in progress
        try { handleEvent(ev, snap); } catch { /* one odd event must not kill the poll loop */ }
      }

      trackHealth(snap, t);
      if (fight && t - fight.lastLowAt > FIGHT_IDLE_MS) closeFight(t, true); // out of combat without full health
      last = snap;
    },
    reset() { seenEventId = -1; gameStartWall = null; fight = null; last = null; ended = false; lastObjective = {}; },
    setOptions(next = {}) {
      if (next.closeCallPct !== undefined) opts.closeCallPct = Number(next.closeCallPct) || 10;
      if (next.cards) opts.cards = { ...opts.cards, ...next.cards };
    },
    get state() { return { seenEventId, gameStartWall, fight, ended }; },
  };
}

module.exports = { createTracker, DEFAULT_CARDS, MULTIKILL, SAFE_PCT, RECOVER_MS, FIGHT_IDLE_MS };
