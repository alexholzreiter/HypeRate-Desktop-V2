// User addons: what an addon folder must contain and what it may ask for.
//
//   <userData>/addons/<folder>/addon.json   the manifest (below)
//   <userData>/addons/<folder>/main.js      the code, run in a sandboxed hidden window
//
// addon.json:
//   {
//     "id": "my-addon",                  lower case letters, digits and dashes; unique
//     "name": "My addon",
//     "version": "1.0.0",
//     "description": "What it does",
//     "author": "Someone",
//     "permissions": ["heartRate", "zones", "gameMoments", "storage", "notifications"],
//     "network": ["api.example.com"]     hosts it may talk to over https (needs no permission
//                                        entry; listing a host is the request)
//   }
//
// Nothing here runs addon code. The fingerprint covers the manifest and every file of the
// addon, so any change asks the user again before the addon runs.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PERMISSIONS = {
  heartRate: 'Read your live heart rate',
  zones: 'Read your heart rate zones and the current zone',
  gameMoments: 'Read game moments (boss kills, deaths, pentakills …)',
  storage: 'Keep its own small storage on this computer',
  notifications: 'Show system notifications',
};

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_FILES = 200;
const MAX_BYTES = 5 * 1024 * 1024;

class ManifestError extends Error {}

function readManifest(dir) {
  const file = path.join(dir, 'addon.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    throw new ManifestError(fs.existsSync(file) ? 'addon.json is not valid JSON' : 'addon.json is missing');
  }
  if (!raw || typeof raw !== 'object') throw new ManifestError('addon.json must be an object');
  const str = (k, max, required = true) => {
    const v = raw[k];
    if (!required && (v == null || (typeof v === 'string' && !v.trim()))) return '';   // optional and left empty
    if (typeof v !== 'string' || !v.trim()) throw new ManifestError(`"${k}" is missing`);
    return v.trim().slice(0, max);
  };
  const id = str('id', 40);
  if (!ID_RE.test(id)) throw new ManifestError('"id" may only use a–z, 0–9 and dashes (2–40 characters)');
  const permissions = Array.isArray(raw.permissions) ? [...new Set(raw.permissions)] : [];
  const unknown = permissions.filter(p => !PERMISSIONS[p]);
  if (unknown.length) throw new ManifestError(`unknown permission: ${unknown.join(', ')}`);
  const network = Array.isArray(raw.network) ? [...new Set(raw.network.map(h => String(h).trim().toLowerCase()))] : [];
  const badHost = network.filter(h => !HOST_RE.test(h));
  if (badHost.length) throw new ManifestError(`"network" takes host names only, e.g. api.example.com: ${badHost.join(', ')}`);
  if (!fs.existsSync(path.join(dir, 'main.js'))) throw new ManifestError('main.js is missing');
  const settings = readSettings(raw.settings);
  return {
    id,
    name: str('name', 60),
    version: str('version', 20),
    description: str('description', 300, false),
    author: str('author', 60, false),
    permissions,
    network,
    settings,
  };
}

// "settings": values the user can change in the app without touching code. Each one:
//   { "key": "limit", "type": "number", "label": "Limit", "default": 120, "min": 40, "max": 220 }
// types: number, text, toggle, color, select (with "options": ["a", "b"])
const SETTING_TYPES = ['number', 'text', 'toggle', 'color', 'select'];
function readSettings(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new ManifestError('"settings" must be a list');
  if (list.length > 20) throw new ManifestError('"settings" may have 20 entries at most');
  const keys = new Set();
  return list.map((raw, i) => {
    const where = `settings[${i}]`;
    if (!raw || typeof raw !== 'object') throw new ManifestError(`${where} must be an object`);
    const key = String(raw.key || '');
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(key)) throw new ManifestError(`${where}: "key" must be a simple name like "limit"`);
    if (keys.has(key)) throw new ManifestError(`${where}: "${key}" appears twice`);
    keys.add(key);
    if (!SETTING_TYPES.includes(raw.type)) throw new ManifestError(`${where}: "type" must be one of ${SETTING_TYPES.join(', ')}`);
    const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 60) : key;
    const setting = { key, type: raw.type, label, help: typeof raw.help === 'string' ? raw.help.slice(0, 200) : '' };
    if (raw.type === 'select') {
      if (!Array.isArray(raw.options) || !raw.options.length) throw new ManifestError(`${where}: a "select" needs "options"`);
      setting.options = raw.options.slice(0, 20).map(o => String(o).slice(0, 60));
    }
    if (raw.type === 'number') {
      setting.min = Number.isFinite(raw.min) ? raw.min : null;
      setting.max = Number.isFinite(raw.max) ? raw.max : null;
    }
    setting.default = settingValue(setting, raw.default, true);
    return setting;
  });
}

