// Drives the real module against a fake Live Client Data server on port 2999.
const https = require('https');
const { selfSigned } = require('./helpers/cert');

// The module reads the port when it is required, so this has to happen first
process.env.HYPERATE_LOL_PORT = process.env.HYPERATE_LOL_PORT || '29990';

let tls;
try {
  tls = selfSigned();
} catch {
  console.log('SKIP lol-e2e: openssl is needed to create the test certificate');
  process.exit(2);
}
const ROOT = require('path').join(__dirname, '..', 'src');
const moments = require(ROOT + '/moments');
const lol = require(ROOT + '/games/lol');

const checks = []; const check = (n, ok, i='') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${i}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let hp = 100, events = [], id = 0, gameTime = 600;
const payload = () => JSON.stringify({
  activePlayer: { riotIdGameName: 'Woodryda', championStats: { currentHealth: 20 * hp, maxHealth: 2000 } },
  allPlayers: [{ riotIdGameName: 'Woodryda', championName: 'Jinx', team: 'ORDER', scores: { kills: 4, deaths: 1, assists: 6 } }],
  gameData: { gameTime, gameMode: 'CLASSIC', mapName: "Summoner's Rift" },
  events: { Events: events },
});

const server = https.createServer({ key: tls.key, cert: tls.cert },
  (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(payload()); });

(async () => {
  for (let t = Date.now() - 120000; t <= Date.now(); t += 5000) moments.recordBpm(t % 20000 < 10000 ? 96 : 158, t);
  const statuses = []; const cards = [];
  lol.init({ onStatus: (s, x) => statuses.push([s, x]), onCard: (c) => cards.push(c) });

  lol.start({ closeCallPct: 10 });
  await sleep(600);
  check('no game running → waiting', statuses.at(-1)?.[0] === 'waiting', JSON.stringify(statuses));

  await new Promise(r => server.listen(Number(process.env.HYPERATE_LOL_PORT), '127.0.0.1', r));
  await sleep(2600);
  check('game detected → active', statuses.at(-1)?.[0] === 'active', JSON.stringify(statuses.at(-1)));
  check('status carries mode and champion', statuses.at(-1)?.[1].champion === 'Jinx' && statuses.at(-1)[1].mode === 'CLASSIC', JSON.stringify(statuses.at(-1)?.[1]));

  hp = 60; await sleep(400); hp = 7; await sleep(400); hp = 55; await sleep(400); hp = 100; await sleep(3000);
  check('close call reaches the overlay', cards.some(c => c.style === 'close' && c.stats[1].value === '7%'), JSON.stringify(cards));

  events.push({ EventID: id++, EventName: 'Multikill', EventTime: gameTime + 5, KillerName: 'Woodryda', KillStreak: 5 });
  await sleep(700);
  check('pentakill reaches the overlay', cards.some(c => c.style === 'penta'), JSON.stringify(cards.map(c => c.style)));

  await new Promise(r => server.close(r));
  await sleep(9000);
  check('game closed → waiting again', statuses.at(-1)?.[0] === 'waiting', JSON.stringify(statuses.at(-1)));
  check('no error state for a closed port', !statuses.some(s => s[0] === 'error'), JSON.stringify(statuses.filter(s => s[0] === 'error')));

  lol.stop();
  const failed = checks.filter(x => !x).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
