// Riot's Live Client Data API — a local HTTPS endpoint the game itself provides.
// Nothing is injected into the game, we only read https://127.0.0.1:2999.
// The certificate is Riot's own self-signed one, so it can't be validated against a CA.

const https = require('https');

const HOST = '127.0.0.1';
const PORT = Number(process.env.HYPERATE_LOL_PORT) || 2999;   // override only used by tests
const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 2 });

function get(path, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: HOST, port: PORT, path, agent, timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { code: 'HTTP' }));
        try { resolve(JSON.parse(data)); }
        catch { reject(Object.assign(new Error('invalid JSON'), { code: 'PARSE' })); }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })));
    req.on('error', reject);
  });
}

const allGameData = () => get('/liveclientdata/allgamedata');

// Riot renamed the player fields over the years (summonerName → riotId/riotIdGameName),
// so accept every spelling and compare names without the #tag.
const gameName = (p) => p?.riotIdGameName || (p?.riotId || '').split('#')[0] || p?.summonerName || null;
const sameName = (a, b) => !!a && !!b && String(a).split('#')[0].trim().toLowerCase() === String(b).split('#')[0].trim().toLowerCase();

// One snapshot of everything we care about, shaped so the tracker never sees Riot's field names.
function snapshot(raw) {
  const ap = raw?.activePlayer || null;
  const me = gameName(ap);
  const entry = (raw?.allPlayers || []).find((p) => sameName(gameName(p), me)) || null;
  const cs = ap?.championStats || null;
  const maxHp = cs?.maxHealth || 0;
  return {
    gameTime: Number(raw?.gameData?.gameTime) || 0,
    gameMode: raw?.gameData?.gameMode || null,
    mapName:  raw?.gameData?.mapName || null,
    me: me ? {
      name: me,
      champion: entry?.championName || ap?.championName || null,
      team: entry?.team || null,
      level: ap?.level ?? entry?.level ?? null,
      hp: cs ? Math.max(0, Math.round(cs.currentHealth)) : null,
      maxHp: Math.round(maxHp),
      hpPct: cs && maxHp > 0 ? Math.max(0, Math.min(100, (cs.currentHealth / maxHp) * 100)) : null,
      dead: entry?.isDead ?? null,
      kills: entry?.scores?.kills ?? null,
      deaths: entry?.scores?.deaths ?? null,
      assists: entry?.scores?.assists ?? null,
    } : null,
    events: (raw?.events?.Events || []).map((e) => ({ ...e, EventID: Number(e.EventID), EventTime: Number(e.EventTime) })),
  };
}

module.exports = { get, allGameData, snapshot, gameName, sameName };
