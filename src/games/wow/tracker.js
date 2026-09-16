// Turns WoW combat log lines into fight results for the moments core.
//   boss  — ENCOUNTER_END with success
//   death — UNIT_DIED for the logging player
//   close — a fight the player survived with health at or below closeCallPct
// Outside boss encounters the log has no "combat started/ended" marker, so a fight is
// any damage in or out and ends after FIGHT_IDLE_MS without such activity.
// Besides results it reports every finished fight (onFight) and kills (onKill) for session insights.

const { parseLine, splitArgs, advancedInfo, isGuid, flags } = require('./parser');

const FLAG_MINE          = 0x00000001;
const FLAG_FRIENDLY      = 0x00000010;
const FLAG_TYPE_PLAYER   = 0x00000400;
const FIGHT_IDLE_MS      = 6000;  // log time without damage → fight over
const WALL_GRACE_MS      = 10000; // extra wait when no newer lines arrive (WoW writes the log buffered)
const FEIGN_DEATH_SPELL  = '5384';
const FEIGN_WINDOW_MS    = 1500;
const DEATH_DEDUPE_MS    = 3000;
const LAST_HIT_MS        = 10000; // a hit this recent counts as the cause of a death / low health

// Creatures of the same kind share the NPC id (6th GUID part); players are keyed by GUID
function enemyKey(guid) {
  const parts = guid.split('-');
  return (parts[0] === 'Creature' || parts[0] === 'Vehicle') && parts[5] ? `npc:${parts[5]}` : guid;
}

