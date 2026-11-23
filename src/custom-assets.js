// Hearts and fonts the user brings along. They are copied into the app's own folder under a
// random name, so the overlay never reads from wherever the file came from, and they are served
// to the windows through the hr-asset:// protocol, which only answers for files in that folder.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = {
  heart: { exts: ['.png', '.gif', '.webp', '.svg', '.jpg', '.jpeg'], maxBytes: 2 * 1024 * 1024 },
  font:  { exts: ['.ttf', '.otf', '.woff', '.woff2'],                 maxBytes: 8 * 1024 * 1024 },
};

// What a served file may be called: exactly what importAsset() produces
const FILE_RE = /^(heart|font)-[0-9a-f]{16}\.(png|gif|webp|svg|jpg|jpeg|ttf|otf|woff|woff2)$/;

const MIME = {
  png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

class AssetError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

// Copies `source` into `dir`. Returns { file, name } where name is the original file name
// without extension, for showing in the list.
function importAsset({ kind, source, dir }) {
  const rules = KINDS[kind];
  if (!rules) throw new AssetError('kind');
  const ext = path.extname(source).toLowerCase();
  if (!rules.exts.includes(ext)) throw new AssetError('type', rules.exts.join(', '));
  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new AssetError('type');
  if (stat.size > rules.maxBytes) throw new AssetError('size', Math.round(rules.maxBytes / 1024 / 1024) + ' MB');
  if (stat.size === 0) throw new AssetError('empty');
  fs.mkdirSync(dir, { recursive: true });
  const file = `${kind}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  fs.copyFileSync(source, path.join(dir, file));
  const name = path.basename(source, path.extname(source)).slice(0, 60);
  return { file, name };
}

function removeAsset({ file, dir }) {
  if (!FILE_RE.test(file)) return false;
  try { fs.unlinkSync(path.join(dir, file)); return true; } catch { return false; }
}

// The path behind hr-asset://a/<file>, or null for anything that is not one of our files
function resolveAsset({ url, dir }) {
  let file;
  try { file = decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch { return null; }
  if (!FILE_RE.test(file)) return null;
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return null;
  return { path: full, type: MIME[path.extname(file).slice(1)] };
}

module.exports = { importAsset, removeAsset, resolveAsset, AssetError, KINDS, FILE_RE };
