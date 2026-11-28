#!/usr/bin/env node
// Draws the Steam achievement icons from steam/achievements/achievements.json:
//   steam/achievements/icons/<id>.svg            the source
//   steam/achievements/icons/<id>.png            achieved, 256 × 256
//   steam/achievements/icons/<id>_locked.png     not yet achieved (grey), 256 × 256
//   steam/achievements/icons/64/<id>[_locked].png  the same at 64 × 64
//   steam/achievements/overview.html             all of them on one page
//
//   npx electron tools/build-achievement-icons.js
//
// Rendered by Chromium (Electron), so the PNGs look exactly like the SVGs.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'steam', 'achievements');
const OUT = path.join(DIR, 'icons');
const { achievements } = JSON.parse(fs.readFileSync(path.join(DIR, 'achievements.json'), 'utf8'));

// The look: a dark scene lit from above, a glowing symbol on a little stage of light, particles,
// a vignette, a touch of film grain and a metal frame. hue = [light, dark], frame = metal stops.
const METAL = {
  blue: ['#c4d6ff', '#2a4fb8', '#a9c2ff', '#16307a'],
  teal: ['#c2fff3', '#138a76', '#9ff5e6', '#0b4f45'],
  red: ['#ffc0cc', '#a3203f', '#ff9fb1', '#5a0f22'],
  violet: ['#e2dcff', '#5a48c4', '#cfc6ff', '#2c1f7a'],
  gold: ['#fff1c2', '#a8761a', '#ffe08a', '#6b4a0c'],
  bronze: ['#ffd0a6', '#8a4a1c', '#f0b27a', '#5a2a0c'],
  silver: ['#ffffff', '#7d8898', '#e6edf5', '#4a5462'],
  platinum: ['#e9fbff', '#3f8fb0', '#d6f6ff', '#1d5b75'],
  ember: ['#ffd2b8', '#a8380f', '#ffb38a', '#5c1405'],
  ice: ['#f2fcff', '#5fb4d6', '#d8f4ff', '#245a75'],
  pine: ['#d6ffe2', '#1f8a4a', '#a8f0c0', '#0d4a26'],
};
const GROUP = {
  start: { hue: ['#5b8cff', '#0e2370'], frame: METAL.blue, fx: 'dust' },
  time: { hue: ['#2fe0c3', '#06463d'], frame: METAL.teal, fx: 'dust' },
  games: { hue: ['#ff4d6d', '#6a0d22'], frame: METAL.red, fx: 'embers' },
  connect: { hue: ['#9d8bff', '#24166e'], frame: METAL.violet, fx: 'dust' },
  hidden: { hue: ['#ffd36b', '#5c3a05'], frame: METAL.gold, fx: 'sparks' },
};
const RED = { hue: ['#ff4d6d', '#6a0d22'], frame: METAL.red };
const STYLE = {
  first_heartbeat: { ...RED, heart: true },
  close_call: { ...RED, heart: true, fx: 'embers' },
  hours_1: { hue: ['#f0a868', '#4a2208'], frame: METAL.bronze },
  hours_10: { hue: ['#dfe7f2', '#2a3340'], frame: METAL.silver },
  hours_100: { hue: ['#ffd36b', '#5c3a05'], frame: METAL.gold },
  hours_500: { hue: ['#7fdcff', '#0d3a52'], frame: METAL.platinum },
  boss_down: { hue: ['#ff6a3d', '#5c1405'], frame: METAL.ember },
  ice_cold: { hue: ['#9fe7ff', '#0b3550'], frame: METAL.ice, fx: 'snow' },
  heart_christmas: { hue: ['#5ee08f', '#0b3d1f'], frame: METAL.pine, fx: 'snow' },
};
const style = (a) => ({ ...GROUP[a.group], ...STYLE[a.id] });