// A value as the setting allows it; anything else becomes its default (or a neutral value)
function settingValue(setting, value, isDefault = false) {
  const fallback = isDefault ? { number: 0, text: '', toggle: false, color: '#ffffff', select: setting.options?.[0] ?? '' }[setting.type] : setting.default;
  switch (setting.type) {
    case 'number': {
      let n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      if (setting.min != null) n = Math.max(setting.min, n);
      if (setting.max != null) n = Math.min(setting.max, n);
      return n;
    }
    case 'text': return typeof value === 'string' ? value.slice(0, 500) : fallback;
    case 'toggle': return typeof value === 'boolean' ? value : fallback;
    case 'color': return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
    case 'select': return setting.options.includes(value) ? value : fallback;
  }
  return fallback;
}

// The current values: defaults, overlaid with what the user chose (only valid ones)
function settingValues(manifest, saved = {}) {
  return Object.fromEntries(manifest.settings.map(st => [st.key, st.key in saved ? settingValue(st, saved[st.key]) : st.default]));
}

// Every file of the addon (names and contents), sorted, hashed. Symlinks are refused, so an
// addon cannot reach outside its folder.
function fingerprint(dir) {
  const files = [];
  let bytes = 0;
  (function walk(d, rel) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;
      const full = path.join(d, entry.name), name = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new ManifestError(`symbolic links are not allowed: ${name}`);
      if (entry.isDirectory()) { walk(full, name); continue; }
      if (!entry.isFile()) continue;
      bytes += fs.statSync(full).size;
      if (files.length >= MAX_FILES || bytes > MAX_BYTES) throw new ManifestError('the addon is too big (200 files, 5 MB)');
      files.push([name, full]);
    }
  })(dir, '');
  const hash = crypto.createHash('sha256');
  for (const [name, full] of files) { hash.update(name + '\0'); hash.update(fs.readFileSync(full)); hash.update('\0'); }
  return hash.digest('hex');
}

// What the user agreed to, compared with what the addon asks for now
function needsApproval(manifest, print, granted) {
  if (!granted || granted.fingerprint !== print) return true;
  const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
  return !same(manifest.permissions, granted.permissions || []) || !same(manifest.network, granted.network || []);
}

// All addon folders, each read on its own: a broken one shows its error and does not stop the rest
function scan(root) {
  if (!fs.existsSync(root)) return [];
  const seen = new Set();
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => {
      const dir = path.join(root, e.name);
      try {
        const manifest = readManifest(dir);
        if (seen.has(manifest.id)) throw new ManifestError(`another addon already uses the id "${manifest.id}"`);
        seen.add(manifest.id);
        return { folder: e.name, dir, manifest, fingerprint: fingerprint(dir), error: null };
      } catch (error) {
        return { folder: e.name, dir, manifest: null, fingerprint: null, error: error instanceof ManifestError ? error.message : 'could not be read' };
      }
    });
}

module.exports = { PERMISSIONS, readManifest, fingerprint, needsApproval, scan, settingValue, settingValues, ManifestError };
