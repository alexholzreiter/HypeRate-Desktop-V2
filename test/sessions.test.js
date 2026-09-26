// The session recorder, driven with an explicit clock so no test has to wait.
const ROOT = require('path').join(__dirname, '..', 'src');
const sessions = require(ROOT + '/sessions');
const fs = require('fs');
const os = require('os');
const path = require('path');

const checks = [];
const check = (n, ok, info = '') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${info}`); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperate-sessions-'));
const MIN = 60000;
let T = new Date('2026-09-27T20:00:00Z').getTime();

sessions.init({ dir });
sessions.setOptions({ enabled: true, endAfterMs: 5 * MIN, minLengthMs: 3 * MIN, keepDays: 90, zones: [{ name: 'Low', min: 0, max: 99, color: '#22c55e' }] });

// ── off means off ──
sessions.setOptions({ enabled: false });
sessions.recordBpm(120, T);
check('records nothing while switched off', sessions.current === null);
sessions.setOptions({ enabled: true });

// ── a session starts with the first heart rate ──
sessions.recordBpm(96, T);
check('starts on the first heart rate', sessions.current?.startedAt === T);

// ── one sample per second, gaps stay gaps ──
sessions.recordBpm(98, T + 1000);
sessions.recordBpm(101, T + 2000);
sessions.recordBpm(140, T + 12000);            // ten seconds missing
const file = () => JSON.parse(fs.readFileSync(path.join(dir, `${T}.json`), 'utf8'));
sessions.check(T + 13000);                      // too short to be written yet
check('nothing on disk while the session is too short', !fs.existsSync(path.join(dir, `${T}.json`)));
sessions.recordBpm(120, T + 4 * MIN);          // now it is worth keeping
sessions.check(T + 4 * MIN + 1000);
const s1 = file();
check('stores one value per second', s1.bpm[0] === 96 && s1.bpm[1] === 98 && s1.bpm[2] === 101 && s1.bpm[12] === 140,
  JSON.stringify(s1.bpm.slice(0, 13)));
check('a gap is stored as a gap', s1.bpm.slice(3, 12).every(v => v === null), JSON.stringify(s1.bpm.slice(3, 12)));

// ── moments attach to the running session ──
sessions.recordMoment({ game: 'lol', card: { style: 'penta', title: 'Pentakill', kicker: 'Jinx' }, peakBpm: 178 }, T + 30000);
sessions.recordMoment({ game: 'wow', type: 'death', peakBpm: 161, name: 'Grimspire Raider' }, T + 45000);
sessions.recordMoment({ nonsense: true }, T + 46000);
sessions.check(T + 47000);
const s2 = file();
check('a moment lands with its second and its type', s2.events.length === 2 && s2.events[0].t === 30 && s2.events[0].type === 'pentakill',
  JSON.stringify(s2.events));
check('a moment nothing can name is ignored', s2.events.length === 2);
check('the game with more moments names the session', s2.game === 'lol' || s2.game === 'wow', s2.game);

// ── silence ends it ──
sessions.check(T + 4 * MIN + 4 * MIN);          // four minutes quiet: not yet
check('four minutes of silence are not the end', sessions.current !== null);
sessions.check(T + 4 * MIN + 5 * MIN + 1);      // five: now
check('five minutes of silence end it', sessions.current === null);
check('the finished session is on disk', fs.existsSync(path.join(dir, `${T}.json`)));
check('the end is the last heart rate, not the silence', file().endedAt === T + 4 * MIN, String(file().endedAt - T));

// ── a session that is too short is thrown away ──
const T2 = T + 60 * MIN;
sessions.recordBpm(99, T2);
sessions.recordBpm(101, T2 + 40000);            // forty seconds
sessions.check(T2 + 40000 + 5 * MIN + 1);
check('a session under three minutes is discarded', !fs.existsSync(path.join(dir, `${T2}.json`)));

// ── the list summarises without loading everything ──
const liste = sessions.list();
check('the list has the one real session', liste.length === 1 && liste[0].startedAt === T, JSON.stringify(liste));
check('the summary counts correctly', liste[0].peak === 140 && liste[0].avg > 0 && liste[0].events === 2, JSON.stringify(liste[0]));

// ── switching off closes what is running ──
const T3 = T + 200 * MIN;
sessions.recordBpm(105, T3);
sessions.recordBpm(108, T3 + 4 * MIN);
sessions.setOptions({ enabled: false });
check('switching off closes the running session', sessions.current === null && fs.existsSync(path.join(dir, `${T3}.json`)));
sessions.setOptions({ enabled: true });

// ── retention ──
const alt = T - 200 * 24 * 60 * MIN;
fs.writeFileSync(path.join(dir, `${alt}.json`), JSON.stringify({ v: 1, startedAt: alt, endedAt: alt + MIN, bpm: [90], events: [] }));
sessions.prune(T);
check('a session past the retention is removed', !fs.existsSync(path.join(dir, `${alt}.json`)));
check('recent sessions survive the pruning', fs.existsSync(path.join(dir, `${T}.json`)));

// ── the one call that removes everything ──
sessions.deleteAll();
check('delete all empties the folder', sessions.list().length === 0 && fs.readdirSync(dir).length === 0, fs.readdirSync(dir).join(','));

sessions.stop();
fs.rmSync(dir, { recursive: true, force: true });

const failed = checks.filter(x => !x).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
