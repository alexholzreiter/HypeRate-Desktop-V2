// Keeps settings.json readable across versions.
//
// v1 wrote a plain object without a version. v2 adds `schemaVersion`, so later changes to the
// shape can be migrated step by step instead of guessed from which keys happen to be there.
//
// The v2 beta also runs next to an installed v1, in its own data folder. On its very first start
// it copies the v1 data over once, so testers keep their setup. The v1 folder is only read,
// never written: whoever goes back to v1 finds it exactly as they left it.

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 2;

// Each step takes the store at version n-1 and returns it at version n.
const STEPS = {
  // v1 → v2: nothing to reshape yet, the version number is new.
  2: (store) => store,
};

function migrateStore(store) {
  const from = Number.isInteger(store?.schemaVersion) ? store.schemaVersion : 1;
  if (from >= SCHEMA_VERSION) return store;
  let next = { ...store };
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) next = STEPS[v](next);
  next.schemaVersion = SCHEMA_VERSION;
  return next;
}

// What the beta brings over from v1: settings plus the recorded sessions.
const IMPORT_ITEMS = ['settings.json', 'wow-sessions.json', 'sessions'];

function importFromStableInstall({ fromDir, toDir }) {
  if (!fromDir || !toDir || path.resolve(fromDir) === path.resolve(toDir)) return [];
  if (fs.existsSync(path.join(toDir, 'settings.json'))) return [];     // the beta has data of its own
  if (!fs.existsSync(path.join(fromDir, 'settings.json'))) return [];  // no v1 to import from

  fs.mkdirSync(toDir, { recursive: true });
  const copied = [];
  for (const item of IMPORT_ITEMS) {
    const source = path.join(fromDir, item);
    if (!fs.existsSync(source)) continue;
    try {
      fs.cpSync(source, path.join(toDir, item), { recursive: true, errorOnExist: false, force: false });
      copied.push(item);
    } catch (error) {
      console.error('v1 import:', item, error.message);
    }
  }
  return copied;
}

module.exports = { SCHEMA_VERSION, migrateStore, importFromStableInstall };
