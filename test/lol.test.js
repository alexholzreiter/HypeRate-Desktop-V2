// Scripted League match → cards, without touching the network.
const ROOT = require('path').join(__dirname, '..', 'src');
const moments = require(ROOT + '/moments');
const { snapshot } = require(ROOT + '/games/lol/api');
const { createTracker } = require(ROOT + '/games/lol/tracker');

const checks = [];
const check = (name, ok, info = '') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `→ ${info}`); };

const T0 = Date.now() - 40 * 60 * 1000;   // match started 40 min ago
let clock = T0;
const ME = 'Woodryda';

// Raw payload in Riot's shape, so api.snapshot() is exercised too
let events = [];
let nextId = 0;
const addEvent = (EventName, gameTime, extra = {}) => { events.push({ EventID: nextId++, EventName, EventTime: gameTime, ...extra }); };

function raw(gameTime, hpPct, scores = { kills: 3, deaths: 1, assists: 5 }) {
  return {
    activePlayer: { riotIdGameName: ME, riotId: `${ME}#EUW`, level: 11, championStats: { currentHealth: 21.4 * hpPct, maxHealth: 2140 } },
    allPlayers: [
      { riotIdGameName: ME, riotId: `${ME}#EUW`, championName: 'Jinx', team: 'ORDER', isDead: hpPct === 0, scores },
      { riotIdGameName: 'Enemy', championName: 'Lee Sin', team: 'CHAOS', scores: { kills: 2, deaths: 2, assists: 1 } },
    ],
    gameData: { gameTime, gameMode: 'CLASSIC', mapName: "Summoner's Rift" },
    events: { Events: events },
  };
}

// BPM history: resting 78, spikes to 170 during the interesting minutes
for (let t = T0 - 60000; t <= T0 + 45 * 60 * 1000; t += 5000) {
  const min = (t - T0) / 60000;
  const hot = (min > 11.5 && min < 12.5) || (min > 23.5 && min < 25) || (min > 31 && min < 33);
  moments.recordBpm(hot ? 150 + Math.round(Math.sin(t / 7000) * 20) : 80, t);
}

let cards = [];
const tracker = createTracker({ closeCallPct: 10, onCard: (c) => cards.push(c), now: () => clock });
const feed = (gameTime, hpPct, scores) => { clock = T0 + gameTime * 1000; tracker.feed(snapshot(raw(gameTime, hpPct, scores)), clock); };
const titles = () => cards.map((c) => `${c.style}:${c.title}`);

// ── A game already in progress must not replay its history ──
addEvent('GameStart', 0);
addEvent('FirstBlood', 120, { Recipient: 'Enemy' });
feed(300, 100);
check('joining mid-game replays nothing', cards.length === 0, JSON.stringify(titles()));

// ── Close call: down to 6 %, survives ──
feed(700, 70); feed(705, 32); feed(710, 6); feed(715, 40); feed(725, 95); feed(730, 100);
check('close call at 6% shown', titles().includes('close:Close Call'), JSON.stringify(cards));
const close = cards.find((c) => c.style === 'close');
check('close call reports lowest health', close?.stats[1].value === '6%', JSON.stringify(close?.stats));
check('close call has peak BPM from the fight', /^1[5-7]\d BPM$/.test(close?.stats[0].value || ''), close?.stats[0].value);
cards = [];

// ── Dropping to 40 % is not a close call ──
feed(760, 40); feed(770, 45); feed(780, 100);
check('40% is no close call (threshold 10%)', cards.length === 0, JSON.stringify(titles()));

// ── Death by a champion ──
feed(720 + 3, 18);
addEvent('ChampionKill', 724, { KillerName: 'Enemy', VictimName: ME, Assisters: [] });
feed(725, 0);
const death = cards.find((c) => c.style === 'death');
check('death card shown with killer', death?.title === 'You Died' && death.kicker === 'vs. Enemy', JSON.stringify(death));
check('death card has HR increase', /BPM$/.test(death?.stats[1].value || '') && death.stats[1].label === 'HR increase', JSON.stringify(death?.stats));
check('dying does not also fire a close call', !cards.some((c) => c.style === 'close'), JSON.stringify(titles()));
cards = [];