// Glyphs on a 24 × 24 grid, drawn as 2-unit strokes (like the app's own icons)
const HEART = 'M12 20.5s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z';
const GLYPH = {
  first_heartbeat: `${HEART}M7.6 12.6h2.2l1.2-2.4 1.8 4.4 1.2-2h2.4`,
  first_overlay: 'M3 4.5h18v12H3zM8.5 20.5h7M12 16.5v4M7 11h2l1.3-2.6 2 5 1.3-2.4H17',
  ble_direct: 'M7 7.5l10 9-5 4.5V3l5 4.5-10 9',
  own_look: 'M12 3.2a8.8 8.8 0 1 0 0 17.6c1.1 0 1.7-.8 1.7-1.6 0-1-.8-1.3-.8-2.2 0-.9.8-1.6 1.7-1.6h2.2a4.2 4.2 0 0 0 4.2-4.2c0-4.4-4-8-9-8zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01',
  zones_set: 'M4.5 20v-4M9.5 20v-7.5M14.5 20V9M19.5 20V4.5',
  hours_1: 'M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17zM12 7.5V12l3 2',
  sessions_10: 'M4 6h16v14H4zM4 10.5h16M8.5 3.5v4M15.5 3.5v4',
  marathon: 'M6 21V3.5M6 4h11.5l-2.5 4 2.5 4H6',
  share_card: 'M4.5 12.5V20h15v-7.5M12 3.5v11M7.5 8L12 3.5 16.5 8',
  first_moment: 'M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z',
  boss_down: 'M3.5 18.5h17M4.5 18.5L3.5 8l5 4 3.5-7 3.5 7 5-4-1 10.5',
  ice_cold: 'M12 2.5v19M3.8 7.3l16.4 9.4M20.2 7.3L3.8 16.7M9.5 3.8L12 6.3l2.5-2.5M9.5 20.2l2.5-2.5 2.5 2.5',
  close_call: `${HEART}M12.8 8.6l-2.2 3.6h3l-2.2 4`,
  pentakill: 'M5 5v14M9 5v14M13 5v14M17 5v14M3 15.5L21 8.5',
  discord_live: 'M4 4.5h16v11.5H9.5L4 20.5zM7.6 10.4h2l1.2-2.2 1.8 4.2 1.2-2h2.6',
  vrchat_live: 'M3 7.5h18v9h-5.5l-2-3h-3l-2 3H3zM7.5 11h.01M16.5 11h.01',
  smart_home: 'M3.5 11L12 4l8.5 7M5.5 9.5V20h13V9.5M8.5 15h2l1-2 1.5 3 1-1.5h1.5',
  addon_first: 'M4.5 8h4V6.5a2.5 2.5 0 1 1 5 0V8h4v4h-1.5a2.5 2.5 0 1 0 0 5h1.5v3.5h-13z',
  heart_christmas: 'M12 3l5 6h-3l4.5 5.5h-3.5L19.5 20h-15L8 14.5H4.5L9 9H6zM12 20v2',
  heart_new_year: 'M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5M5.3 5.3l3.5 3.5M15.2 15.2l3.5 3.5M18.7 5.3l-3.5 3.5M8.8 15.2l-3.5 3.5',
};
GLYPH.hours_10 = GLYPH.hours_100 = GLYPH.hours_500 = GLYPH.hours_1;
GLYPH.sessions_100 = GLYPH.sessions_10;

// A small label under the glyph where the number is the point
const LABEL = { hours_1: '1h', hours_10: '10h', hours_100: '100h', hours_500: '500h', sessions_10: '10', sessions_100: '100', marathon: '4h' };

// The parts of a heart symbol that get filled instead of drawn
const HEART_ONLY = { first_heartbeat: 'M7.6 12.6h2.2l1.2-2.4 1.8 4.4 1.2-2h2.4', close_call: 'M12.8 8.6l-2.2 3.6h3l-2.2 4' };

