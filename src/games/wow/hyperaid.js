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
const DATA_FOLDER = 'HypeRaidData';
const DATA_MANIFEST = `${DATA_FOLDER}.toc`;
const DATA_PROTOCOL = /^## X-HypeRaid-Data:[ \t]*1[ \t]*\r?$/m;
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

async function readOptional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function versionFrom(manifest) {
  return manifest.match(/^## Version:[ \t]*(\S+)/m)?.[1] || null;
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

function createHyperaid(onStatus, { clock = Date.now, bundle = BUNDLE, trace } = {}) {
  let queue = Promise.resolve();
  let options = { enabled: false, folder: '' };
  let newest = null;
  let pending = false;
  let generation = 0;
  let nextBankCheck = 0;
  let state = { state: 'off', installedVersion: null, bundledVersion: null };
  const written = new Map();

  function report(next) {
    if (JSON.stringify(state) === JSON.stringify(next)) return;
    state = next;
    onStatus(state);
  }

  function fail(error) {
    const code = error.code || error.message;
    trace?.('write or setup error', { code });
    nextBankCheck = Math.floor(clock() / 1000) + INTERVAL;
    report({ ...state, state: 'error', error: code });
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
    const bundledVersion = versionFrom(await readOptional(path.join(bundle, MANIFEST)));
    const addon = options.enabled ? await findAddon(options.folder) : null;
    const base = { bundledVersion, installedVersion: null, addon, canInstall: !!addon };
    if (!addon) return { ...base, state: options.enabled ? 'folder' : 'off' };
    const manifest = await readOptional(path.join(addon, MANIFEST));
    const installedVersion = versionFrom(manifest);
    const data = installedVersion && DATA_PROTOCOL.test(manifest) ? path.join(path.dirname(addon), DATA_FOLDER) : null;
    const bank = path.join(data || addon, 'LiveFonts');
    const config = data ? await readOptional(path.join(data, DATA_MANIFEST)) : await readOptional(path.join(addon, 'FontBank.lua'));
    const enabled = data ? DATA_PROTOCOL.test(config)
      : /fontBankSize\s*=\s*4096\b/.test(config) && /fontInterval\s*=\s*8\b/.test(config);
    const ready = installedVersion && enabled
      && await exists(path.join(bank, slotName(1))) && await exists(path.join(bank, slotName(SLOT_COUNT)));
    return { ...base, installedVersion, data, bank, state: ready ? 'waiting' : 'setup' };
  }

  async function prepareBank(status, revision) {
    await fs.mkdir(status.bank, { recursive: true });
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      if (revision !== generation) return;
      const file = path.join(status.bank, slotName(slot));
      if (!await exists(file)) await writeAtomic(file, liveFontBytes(slot, 0, 0));
    }
    if (revision !== generation) return;
    if (status.data) {
      await writeAtomic(path.join(status.data, DATA_MANIFEST),
        '## Interface: 16001\n## Title: HypeRaid Data\n## Notes: Local heart-rate feed managed by HypeRate Desktop.\n## X-HypeRaid-Data: 1\n');
    } else {
      await writeAtomic(path.join(status.addon, 'FontBank.lua'), CONFIG);
    }
  }

  async function refresh(revision, missingBank) {
    const status = await inspect();
    if (revision !== generation) return;
    const needsBank = (status.data && status.state === 'setup')
      || (status.bank === missingBank && status.state === 'waiting');
    if (!needsBank) {
      report(status);
      return;
    }
    report({ ...status, state: 'installing' });
    await prepareBank(status, revision);
    if (revision === generation) report(await inspect());
  }

  function configure(next) {
    options = { enabled: next.enabled === true, folder: typeof next.folder === 'string' ? next.folder.trim() : '' };
    const revision = ++generation;
    return run(async () => {
      if (revision !== generation) return state;
      await clear();
      await refresh(revision);
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
      if (revision !== generation) return state;
      if (!status.installedVersion && !status.bundledVersion) throw new Error('HypeRaid bundle is missing');
      report({ ...status, state: 'installing' });
      const addon = status.addon;
      if (status.bundledVersion && (!status.installedVersion || isNewer(status.bundledVersion, status.installedVersion))) {
        await fs.mkdir(addon, { recursive: true });
        const files = await fs.readdir(bundle);
        for (const file of files.filter(name => name !== MANIFEST)) {
          const destination = path.join(addon, file);
          if (file === 'FontBank.lua' && await exists(destination)) continue;
          await writeAtomic(destination, await fs.readFile(path.join(bundle, file)));
        }
        await writeAtomic(path.join(addon, MANIFEST), await fs.readFile(path.join(bundle, MANIFEST)));
      }
      const installed = await inspect();
      if (revision !== generation) return state;
      await prepareBank(installed, revision);
      if (revision === generation) report(await inspect());
      return state;
    });
  }

  function record(bpm) {
    const value = Math.round(bpm);
    if (value >= 30 && value <= 240) {
      newest = { bpm: value, timestamp: Math.floor(clock() / 1000) };
      if (options.enabled) trace?.('received sample', { timestamp: newest.timestamp });
    }
  }

  function tick() {
    if (!options.enabled || pending || !['setup', 'error', 'waiting', 'writing'].includes(state.state)) return queue;
    const revision = generation;
    pending = true;
    const result = run(async () => {
      if (revision !== generation) return;
      const now = Math.floor(clock() / 1000);
      if (state.state === 'setup' || state.state === 'error') {
        if (now >= nextBankCheck) {
          nextBankCheck = now + INTERVAL;
          await refresh(revision);
        }
        return;
      }
      const sample = newest;
      if (!sample || now - sample.timestamp >= SAMPLE_TIMEOUT || sample.timestamp > now) {
        if (state.state === 'writing') trace?.('waiting for a fresh sample', { timestamp: sample?.timestamp, now });
        await clear();
        report({ ...state, state: 'waiting', bpm: null });
        return;
      }
      const bucket = Math.floor(now / INTERVAL);
      const bank = state.bank;
      const files = new Set();
      for (const target of [bucket + 1, bucket]) {
        const slot = target % SLOT_COUNT + 1;
        const file = path.join(bank, slotName(slot));
        files.add(file);
        const previous = written.get(file);
        if (previous?.bpm === sample.bpm && previous.timestamp === sample.timestamp) continue;
        if (!await exists(file)) {
          await clear();
          await refresh(revision, bank);
          return;
        }
        await writeAtomic(file, liveFontBytes(slot, sample.bpm, sample.timestamp));
        written.set(file, { ...sample, slot });
        trace?.('wrote slot', { slot, timestamp: sample.timestamp, now });
      }
      for (const [file, { slot }] of written) {
        if (files.has(file)) continue;
        if (await exists(file)) await writeAtomic(file, liveFontBytes(slot, 0, 0));
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
