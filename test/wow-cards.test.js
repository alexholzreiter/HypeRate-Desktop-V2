// Card toggles for WoW: disabled session cards must be skipped, enabled ones still appear.
const ROOT = require('path').join(__dirname, '..', 'src');
const moments = require(ROOT + '/moments');
const { createInsights } = require(ROOT + '/games/wow/insights');

const checks = []; const check = (n, ok, i='') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${i}`); };
const CHAR = 'Player-1-00000001';
let clock = Date.now() - 3 * 3600e3;
const now = () => clock;

// seed BPM for the stretch a scenario is about to use (history must stay in time order)
function seed(ms = 20 * 60000) {
  for (let t = clock - 60000; t < clock + ms; t += 5000) moments.recordBpm(t % 30000 < 15000 ? 82 : 150 + (t % 7), t);
}

function fightsFor(ins, key, n = 6) {
  for (let i = 0; i < n; i++) {
    const f = { startedAt: clock, endedAt: clock + 30000, died: false, lowestHp: 70, lowestAt: clock + 10000, lowestBy: null,
                enemies: [{ key, name: key.toUpperCase(), guids: [`Creature-0-1-0-1-${key}-${i}`] }] };
    clock += 31000;
    ins.touch(CHAR, clock);
    ins.addFight(CHAR, f);
  }
}

{
  seed();
  const ins = createInsights({ now });
  fightsFor(ins, 'scout');
  check('intense card appears by default', ins.nextCard(clock)?.title === 'Most Intense Enemy');
}
{
  clock += 30 * 60000;
  seed();
  const ins = createInsights({ now, cards: { intense: false } });
  fightsFor(ins, 'scout');
  const titles = [];
  for (let i = 0; i < 3; i++) { titles.push(ins.nextCard(clock)?.title || null); clock += 3 * 60000; }
  check('intense card stays hidden when switched off', !titles.includes('Most Intense Enemy'), JSON.stringify(titles));
  check('other cards still come through', titles.some(Boolean), JSON.stringify(titles));
}
{
  clock += 30 * 60000;
  seed();
  const ins = createInsights({ now, cards: { intense: false } });
  ins.setCards({ intense: true });
  fightsFor(ins, 'wolf');
  check('setCards can switch it back on', ins.nextCard(clock)?.title === 'Most Intense Enemy');
}

const failed = checks.filter(x => !x).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
