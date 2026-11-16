const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { liveFontBytes } = require('./hyperaid-font');

const BUNDLE = path.join(__dirname, '../../../assets/hyperaid/HypeRaid');
const SLOT_COUNT = 4096;
const INTERVAL = 8;
const SAMPLE_TIMEOUT = 25;
const CONFIG = `local _, addon = ...\naddon.fontBankSize = ${SLOT_COUNT}\naddon.fontInterval = ${INTERVAL}\n`;
const MANIFEST = 'HypeRaid.toc';
const slotName = slot => `Live${String(slot).padStart(4, '0')}.ttf`;

async function exists(file) {
  try {
    return (await fs.stat(file)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeAtomic(file, data) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, data, { flag: 'wx' });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

async function findAddon(folder) {
  if (!folder) return null;
  const full = path.resolve(folder);
  const base = path.basename(full).toLowerCase();
  const addons = base === 'addons' ? full : path.join(
    base === '_forever_' ? full : path.join(full, '_forever_'), 'Interface', 'AddOns');
  if (path.basename(path.dirname(addons)).toLowerCase() !== 'interface'
      || path.basename(path.dirname(path.dirname(addons))).toLowerCase() !== '_forever_') return null;
  try {
    if ((await fs.stat(addons)).isDirectory()) return path.join(addons, 'HypeRaid');
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
  return null;
}

async function versionFrom(addon) {
  const manifest = path.join(addon, MANIFEST);
  if (!await exists(manifest)) return null;
  return (await fs.readFile(manifest, 'utf8')).match(/^## Version:\s*(\S+)/m)?.[1] || null;
}

function isNewer(a, b) {
  const actual = a.split('.').map(Number);
  const bundled = b.split('.').map(Number);
  for (let index = 0; index < Math.max(actual.length, bundled.length); index++) {
    const difference = (actual[index] || 0) - (bundled[index] || 0);
    if (difference) return difference > 0;
  }
  return false;
}

function createHyperaid(onStatus, { clock = Date.now, bundle = BUNDLE } = {}) {
  let queue = Promise.resolve();
  let options = { enabled: false, folder: '' };
  let newest = null;
  let pending = false;
  let generation = 0;
  let state = { state: 'off', installedVersion: null, bundledVersion: null };
  const written = new Map();

  function report(next) {
    if (JSON.stringify(state) === JSON.stringify(next)) return;
    state = next;
    onStatus(state);
  }

  function fail(error) {
    report({ ...state, state: 'error', error: error.code || error.message });
  }

  function run(task) {
    const result = queue.then(task);
    queue = result.catch(fail);
    return result;
  }

  async function clear() {
    for (const [file, { slot }] of written) {
      if (await exists(file)) await writeAtomic(file, liveFontBytes(slot, 0, 0));
      written.delete(file);
    }
  }

  async function inspect() {
    const bundledVersion = await versionFrom(bundle);
    const addon = options.enabled ? await findAddon(options.folder) : null;
    const base = { bundledVersion, installedVersion: null, addon, canInstall: !!addon };
    if (!addon) return { ...base, state: options.enabled ? 'folder' : 'off' };
    const installedVersion = await versionFrom(addon);
    const bank = path.join(addon, 'LiveFonts');
    const configFile = path.join(addon, 'FontBank.lua');
    const config = await exists(configFile) ? await fs.readFile(configFile, 'utf8') : '';
    const ready = installedVersion && /fontBankSize\s*=\s*4096\b/.test(config)
      && /fontInterval\s*=\s*8\b/.test(config)
      && await exists(path.join(bank, slotName(1))) && await exists(path.join(bank, slotName(SLOT_COUNT)));
    return { ...base, installedVersion, state: ready ? 'waiting' : 'setup' };
  }

  function configure(next) {
    options = { enabled: next.enabled === true, folder: typeof next.folder === 'string' ? next.folder.trim() : '' };
    const revision = ++generation;
    return run(async () => {
      if (revision !== generation) return state;
      await clear();
      const status = await inspect();
      if (revision === generation) report(status);
      return state;
    });
  }

  function install() {
    const revision = ++generation;
    return run(async () => {
      if (revision !== generation) return state;
      await clear();
      const status = await inspect();
      if (!status.addon) {
        report(status);
        return state;
      }
      report({ ...status, state: 'installing' });
      const addon = status.addon;
      const bank = path.join(addon, 'LiveFonts');
      await fs.mkdir(bank, { recursive: true });
      for (let slot = 1; slot <= SLOT_COUNT; slot++) {
        if (revision !== generation) return state;
        const file = path.join(bank, slotName(slot));
        if (!await exists(file)) await writeAtomic(file, liveFontBytes(slot, 0, 0));
      }
      if (!status.installedVersion || !isNewer(status.installedVersion, status.bundledVersion)) {
        const files = await fs.readdir(bundle);
        for (const file of files.filter(name => name !== 'FontBank.lua' && name !== MANIFEST)) {
          await writeAtomic(path.join(addon, file), await fs.readFile(path.join(bundle, file)));
        }
        await writeAtomic(path.join(addon, MANIFEST), await fs.readFile(path.join(bundle, MANIFEST)));
      }
      await writeAtomic(path.join(addon, 'FontBank.lua'), CONFIG);
      if (revision === generation) report(await inspect());
      return state;
    });
  }

  function record(bpm) {
    const value = Math.round(bpm);
    if (value >= 30 && value <= 240) newest = { bpm: value, timestamp: Math.floor(clock() / 1000) };
  }

  function tick() {
    if (!options.enabled || pending || !['waiting', 'writing'].includes(state.state)) return queue;
    const revision = generation;
    pending = true;
    const result = run(async () => {
      if (revision !== generation) return;
      const now = Math.floor(clock() / 1000);
      const sample = newest;
      if (!sample || now - sample.timestamp >= SAMPLE_TIMEOUT || sample.timestamp > now) {
        await clear();
        report({ ...state, state: 'waiting', bpm: null });
        return;
      }
      const bucket = Math.floor(now / INTERVAL);
      const bank = path.join(state.addon, 'LiveFonts');
      const files = new Set();
      for (const target of [bucket + 1, bucket]) {
        const slot = target % SLOT_COUNT + 1;
        const file = path.join(bank, slotName(slot));
        files.add(file);
        const previous = written.get(file);
        if (previous?.bpm === sample.bpm && previous.timestamp === sample.timestamp) continue;
        if (!await exists(file)) {
          await clear();
          report({ ...state, state: 'setup' });
          return;
        }
        await writeAtomic(file, liveFontBytes(slot, sample.bpm, sample.timestamp));
        written.set(file, { ...sample, slot });
      }
      for (const [file, { slot }] of written) {
        if (files.has(file)) continue;
        await writeAtomic(file, liveFontBytes(slot, 0, 0));
        written.delete(file);
      }
      if (revision === generation) report({ ...state, state: 'writing', bpm: sample.bpm });
    });
    result.then(() => { pending = false; }, () => { pending = false; });
    return queue;
  }

  return { configure, install, record, tick, status: () => state };
}

module.exports = { createHyperaid, findAddon };
