// WoWCombatLog line parsing — tolerant of Retail and Classic formats:
//   Classic / older:  4/9 05:05:01.824  SPELL_DAMAGE,Player-1096-06DF65C1,"Name",0x511,...
//   Retail 11.x+:     9/16/2026 18:30:12.345-4  SPELL_DAMAGE,...
// Timestamps are read as local time (game and app run on the same machine);
// a trailing timezone offset is ignored.

const LINE_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:[+-]\d{1,2}(?::?\d{2})?)?\s+([A-Z][A-Z0-9_]*)(?:,(.*))?$/;
const GUID_RE = /^(?:[A-Za-z]+-[0-9A-Fa-f-]+|0000000000000000)$/;
const INT_RE  = /^-?\d+$/;

// → { time (epoch ms), event, rest (unsplit argument string) } or null
function parseLine(line, now = Date.now()) {
  const m = LINE_RE.exec(line.endsWith('\r') ? line.slice(0, -1) : line);
  if (!m) return null;
  const [, mon, day, yearRaw, h, min, s, frac, event, rest = ''] = m;
  const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;

  let year;
  if (yearRaw) {
    year = Number(yearRaw) + (yearRaw.length === 2 ? 2000 : 0);
  } else {
    // Older formats have no year — assume the current one, unless that lands in the future (log from last December)
    year = new Date(now).getFullYear();
    if (new Date(year, mon - 1, day).getTime() - now > 2 * 86400000) year--;
  }
  const time = new Date(year, mon - 1, day, h, min, s, ms).getTime();
  return Number.isFinite(time) ? { time, event, rest } : null;
}

// Splits the argument string on top-level commas; honours "quoted, names" and [nested (lists)].
function splitArgs(rest) {
  const out = [];
  let field = '', quoted = false, depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '"') { quoted = !quoted; continue; }
    if (!quoted) {
      if (c === '[' || c === '(') depth++;
      else if (c === ']' || c === ')') depth = Math.max(0, depth - 1);
      else if (c === ',' && depth === 0) { out.push(field); field = ''; continue; }
    }
    field += c;
  }
  out.push(field);
  return out;
}

const isGuid = (s) => typeof s === 'string' && GUID_RE.test(s);

// Advanced-logging block: infoGUID, ownerGUID, currentHP, maxHP, …
// Its position depends on the event prefix (SWING: after base params, SPELL/RANGE: after 3 spell params,
// ENVIRONMENTAL: after the environmental type), so probe the known offsets.
// With Advanced Combat Logging off, Classic still writes the block but zeroed
// (0000000000000000,0000000000000000,0,0,…) — that carries no data and is ignored.
const EMPTY_GUID = '0000000000000000';
function advancedInfo(args) {
  for (const i of [8, 9, 11]) {
    if (isGuid(args[i]) && isGuid(args[i + 1]) && INT_RE.test(args[i + 2] || '') && INT_RE.test(args[i + 3] || '')) {
      if (args[i] === EMPTY_GUID) return null;
      return { guid: args[i], hp: Number(args[i + 2]), maxHp: Number(args[i + 3]) };
    }
  }
  return null;
}

const flags = (hex) => parseInt(hex, 16) || 0;

module.exports = { parseLine, splitArgs, advancedInfo, isGuid, flags };