function createTracker({ onResult, onInfo, onUnparsed, onFight, onKill, closeCallPct = 10 } = {}) {
  let playerGUID = null;
  let advanced   = null;  // true/false once known
  let encounter  = null;  // { name, startedAt, lowestHp }
  let fight      = null;  // { startedAt, lastActivity, lastSeenWall, lowestHp, lowestAt, lowestBy, enemies: Map }
  let lastHit    = null;  // { key, name, at } — latest enemy damage taken by the player
  let feignAt    = 0;
  let lastDeathAt = 0;

  function reset() {
    playerGUID = null; advanced = null; encounter = null; fight = null; lastHit = null; feignAt = 0; lastDeathAt = 0;
  }

  function recentHit(time) {
    return lastHit && time - lastHit.at <= LAST_HIT_MS ? { key: lastHit.key, name: lastHit.name } : null;
  }

  function reportFight(f, endedAt, died) {
    onFight?.({
      game: 'wow', startedAt: f.startedAt, endedAt, died,
      lowestHp: f.lowestHp, lowestAt: f.lowestAt, lowestBy: f.lowestBy,
      enemies: [...f.enemies.entries()].map(([key, e]) => ({ key, name: e.name, guids: [...e.guids] })),
    });
  }

  function emit(type, data) {
    onResult?.({ game: 'wow', type, ...data });
  }

  function lowest(current, pct) {
    return current === null ? pct : Math.min(current, pct);
  }

  function roundSurvivor(pct) {
    return pct === null ? null : Math.max(1, Math.round(pct));
  }

  function endFight() {
    const f = fight;
    fight = null;
    reportFight(f, f.lastActivity, false);
    if (f.lowestHp !== null && f.lowestHp > 0 && f.lowestHp <= closeCallPct) { // 0% = dead, not a close call
      emit('close', {
        startedAt: f.startedAt, endedAt: f.lastActivity,
        lowestHealthPct: roundSurvivor(f.lowestHp), by: f.lowestBy,
      });
    }
  }

  function setAdvanced(value) {
    if (advanced === value) return;
    advanced = value;
    onInfo?.({ advanced });
  }

  // Own character: flagged as "mine" and "player" by the client writing the log
  function detectPlayer(args) {
    for (const [guid, flagHex] of [[args[0], args[2]], [args[4], args[6]]]) {
      if (isGuid(guid) && guid.startsWith('Player-') &&
          (flags(flagHex) & (FLAG_MINE | FLAG_TYPE_PLAYER)) === (FLAG_MINE | FLAG_TYPE_PLAYER)) {
        playerGUID = guid;
        onInfo?.({ playerGUID });
        return;
      }
    }
  }

  function feed(line, wallNow = Date.now()) {
    const p = parseLine(line, wallNow);
    if (!p) {
      if (line.trim()) onUnparsed?.(line);
      return;
    }
    const { time, event, rest } = p;

    // A newer line proves the log was written up to here — close a fight that went quiet
    if (fight && !encounter && time - fight.lastActivity > FIGHT_IDLE_MS) endFight();

    switch (event) {
      case 'COMBAT_LOG_VERSION': {
        // Written when /combatlog starts — possibly a different character
        const a = splitArgs(rest);
        reset();
        const adv = a.indexOf('ADVANCED_LOG_ENABLED');
        if (adv >= 0) setAdvanced(a[adv + 1] === '1');
        const build = a.indexOf('BUILD_VERSION');
        onInfo?.({ version: a[0], build: build >= 0 ? a[build + 1] : null });
        return;
      }

      case 'ENCOUNTER_START': {
        const a = splitArgs(rest);
        encounter = { name: a[1] || null, startedAt: time, lowestHp: null };
        fight = null; // trash fight running into the pull belongs to the encounter now
        return;
      }

      case 'ENCOUNTER_END': {
        const a = splitArgs(rest); // encounterID, name, difficultyID, groupSize, success, fightTime
        if (a[4] === '1') {
          // Started mid-encounter (no START seen) → derive start from fightTime when available
          const fightTime = Number(a[5]);
          const startedAt = encounter ? encounter.startedAt
            : Number.isFinite(fightTime) && fightTime > 0 ? time - fightTime : time;
          emit('boss', {
            name: a[1] || encounter?.name || null,
            startedAt, endedAt: time,
            lowestHealthPct: encounter?.lowestHp === 0 ? 0 : roundSurvivor(encounter?.lowestHp ?? null),
          });
        }
        encounter = null;
        fight = null;
        return;
      }

      case 'PARTY_KILL': {
        // Killed by the player or something the player controls (pet, totem)
        const a = splitArgs(rest);
        if (isGuid(a[4]) && (a[0] === playerGUID || flags(a[2]) & FLAG_MINE)) {
          onKill?.({ game: 'wow', at: time, key: enemyKey(a[4]), name: a[5] });
        }
        return;
      }
    }

    if (!playerGUID) {
      if (!rest.includes('Player-')) return;
      detectPlayer(splitArgs(rest));
      if (!playerGUID) return;
    }
    if (!rest.includes(playerGUID)) return;
    const a = splitArgs(rest);

    if (event === 'UNIT_DIED') {
      if (a[4] !== playerGUID) return;
      if (time - feignAt < FEIGN_WINDOW_MS || time - lastDeathAt < DEATH_DEDUPE_MS) return;
      lastDeathAt = time;
      const ctx = encounter || fight;
      const killer = recentHit(time);
      if (fight) reportFight(fight, time, true);
      emit('death', {
        name: encounter?.name || null,
        startedAt: ctx ? ctx.startedAt : time,
        endedAt: time,
        lowestHealthPct: 0,
        killer,
      });
      fight = null;
      lastHit = null;
      if (encounter) encounter.lowestHp = 0;
      return;
    }

    if ((event === 'SPELL_CAST_SUCCESS' || event === 'SPELL_AURA_APPLIED') && a[0] === playerGUID && a[8] === FEIGN_DEATH_SPELL) {
      feignAt = time;
      return;
    }

    const isDamage = event.endsWith('_DAMAGE') || event.endsWith('_MISSED') || event.endsWith('_DAMAGE_LANDED');
    if (isDamage) {
      const selfOnly = a[0] === a[4];
      const environmental = event.startsWith('ENVIRONMENTAL');
      // WoW logs the killing blow's *_LANDED line right after UNIT_DIED — that must not start a new fight
      const afterDeath = time - lastDeathAt < DEATH_DEDUPE_MS;
      if (!fight && !encounter && !selfOnly && !environmental && !afterDeath) {
        fight = { startedAt: time, lastActivity: time, lastSeenWall: wallNow, lowestHp: null, lowestAt: null, lowestBy: null, enemies: new Map() };
      }
      if (fight && !selfOnly) { fight.lastActivity = time; fight.lastSeenWall = wallNow; }

      // The other side of the hit: attacker when the player is hit, target when the player (or pet) hits
      if (!selfOnly && !environmental) {
        const playerHit = a[4] === playerGUID;
        const [guid, name, flagHex] = playerHit ? [a[0], a[1], a[2]] : [a[4], a[5], a[6]];
        const ours = playerHit || a[0] === playerGUID || flags(a[2]) & FLAG_MINE;
        if (ours && isGuid(guid) && guid !== '0000000000000000' && !(flags(flagHex) & FLAG_FRIENDLY)) {
          const key = enemyKey(guid);
          if (playerHit) lastHit = { key, name, at: time };
          if (fight) {
            if (!fight.enemies.has(key)) fight.enemies.set(key, { name, guids: new Set() });
            fight.enemies.get(key).guids.add(guid);
          }
        }
      }
    }

    const info = advancedInfo(a);
    if (info) {
      setAdvanced(true);
      if (info.guid === playerGUID && info.maxHp > 0) {
        const pct = Math.max(0, Math.min(100, (info.hp / info.maxHp) * 100));
        if (fight && (fight.lowestHp === null || pct < fight.lowestHp)) {
          fight.lowestHp = pct;
          fight.lowestAt = time;
          fight.lowestBy = recentHit(time);
        }
        if (encounter) encounter.lowestHp = lowest(encounter.lowestHp, pct);
      }
    }
  }

  // Called periodically: ends a fight when the log stayed silent (no newer lines to prove the fight is over)
  function tick(wallNow = Date.now()) {
    if (fight && !encounter && wallNow - fight.lastSeenWall > FIGHT_IDLE_MS + WALL_GRACE_MS) endFight();
  }

  return {
    feed, tick, reset,
    setCloseCallPct(pct) { closeCallPct = pct; },
    get advanced()   { return advanced; },
    get playerGUID() { return playerGUID; },
  };
}

module.exports = { createTracker, enemyKey, FIGHT_IDLE_MS, WALL_GRACE_MS };