function random(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function particles(kind, color, seed) {
  const r = random(seed);
  const n = { dust: 14, embers: 24, sparks: 26, snow: 22 }[kind];
  let dots = '';
  for (let i = 0; i < n; i++) {
    const x = 26 + r() * 204;
    const y = kind === 'embers' ? 110 + r() * 125 : 26 + r() * 204;
    const size = { dust: 0.8 + r() * 1.6, embers: 1 + r() * 2.6, sparks: 0.8 + r() * 2.4, snow: 1.4 + r() * 2.8 }[kind];
    const fill = kind === 'dust' || kind === 'snow' ? '#ffffff' : color;
    dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" fill="${fill}" opacity="${(0.25 + r() * 0.6).toFixed(2)}"/>`;
  }
  return `<g filter="url(#soft)">${dots}</g>`;
}

function svg(a, seed = 7) {
  const { hue: [light, dark], frame, fx, heart } = style(a);
  const label = LABEL[a.id];
  const stops = frame.map((c, i) => `<stop offset="${(i / (frame.length - 1)).toFixed(2)}" stop-color="${c}"/>`).join('');
  const glyph = heart ? HEART_ONLY[a.id] : GLYPH[a.id];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs>
  <clipPath id="tile"><rect x="10" y="10" width="236" height="236" rx="50"/></clipPath>
  <radialGradient id="bg" cx=".5" cy=".38" r=".75"><stop offset="0" stop-color="${dark}"/><stop offset=".55" stop-color="#0a0d1c"/><stop offset="1" stop-color="#030409"/></radialGradient>
  <radialGradient id="spot" cx=".5" cy=".05" r=".8"><stop offset="0" stop-color="${light}" stop-opacity=".55"/><stop offset=".5" stop-color="${light}" stop-opacity=".08"/><stop offset="1" stop-color="${light}" stop-opacity="0"/></radialGradient>
  <radialGradient id="vignette" cx=".5" cy=".5" r=".72"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient>
  <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>
  <linearGradient id="glyph" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${light}"/></linearGradient>
  <linearGradient id="heart" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b85"/><stop offset=".6" stop-color="#e0153f"/><stop offset="1" stop-color="#7a0620"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.1"/></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="1.2"/></filter>
  <filter id="rays"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0"/></filter>
  <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy=".6" stdDeviation=".5" flood-color="#000" flood-opacity=".8"/></filter>
</defs>
<g clip-path="url(#tile)">
  <rect width="256" height="256" fill="url(#bg)"/>
  <g filter="url(#rays)" opacity=".5">
    <path d="M128 -10 L70 256 L100 256 Z" fill="${light}" opacity=".35"/>
    <path d="M128 -10 L150 256 L190 256 Z" fill="${light}" opacity=".25"/>
    <path d="M128 -10 L20 220 L40 240 Z" fill="${light}" opacity=".15"/>
  </g>
  <rect width="256" height="256" fill="url(#spot)"/>
  ${particles(fx, light, seed)}
  <ellipse cx="128" cy="${label ? 176 : 196}" rx="70" ry="10" fill="${light}" opacity=".25" filter="url(#rays)"/>
  <g transform="translate(48 ${label ? 26 : 44}) scale(6.6667)" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${heart ? `<path d="${HEART}" fill="${light}" filter="url(#glow)" opacity=".9"/><path d="${HEART}" fill="url(#heart)" filter="url(#shadow)"/><path d="M8 9.2a2.6 2.6 0 0 1 3-.9" stroke="#ffffff" stroke-opacity=".7" stroke-width=".7"/>` : ''}
    <path d="${glyph}" stroke="${light}" stroke-width="3.6" filter="url(#glow)" opacity=".9"/>
    <path d="${glyph}" stroke="url(#glyph)" stroke-width="2.1" filter="url(#shadow)"/>
  </g>
  ${label ? `<rect x="${128 - (label.length * 15 + 30) / 2}" y="190" width="${label.length * 15 + 30}" height="38" rx="19" fill="url(#frame)" stroke="#000" stroke-opacity=".4"/>
  <text x="128" y="216" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Inter, Arial, sans-serif" font-size="25" font-weight="900" fill="#0a0d1c" letter-spacing=".5">${label}</text>` : ''}
  <rect width="256" height="256" fill="url(#vignette)"/>
  <rect width="256" height="256" filter="url(#grain)" opacity=".07"/>
</g>
<rect x="13" y="13" width="230" height="230" rx="47" fill="none" stroke="url(#frame)" stroke-width="7"/>
<rect x="18.5" y="18.5" width="219" height="219" rx="42" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="1.2"/>
</svg>`;
}

// The page carries the icons itself (as SVG), so it can be opened or sent anywhere
const seedOf = (a) => 7 + achievements.indexOf(a);
const uri = (a) => 'data:image/svg+xml;base64,' + Buffer.from(svg(a, seedOf(a))).toString('base64');
const LOCKED = 'grayscale(1) brightness(.62) contrast(.9)';

function overview() {
  const card = (a) => `
    <figure>
      <div class="pair"><img src="${uri(a)}" alt=""><img class="locked" src="${uri(a)}" alt=""></div>
      <figcaption><b>${a.name_de}</b> <span>${a.name_en}</span>${a.hidden ? ' <i>versteckt</i>' : ''}
        <small>${a.desc_de}</small><code>${a.api}</code></figcaption>
    </figure>`;
  const groups = [['start', 'Erste Schritte'], ['time', 'Ausdauer'], ['games', 'Spiele'], ['connect', 'Verbinden'], ['hidden', 'Versteckt']];
  return `<!doctype html><meta charset="utf-8"><title>HypeRate Desktop · Steam-Erfolge</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;padding:32px 16px;background:#0b1024;color:#e8ecf7;font:15px/1.45 -apple-system,'Segoe UI',Inter,Arial,sans-serif}
  main{max-width:1100px;margin:auto} h1{font-size:26px;margin:0 0 4px} p.lead{color:#9aa6c4;margin:0 0 28px}
  h2{font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#7fb0ff;margin:32px 0 12px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
  figure{margin:0;background:#141b36;border:1px solid #232c4f;border-radius:14px;padding:14px}
  .pair{display:flex;gap:10px;margin-bottom:10px} .pair img{width:96px;height:96px} .pair img.locked{filter:${LOCKED}}
  figcaption b{display:block;font-size:16px} figcaption span{color:#9aa6c4;font-size:13px}
  figcaption i{font-style:normal;font-size:11px;color:#f2c14e;border:1px solid #f2c14e55;border-radius:99px;padding:0 6px;margin-left:4px}
  small{display:block;color:#b9c2db;margin-top:6px} code{display:block;margin-top:6px;color:#6f7a99;font-size:12px}
</style>
<main>
<h1>Steam-Erfolge</h1>
<p class="lead">${achievements.length} Erfolge · links freigeschaltet, rechts noch gesperrt · Quelle: steam/achievements/achievements.json</p>
${groups.map(([g, title]) => `<h2>${title}</h2><div class="grid">${achievements.filter((a) => a.group === g).map(card).join('')}</div>`).join('\n')}
</main>`;
}

async function main() {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  await app.whenReady();
  fs.mkdirSync(path.join(OUT, '64'), { recursive: true });
  const win = new BrowserWindow({ show: false, width: 256, height: 256, useContentSize: true, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  for (const a of achievements) {
    if (!GLYPH[a.id]) throw new Error(`no glyph for ${a.id}`);
    const source = svg(a, seedOf(a));
    fs.writeFileSync(path.join(OUT, `${a.id}.svg`), source);
    for (const locked of [false, true]) {
      const style = `html,body{margin:0;background:transparent}img{display:block;width:256px;height:256px;${locked ? `filter:${LOCKED}` : ''}}`;
      const html = `<!doctype html><style>${style}</style><img src="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}">`;
      await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
      await new Promise((r) => setTimeout(r, 60));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
      const big = image.resize({ width: 256, height: 256, quality: 'best' });
      const name = `${a.id}${locked ? '_locked' : ''}.png`;
      fs.writeFileSync(path.join(OUT, name), big.toPNG());
      fs.writeFileSync(path.join(OUT, '64', name), big.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
    }
  }
  fs.writeFileSync(path.join(DIR, 'overview.html'), overview());
  console.log(`drew ${achievements.length} achievements into ${path.relative(ROOT, OUT)}`);
  app.quit();
}

main().catch((error) => { console.error(error); process.exit(1); });
