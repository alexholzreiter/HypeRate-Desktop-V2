const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readManifest, fingerprint, fingerprints, needsApproval, scan } = require('../src/addons/manifest');

function check(name, fn) { fn(); console.log('PASS ' + name); }
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hyperate-addons-'));
function addon(root, folder, manifest, code = 'hyperate.log("hi")') {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  if (manifest !== undefined) fs.writeFileSync(path.join(dir, 'addon.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (code !== null) fs.writeFileSync(path.join(dir, 'main.js'), code);
  return dir;
}
const good = { id: 'pulse-light', name: 'Pulse light', version: '1.0.0', permissions: ['heartRate', 'zones'], network: ['api.example.com'] };

check('a complete addon is read with its permissions and hosts', () => {
  const m = readManifest(addon(tmp(), 'a', good));
  assert.equal(m.id, 'pulse-light');
  assert.deepEqual(m.permissions, ['heartRate', 'zones']);
  assert.deepEqual(m.network, ['api.example.com']);
});

check('optional fields may be empty, as in the template', () => {
  const m = readManifest(addon(tmp(), 'a', { ...good, author: '', description: '' }));
  assert.equal(m.author, '');
  const t = readManifest(path.join(__dirname, '..', 'src', 'addons', 'template'));
  assert.equal(t.id, 'my-first-addon');
});

check('broken manifests say what is wrong', () => {
  const root = tmp();
  const err = (folder, manifest, code) => { try { readManifest(addon(root, folder, manifest, code)); return null; } catch (e) { return e.message; } };
  assert.match(err('b', undefined), /missing/);
  assert.match(err('c', '{nope'), /not valid JSON/);
  assert.match(err('d', { ...good, id: 'Bad ID' }), /"id"/);
  assert.match(err('e', { ...good, permissions: ['heartRate', 'files'] }), /unknown permission: files/);
  assert.match(err('f', { ...good, network: ['https://x.com/path'] }), /host names only/);
  assert.match(err('g', good, null), /main.js is missing/);
});

check('the fingerprint changes with any file and asks again', () => {
  const dir = addon(tmp(), 'a', good);
  const m = readManifest(dir), p1 = fingerprint(dir);
  const granted = { fingerprint: p1, permissions: m.permissions, network: m.network };
  assert.equal(needsApproval(m, p1, granted), false);
  fs.writeFileSync(path.join(dir, 'main.js'), 'hyperate.log("changed")');
  assert.notEqual(fingerprint(dir), p1);
  assert.equal(needsApproval(m, fingerprint(dir), granted), true);
  assert.equal(needsApproval(m, p1, null), true);
  assert.equal(needsApproval({ ...m, network: ['other.example.com'] }, p1, granted), true);
});

check('symlinks out of the folder are refused', () => {
  const root = tmp();
  const dir = addon(root, 'a', good);
  fs.symlinkSync('/etc', path.join(dir, 'escape'));
  assert.throws(() => fingerprint(dir), /symbolic links/);
});

check('scan lists every folder; a broken one or a duplicate id does not stop the rest', () => {
  const root = tmp();
  addon(root, 'one', good);
  addon(root, 'two', { ...good, name: 'Copy' });
  addon(root, 'three', '{x');
  const list = scan(root);
  assert.equal(list.length, 3);
  assert.equal(list.find(a => a.folder === 'one').error, null);
  assert.match(list.find(a => a.folder === 'two').error, /already uses the id/);
  assert.match(list.find(a => a.folder === 'three').error, /JSON/);
  assert.deepEqual(scan(path.join(root, 'nope')), []);
});

const { settingValue, settingValues } = require('../src/addons/manifest');
check('settings are read with defaults, and values are kept within what they allow', () => {
  const m = readManifest(addon(tmp(), 'a', { ...good, settings: [
    { key: 'limit', type: 'number', label: 'Limit', default: 120, min: 40, max: 220 },
    { key: 'color', type: 'color', default: '#FF0000' },
    { key: 'mode', type: 'select', options: ['soft', 'hard'] },
    { key: 'on', type: 'toggle', default: true },
  ] }));
  assert.deepEqual(m.settings.map(s => s.default), [120, '#ff0000', 'soft', true]);
  const [limit, color, mode] = m.settings;
  assert.equal(settingValue(limit, 999), 220);
  assert.equal(settingValue(limit, 'x'), 120);
  assert.equal(settingValue(color, 'red'), '#ff0000');
  assert.equal(settingValue(mode, 'evil'), 'soft');
  assert.deepEqual(settingValues(m, { limit: 150, mode: 'hard', unknown: 1 }), { limit: 150, color: '#ff0000', mode: 'hard', on: true });
  const err = (settings) => { try { readManifest(addon(tmp(), 'b', { ...good, settings })); return null; } catch (e) { return e.message; } };
  assert.match(err([{ key: 'a b', type: 'number' }]), /simple name/);
  assert.match(err([{ key: 'a', type: 'file' }]), /"type" must be/);
  assert.match(err([{ key: 'a', type: 'select' }]), /needs "options"/);
  assert.match(err([{ key: 'a', type: 'text' }, { key: 'a', type: 'text' }]), /twice/);
});

check('the overlay permission needs overlay.html and keeps the size within limits', () => {
  const root = tmp();
  const err = (folder, extra, withHtml) => {
    const dir = addon(root, folder, { ...good, permissions: ['overlay'], ...extra });
    if (withHtml) fs.writeFileSync(path.join(dir, 'overlay.html'), '<div>hi</div>');
    try { return readManifest(dir); } catch (e) { return e.message; }
  };
  assert.match(err('a', {}, false), /needs an overlay.html/);
  assert.deepEqual(err('b', {}, true).overlay, { mode: 'window', width: 300, height: 120 });
  assert.deepEqual(err('c', { overlay: { width: 5000, height: 10 } }, true).overlay, { mode: 'window', width: 1200, height: 30 });
  assert.deepEqual(err('f', { overlay: { mode: 'screen', width: 9 } }, true).overlay, { mode: 'screen' });
  assert.match(err('g', { overlay: { mode: 'huge' } }, true), /must be "window" or "screen"/);
  assert.match(err('d', { overlay: { width: 'big' } }, true), /must be a number/);
  assert.equal(readManifest(addon(root, 'e', good)).overlay, null);
});

check('AGENTS.md is not part of the fingerprint, so the app can keep the guide current', () => {
  const dir = addon(tmp(), 'a', good);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'old guide');
  const p1 = fingerprint(dir);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'new guide');
  assert.equal(fingerprint(dir), p1);
});

