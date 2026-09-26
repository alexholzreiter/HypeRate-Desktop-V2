// Regression test against a real recorded match: the card sequence must stay stable.
const fs = require('fs');
const ROOT = require('path').join(__dirname, '..', 'src');
const moments = require(ROOT + '/moments');
const { createTracker } = require(ROOT + '/games/lol/tracker');

const fx = JSON.parse(fs.readFileSync(__dirname + '/fixtures/lol-match.json', 'utf8'));
const hs = fx.healthSeries, t0 = hs[0][0];
for (let t = t0 - 60000; t <= hs.at(-1)[0] + 60000; t += 5000) moments.recordBpm(120, t);

const cards = [];
let clock = t0;
const tracker = createTracker({ closeCallPct: 10, onCard: (c) => cards.push(c), now: () => clock });
const gt = (wall) => (wall - t0) / 1000 + 108;   // recording started at game time 108 s

for (const [ts, hp, maxHp] of hs) {
  clock = ts;
  tracker.feed({
    gameTime: gt(ts), gameMode: 'TUTORIAL_MODULE_2',
    me: { name: 'Woodryda', champion: 'Miss Fortune', team: 'ORDER', hp, maxHp, hpPct: (100 * hp) / maxHp, dead: hp === 0, kills: 1, deaths: 3, assists: 2 },
    events: fx.events.filter((e) => e.EventTime <= gt(ts)),
  }, ts);
}

const got = cards.map((c) => `${c.style}:${c.title}`);
const want = [
  'close:Close Call', 'death:You Died', 'close:Close Call', 'death:You Died',
  'objective:Turret Destroyed', 'death:You Died', 'objective:Turret Destroyed',
  'objective:Inhibitor Down', 'objective:Turret Destroyed', 'win:Victory',
];
const ok = JSON.stringify(got) === JSON.stringify(want);
console.log(ok ? 'PASS real match replays to the expected cards' : 'FAIL real match');
if (!ok) { console.log('  got :', got.join(' | ')); console.log('  want:', want.join(' | ')); }

const killers = cards.filter((c) => c.style === 'death').map((c) => c.kicker);
const namesOk = killers.every((k) => !/Turret_|SRU_|Minion_|-Bot/.test(k));
console.log(namesOk ? 'PASS killer names are readable' : `FAIL killer names: ${killers.join(', ')}`);
console.log(`\ndeaths: ${killers.join(' · ')}`);
process.exit(ok && namesOk ? 0 : 1);