// ── Single kill is off by default, multikill is on ──
addEvent('ChampionKill', 1400, { KillerName: ME, VictimName: 'Enemy' });
feed(1401, 60);
check('single kill hidden by default', cards.length === 0, JSON.stringify(titles()));
addEvent('Multikill', 1440, { KillerName: ME, KillStreak: 5 });
feed(1441, 55, { kills: 8, deaths: 1, assists: 5 });
check('pentakill shown', cards.some((c) => c.style === 'penta' && c.title === 'Pentakill'), JSON.stringify(titles()));
cards = [];

// ── Objectives: secured vs stolen ──
addEvent('DragonKill', 1500, { KillerName: ME, DragonType: 'Infernal', Stolen: 'False' });
feed(1501, 80);
const dragon = cards.find((c) => c.style === 'objective');
check('dragon card with type', dragon?.title === 'Dragon Slain' && dragon.kicker === 'Infernal Dragon', JSON.stringify(dragon));
cards = [];
addEvent('BaronKill', 1900, { KillerName: ME, Stolen: 'True' });
feed(1901, 45);
check('stolen baron is its own card', cards.some((c) => c.style === 'steal' && c.title === 'Baron Stolen'), JSON.stringify(titles()));
cards = [];
addEvent('DragonKill', 1950, { KillerName: 'Enemy', DragonType: 'Ocean', Stolen: 'False' });
feed(1951, 70);
check('enemy objective is ignored', cards.length === 0, JSON.stringify(titles()));
cards = [];

// ── First blood only when it is mine ──
addEvent('FirstBlood', 1960, { Recipient: ME });
feed(1961, 90);
check('own first blood shown', cards.some((c) => c.style === 'firstblood'), JSON.stringify(titles()));
cards = [];

// ── Match end ──
addEvent('GameEnd', 1935, { Result: 'Win' });
feed(1936, 100, { kills: 14, deaths: 3, assists: 9 });
const end = cards.find((c) => c.style === 'win');
check('victory card with KDA', end?.title === 'Victory' && end.stats[1].value === '14/3/9', JSON.stringify(end));
check('match peak covers the whole game', end?.stats[0].label === 'Match peak' && /1[5-8]\d BPM/.test(end.stats[0].value), JSON.stringify(end?.stats));
cards = [];
addEvent('GameEnd', 1936, { Result: 'Win' });
feed(1937, 100);
check('game end fires only once', cards.length === 0, JSON.stringify(titles()));

// ── Toggles ──
{
  cards = [];
  const t2 = createTracker({ closeCallPct: 25, cards: { deaths: false, kills: true }, onCard: (c) => cards.push(c), now: () => clock });
  events = []; nextId = 0;
  const f = (gt, hp) => { clock = T0 + gt * 1000; t2.feed(snapshot(raw(gt, hp)), clock); };
  f(100, 100);
  addEvent('ChampionKill', 110, { KillerName: 'Enemy', VictimName: ME });
  f(111, 0);
  check('deaths can be switched off', !cards.some((c) => c.style === 'death'), JSON.stringify(titles()));
  addEvent('ChampionKill', 120, { KillerName: ME, VictimName: 'Enemy' });
  f(121, 90);
  check('single kills can be switched on', cards.some((c) => c.style === 'kill'), JSON.stringify(titles()));
  cards = [];
  f(200, 60); f(205, 19); f(210, 92); f(215, 100);
  check('higher threshold catches a 19% fight', cards.some((c) => c.style === 'close'), JSON.stringify(titles()));
}

// ── Snapshot mapping ──
{
  const s = snapshot(raw(600, 50));
  check('snapshot maps name, champion and health', s.me.name === ME && s.me.champion === 'Jinx' && Math.round(s.me.hpPct) === 50, JSON.stringify(s.me));
  const legacy = snapshot({ activePlayer: { summonerName: 'Old Name', championStats: { currentHealth: 500, maxHealth: 1000 } }, allPlayers: [{ summonerName: 'Old Name', championName: 'Ashe', scores: {} }], gameData: {}, events: { Events: [] } });
  check('old summonerName payloads still work', legacy.me.name === 'Old Name' && legacy.me.champion === 'Ashe', JSON.stringify(legacy.me));
  check('spectating (no active player) is handled', snapshot({ gameData: {}, events: { Events: [] } }).me === null);
}

const failed = checks.filter((x) => !x).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
