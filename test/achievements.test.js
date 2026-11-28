// Steam achievements: when each one is earned, driven with a fake store and an explicit clock.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { ACHIEVEMENTS, STATS, createAchievements, usesOwnLook } = require(ROOT + '/src/achievements');

const checks = [];
const check = (n, ok, info = '') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${info}`); };

const MIN = 60000;
function setup(stats = {}, start = new Date(2026, 5, 10, 20, 0, 0).getTime()) {
  let T = start;
  const store = {
    unlocked: [], stats: { ...stats }, saves: 0,
    unlock(api) { this.unlocked.push(api); return true; },
    getStat(name) { return this.stats[name] ?? null; },
    setStat(name, value) { this.stats[name] = value; },
    save() { this.saves++; },
  };
  const a = createAchievements(store, { now: () => T });
  // a heartbeat every second for ms
  const beat = (ms, source = 'cloud') => { const end = T + ms; while (T < end) { T += 1000; a.heartbeat(80, source, T); } };
  return { a, store, beat, at: () => T, jump: (ms) => { T += ms; } };
}

// ── the first heartbeat, and where it came from ──
{
  const { a, store } = setup();
  a.heartbeat(0, 'cloud');
  check('a zero is not a heartbeat', store.unlocked.length === 0, store.unlocked);
  a.heartbeat(72, 'cloud');
  a.heartbeat(73, 'cloud');
  check('first heartbeat unlocks once', store.unlocked.join() === 'FIRST_HEARTBEAT', store.unlocked);
  a.heartbeat(74, 'ble');
  check('bluetooth unlocks its own', store.unlocked.includes('BLE_DIRECT'), store.unlocked);
}

// ── time with a heartbeat, counted in minutes, sent to Steam now and then ──
{
  const { a, store, beat } = setup({ [STATS.minutes]: 58 });
  beat(90 * 1000);
  check('one more minute after 60 seconds of heartbeats', a.counters.minutes === 59, a.counters);
  beat(31 * 1000);
  check('an hour in all unlocks hours_1', store.unlocked.includes('HOURS_1'), store.unlocked);
  check('counters are not sent every second', store.saves <= 1, store.saves);
  a.flush();
  check('flush sends the minutes', store.stats[STATS.minutes] === 60, store.stats);
}
{
  const { a, store } = setup({ [STATS.minutes]: 600, [STATS.sessions]: 10 });
  check('earned before: unlocked at start', ['HOURS_1', 'HOURS_10', 'SESSIONS_10'].every((x) => store.unlocked.includes(x)) && !store.unlocked.includes('HOURS_100'), store.unlocked);
  a.flush();
}
{
  const { a, beat, jump } = setup();
  beat(30 * 1000);
  jump(60 * MIN);                // the app was closed for an hour
  a.heartbeat(80, 'cloud');
  check('a long silence adds no time', a.counters.minutes === 0, a.counters);
}

// ── sessions: three minutes make one, five minutes of silence end it ──
{
  const { a, beat, jump } = setup();
  beat(2 * MIN);
  check('two minutes are no session', a.counters.sessions === 0, a.counters);
  beat(1 * MIN + 1000);
  check('three minutes are one', a.counters.sessions === 1, a.counters);
  beat(10 * MIN);
  check('the same session counts once', a.counters.sessions === 1, a.counters);
  jump(6 * MIN);
  beat(4 * MIN);
  check('after a pause a new one counts', a.counters.sessions === 2, a.counters);
  jump(2 * MIN);
  beat(4 * MIN);
  check('a short break does not start a new one', a.counters.sessions === 2, a.counters);
}
{
  const { store, beat } = setup();
  beat(4 * 60 * MIN - 2000);
  check('just under four hours is no marathon', !store.unlocked.includes('MARATHON'));
  beat(3000);
  check('four hours without a stop are a marathon', store.unlocked.includes('MARATHON'), store.unlocked);
}

// ── the two hidden ones go by the local date ──
{
  const { a, store } = setup({}, new Date(2026, 11, 24, 18, 0).getTime());
  a.heartbeat(80, 'cloud', new Date(2026, 11, 24, 18, 0).getTime());
  check('Christmas Eve', store.unlocked.includes('HEART_CHRISTMAS'), store.unlocked);
}
{
  const { a, store } = setup({}, new Date(2026, 11, 31, 23, 50).getTime());
  a.heartbeat(80, 'cloud', new Date(2026, 11, 31, 23, 50).getTime());
  check('not before midnight', !store.unlocked.includes('HEART_NEW_YEAR'), store.unlocked);
  a.heartbeat(80, 'cloud', new Date(2027, 0, 1, 0, 3).getTime());
  check('right after midnight', store.unlocked.includes('HEART_NEW_YEAR'), store.unlocked);
}

// ── game moments ──
{
  const { a, store } = setup();
  a.moment({ game: 'wow', type: 'boss', hrIncrease: 25, test: true });
  check('a test moment unlocks nothing', store.unlocked.length === 0, store.unlocked);
  a.moment({ game: 'wow', type: 'boss', hrIncrease: 25 });
  check('a boss kill', ['FIRST_MOMENT', 'BOSS_DOWN'].every((x) => store.unlocked.includes(x)) && !store.unlocked.includes('ICE_COLD'), store.unlocked);
  a.moment({ game: 'wow', type: 'boss', hrIncrease: null });
  check('no heart rate is not ice cold', !store.unlocked.includes('ICE_COLD'));
  a.moment({ game: 'wow', type: 'boss', hrIncrease: 9 });
  check('a calm boss kill is ice cold', store.unlocked.includes('ICE_COLD'));
  a.moment({ game: 'wow', type: 'close', lowestHealthPct: 8 });
  check('8 % left is not close enough', !store.unlocked.includes('CLOSE_CALL'));
  a.moment({ game: 'wow', type: 'close', lowestHealthPct: 4 });
  check('4 % left is a close call', store.unlocked.includes('CLOSE_CALL'));
  a.moment({ game: 'lol', card: { style: 'multikill' } });
  check('a multikill is no pentakill', !store.unlocked.includes('PENTAKILL'));
  a.moment({ game: 'lol', card: { style: 'penta' } });
  check('a pentakill', store.unlocked.includes('PENTAKILL'));
}

// ── one-off events ──
{
  const { a, store } = setup();
  for (const name of ['overlay', 'look', 'zones', 'card', 'discord', 'osc', 'mqtt', 'addon', 'overlay', 'nonsense']) a.event(name);
  check('each event unlocks its own once',
    store.unlocked.join() === 'FIRST_OVERLAY,OWN_LOOK,ZONES_SET,SHARE_CARD,DISCORD_LIVE,VRCHAT_LIVE,SMART_HOME,ADDON_FIRST', store.unlocked);
}
check('own look: an hr-asset in the config', usesOwnLook({ heart: { src: 'hr-asset://a/x.svg' } }) && !usesOwnLook({ heart: 'classic' }) && !usesOwnLook(null));

// ── the list, the portal texts and the icons belong together ──
{
  const texts = JSON.parse(fs.readFileSync(ROOT + '/steam/achievements/achievements.json', 'utf8'));
  const ids = ACHIEVEMENTS.map((x) => x.id);
  check('a text for every achievement, same order', JSON.stringify(texts.achievements.map((x) => x.id)) === JSON.stringify(ids), texts.achievements.map((x) => x.id));
  const missing = texts.achievements.filter((x) => !x.name_de || !x.name_en || !x.desc_de || !x.desc_en).map((x) => x.id);
  check('every text in German and English', !missing.length, missing);
  const icons = ids.filter((id) => !fs.existsSync(`${ROOT}/steam/achievements/icons/${id}.png`) || !fs.existsSync(`${ROOT}/steam/achievements/icons/${id}_locked.png`));
  check('an icon and a locked icon for each', !icons.length, icons);
}

const failed = checks.filter(x => !x).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
