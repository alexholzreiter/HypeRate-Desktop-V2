const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SCHEMA_VERSION, migrateStore, importFromStableInstall } = require('../src/store-migration');

function check(name, fn) {
  fn();
  console.log('PASS ' + name);
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hyperate-store-'));
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

check('a v1 store without a version gets the current one and keeps its keys', () => {
  const v1 = { hrId: 'abc123', onboarded: true, lang: 'de' };
  const migrated = migrateStore(v1);
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION);
  assert.equal(migrated.hrId, 'abc123');
  assert.equal(migrated.onboarded, true);
  assert.equal(v1.schemaVersion, undefined, 'the input object is not changed');
});

check('an empty store is migrated too', () => {
  assert.deepEqual(migrateStore({}), { schemaVersion: SCHEMA_VERSION });
});

check('a current store comes back as the same object', () => {
  const current = { schemaVersion: SCHEMA_VERSION, lang: 'en' };
  assert.equal(migrateStore(current), current);
});

check('the beta imports settings and sessions from v1 on its first start', () => {
  const v1 = tempDir();
  const beta = path.join(tempDir(), 'beta');
  write(v1, 'settings.json', '{"hrId":"abc123"}');
  write(v1, 'wow-sessions.json', '[]');
  write(v1, 'sessions/2026-11-23.json', '{}');
  const copied = importFromStableInstall({ fromDir: v1, toDir: beta });
  assert.deepEqual(copied, ['settings.json', 'wow-sessions.json', 'sessions']);
  assert.equal(fs.readFileSync(path.join(beta, 'settings.json'), 'utf8'), '{"hrId":"abc123"}');
  assert.ok(fs.existsSync(path.join(beta, 'sessions/2026-11-23.json')));
});

check('the v1 folder is left exactly as it was', () => {
  const v1 = tempDir();
  const beta = tempDir();
  write(v1, 'settings.json', '{"hrId":"abc123"}');
  const before = fs.readdirSync(v1);
  importFromStableInstall({ fromDir: v1, toDir: beta });
  fs.writeFileSync(path.join(beta, 'settings.json'), '{"hrId":"changed"}');
  assert.deepEqual(fs.readdirSync(v1), before);
  assert.equal(fs.readFileSync(path.join(v1, 'settings.json'), 'utf8'), '{"hrId":"abc123"}');
});

check('nothing is imported once the beta has settings of its own', () => {
  const v1 = tempDir();
  const beta = tempDir();
  write(v1, 'settings.json', '{"hrId":"from-v1"}');
  write(beta, 'settings.json', '{"hrId":"from-beta"}');
  assert.deepEqual(importFromStableInstall({ fromDir: v1, toDir: beta }), []);
  assert.equal(fs.readFileSync(path.join(beta, 'settings.json'), 'utf8'), '{"hrId":"from-beta"}');
});

check('nothing happens without a v1 install', () => {
  const beta = tempDir();
  assert.deepEqual(importFromStableInstall({ fromDir: path.join(beta, 'missing'), toDir: beta }), []);
});

check('the stable app never imports from itself', () => {
  const dir = tempDir();
  write(dir, 'settings.json', '{}');
  assert.deepEqual(importFromStableInstall({ fromDir: dir, toDir: dir }), []);
});
