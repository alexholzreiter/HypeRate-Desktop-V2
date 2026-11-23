const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { importAsset, removeAsset, resolveAsset, AssetError } = require('../src/custom-assets');

function check(name, fn) {
  fn();
  console.log('PASS ' + name);
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hyperate-assets-'));
function source(name, bytes = 100) {
  const dir = tmp();
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(bytes, 1));
  return file;
}
const code = (fn) => { try { fn(); } catch (e) { return e instanceof AssetError ? e.code : 'other:' + e.message; } return null; };

check('a heart image is copied under a random name and keeps its display name', () => {
  const dir = tmp();
  const { file, name } = importAsset({ kind: 'heart', source: source('My Heart.PNG'), dir });
  assert.match(file, /^heart-[0-9a-f]{16}\.png$/);
  assert.equal(name, 'My Heart');
  assert.ok(fs.existsSync(path.join(dir, file)));
});

check('a font is accepted, a font file posing as a heart is not', () => {
  const dir = tmp();
  assert.match(importAsset({ kind: 'font', source: source('Cool.woff2'), dir }).file, /^font-[0-9a-f]{16}\.woff2$/);
  assert.equal(code(() => importAsset({ kind: 'heart', source: source('Cool.ttf'), dir })), 'type');
  assert.equal(code(() => importAsset({ kind: 'font', source: source('evil.exe'), dir })), 'type');
});

check('files over the limit and empty files are refused', () => {
  const dir = tmp();
  assert.equal(code(() => importAsset({ kind: 'heart', source: source('big.png', 2 * 1024 * 1024 + 1), dir })), 'size');
  assert.equal(code(() => importAsset({ kind: 'heart', source: source('empty.png', 0), dir })), 'empty');
  assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], 'nothing was copied');
});

check('the protocol only answers for our own files in the folder', () => {
  const dir = tmp();
  const { file } = importAsset({ kind: 'heart', source: source('a.svg'), dir });
  const ok = resolveAsset({ url: 'hr-asset://a/' + file, dir });
  assert.equal(ok.path, path.join(dir, file));
  assert.equal(ok.type, 'image/svg+xml');
  fs.writeFileSync(path.join(dir, 'settings.json'), '{}');
  for (const url of ['hr-asset://a/settings.json', 'hr-asset://a/..%2Fsettings.json', 'hr-asset://a/sub/' + file, 'hr-asset://a/heart-0000000000000000.png', 'not a url']) {
    assert.equal(resolveAsset({ url, dir }), null, url);
  }
});

check('removing deletes only names the app made', () => {
  const dir = tmp();
  const { file } = importAsset({ kind: 'font', source: source('x.otf'), dir });
  fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
  assert.equal(removeAsset({ file: 'keep.txt', dir }), false);
  assert.equal(removeAsset({ file, dir }), true);
  assert.deepEqual(fs.readdirSync(dir), ['keep.txt']);
});
