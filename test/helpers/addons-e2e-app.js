// Runs inside Electron (started by test/addons-e2e.test.js): the example addons from
// test/fixtures/addons go through the real addon host, and each case is checked.
const { app, BrowserWindow, screen, protocol } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAddonHost, ADDON_SCHEME } = require('../../src/addons/host');
protocol.registerSchemesAsPrivileged([ADDON_SCHEME]);   // as the app does

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperate-addons-e2e-'));
app.setPath('userData', path.join(tmp, 'user-data'));
const root = path.join(tmp, 'addons');
fs.cpSync(path.join(__dirname, '..', 'fixtures', 'addons'), root, { recursive: true });

let store = { addonsEnabled: true, addons: { 'too-big': { overlay: { on: true, scale: 200 } } } };
const loadStore = () => JSON.parse(JSON.stringify(store));
const saveStore = (s) => { store = JSON.parse(JSON.stringify(s)); };

let failed = 0;
const check = (name, ok, info = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' → ' + info}`); };
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const windowOf = (id) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith(`hr-addon://${id}/overlay.html`));
const hiddenOf = (id) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL() === `hr-addon://${id}/`);

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  // the app's integrations, as stand-ins: VRChat and Home Assistant on, Discord off
  const sent = [];
  const bridge = {
    discordStatus: (text) => { sent.push(['discord', text]); return { ok: false, reason: 'off' }; },
    vrchatChatbox: (text) => { sent.push(['chatbox', text]); return { ok: true }; },
    vrchatParameter: (name, value) => { sent.push(['param', name, value]); return { ok: true }; },
    homeAssistantEvent: (id, name, data) => { sent.push(['ha', id, name, data]); return { ok: true }; },
  };
  const host = createAddonHost({
    root, dataDir: path.join(tmp, 'addon-data'), loadStore, saveStore,
    overlayInfo: () => ({ allSpaces: false, anchor: null }),
    cpu: { limit: 40, samples: 3, every: 500 },
    bridge,
  });
  const item = (id) => host.list().addons.find(a => a.manifest?.id === id);
  const logText = (id) => host.logs(id).map(l => l.text).join('\n');

  host.sync();
  for (const a of host.list().addons) if (a.manifest) host.approve(a.manifest.id, a.fingerprint);
  await wait(1500);

  // the guide in an addon folder follows the app, the task stays
  const guide = fs.readFileSync(path.join(root, 'wishes', 'AGENTS.md'), 'utf8');
  check('an outdated AGENTS.md is replaced by the current guide', guide.includes('WISHES.md') && !guide.includes('an outdated guide'));
  check('… and keeps the task', guide.trim().endsWith('Warn me when my pulse is high.'));
  check('WISHES.md shows as wishes', item('wishes').wishes.map(w => w.title).join('|') === 'Buttons in the overlay|Keyboard shortcut', JSON.stringify(item('wishes').wishes));

  // overlay windows come and go with the overlay
  check('overlay windows wait while the overlay is off', windowOf('tile') && !windowOf('tile').isVisible());
  host.setOverlayVisible(true);
  await wait(500);
  check('… and show with it', windowOf('tile')?.isVisible() === true);
  for (let bpm = 80; bpm < 84; bpm++) { host.emit('heartRate', { bpm }); await wait(150); }
  await wait(500);
  check('main.js reaches its overlay with hyperate.send', /\[overlay\] got 4/.test(logText('tile')), logText('tile'));

  const display = screen.getPrimaryDisplay().bounds;
  const edge = windowOf('screen-edge')?.getBounds();
  check('a screen addon covers the whole screen', edge && edge.x === display.x && edge.y === display.y && edge.width === display.width && edge.height === display.height, JSON.stringify(edge));

  const big = windowOf('too-big')?.getBounds();
  const area = screen.getPrimaryDisplay().workArea;
  check('a window bigger than a third of the screen is made smaller', big && big.width * big.height <= area.width * area.height / 3 + 2 * (big.width + big.height), JSON.stringify(big));
  check('… and says so on its page', item('too-big').limits.some(l => l.kind === 'window-size'));

  const blocked = item('blocked').limits.map(l => l.kind + ':' + l.detail);
  check('a host not in "network" is blocked and named', blocked.includes('network:example.com'), blocked.join(', '));
  check('inline script is blocked and named', blocked.includes('inline:') && windowOf('blocked')?.webContents.getTitle() !== 'INLINE RAN', blocked.join(', '));
  check('storage without the permission is refused and named', blocked.includes('permission:storage') && /storage false/.test(logText('blocked')), blocked.join(', '));
  check('… and the fetch never went through', !/FETCH WENT THROUGH/.test(logText('blocked')));

  // Discord, VRChat and Home Assistant through the app
  const bridgeLog = logText('bridge');
  check('the bridge answers every call', /bridge done/.test(bridgeLog), bridgeLog);
  check('VRChat chatbox and parameters go through, with their types', /chatbox ok/.test(bridgeLog) && /param-bool ok/.test(bridgeLog) && /param-int ok/.test(bridgeLog) && /param-float ok/.test(bridgeLog)
    && JSON.stringify(sent.filter(s => s[0] === 'param')) === JSON.stringify([['param', 'BossDown', true], ['param', 'Kills', 3], ['param', 'Heat', 0.5]]), JSON.stringify(sent));
  check('a parameter name with a path or a space is refused', /param-bad invalid/.test(bridgeLog) && !sent.some(s => s[1] === '/avatar/parameters/x y'));
  check('a Home Assistant event carries the addon id, its name and data', sent.some(s => s[0] === 'ha' && s[1] === 'bridge' && s[2] === 'boss_down' && s[3].bpm === 142) && /ha-bad invalid/.test(bridgeLog), JSON.stringify(sent));
  check('an integration that is off says so, on the addon page too', /discord off/.test(bridgeLog) && item('bridge').limits.some(l => l.kind === 'integration-off' && l.detail === 'discord'));
  check('too many calls are refused, not passed on', /discord-again too-fast/.test(bridgeLog) && sent.filter(s => s[0] === 'discord').length === 1, JSON.stringify(sent));
  check('without the permission nothing goes through', /discord permission/.test(logText('blocked')) && !sent.some(s => s[1] === 'not allowed') && blocked.includes('permission:discord'), logText('blocked'));

  check('an addon without "sound" is muted', hiddenOf('tile')?.webContents.isAudioMuted() === true);
  check('an addon with "sound" is not', hiddenOf('sound')?.webContents.isAudioMuted() === false);

  // too much processor time: stopped, and it stays stopped until restarted
  await wait(2500);
  check('an addon using too much CPU is stopped', !item('busy').running && /processor/.test(item('busy').error || ''), JSON.stringify({ running: item('busy').running, error: item('busy').error }));
  check('… with a reason on its page', item('busy').limits.some(l => l.kind === 'cpu'));
  host.reload();
  await wait(300);
  check('… and stays stopped when the folder is read again', !item('busy').running);
  host.reload('busy');
  await wait(300);
  check('a restart by the user starts it again', item('busy').running);
  host.setEnabled('busy', false);

  // a change asks again
  fs.appendFileSync(path.join(root, 'tile', 'main.js'), '\n// changed\n');
  await wait(1500);
  check('a changed addon stops and waits for a new OK', !item('tile').running && !item('tile').approved && !windowOf('tile'));

  host.setOverlayVisible(false);
  check('hiding the overlay hides screen addons too', windowOf('screen-edge')?.isVisible() === false);
  host.setMaster(false);
  await wait(300);
  check('the master switch stops everything', host.list().addons.every(a => !a.running) && !BrowserWindow.getAllWindows().some(w => w.webContents.getURL().startsWith('hr-addon://')));

  host.stopAll();
  fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(failed ? 1 : 0);
}).catch((error) => { console.log('FAIL crashed → ' + error.stack); app.exit(1); });