check('a git repo in the folder (or other dot entries) does not change the fingerprint', () => {
  const dir = addon(tmp(), 'a', good);
  const p1 = fingerprint(dir);
  fs.mkdirSync(path.join(dir, '.git', 'objects'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'objects', 'x'), 'commit');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules');
  fs.mkdirSync(path.join(dir, 'img', '.cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'img', '.cache', 'y'), 'z');
  assert.equal(fingerprint(dir), p1);
  // what earlier versions worked out still counts as approved
  const old = fingerprint(dir, { legacy: true });
  assert.notEqual(old, p1);
  assert.deepEqual(fingerprints(dir), [p1, old]);
  const m = readManifest(dir);
  assert.equal(needsApproval(m, fingerprints(dir), { fingerprint: old, permissions: m.permissions, network: m.network }), false);
  assert.equal(needsApproval(m, fingerprints(dir), { fingerprint: p1, permissions: m.permissions, network: m.network }), false);
  // without dot entries there is only one
  assert.deepEqual(fingerprints(addon(tmp(), 'b', good)), [fingerprint(addon(tmp(), 'b', good))]);
});

check('sharing sends each file with its hash, the same files the fingerprint covers', () => {
  const dir = addon(tmp(), 'a', good);
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'guide');
  const r = fingerprint(dir, { files: true });
  assert.equal(r.fingerprint, fingerprint(dir));
  assert.deepEqual(r.files.map(f => f.path), ['addon.json', 'main.js']);
  assert.match(r.files[0].sha256, /^[0-9a-f]{64}$/);
});
