// The example addons (test/fixtures/addons) in a real Electron: overlay windows, screen mode,
// what is blocked, sound, the processor check, wishes and the guide. See helpers/addons-e2e-app.js.
const { spawnSync } = require('child_process');
const path = require('path');

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.log('SKIP addons-e2e: needs a display');
  process.exit(2);
}
let electron;
try { electron = require('electron'); } catch {
  console.log('SKIP addons-e2e: electron is not installed');
  process.exit(2);
}
const run = spawnSync(electron, [path.join(__dirname, 'helpers', 'addons-e2e-app.js')], { encoding: 'utf8', timeout: 60000, env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' } });
process.stdout.write(run.stdout || '');
const noise = (run.stderr || '').split('\n').filter(l => /^(PASS|FAIL)/.test(l));
if (noise.length) process.stdout.write(noise.join('\n') + '\n');
if (run.error) { console.log('FAIL electron did not run → ' + run.error.message); process.exit(1); }
process.exit(run.status === 0 ? 0 : 1);
