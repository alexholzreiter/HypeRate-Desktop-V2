// Builds the shareable image for a recorded session: the heart rate curve with the game
// moments sitting where they happened, plus the numbers underneath.
//
// Two shapes: with a game, the legend lists the moment types; without one, it lists how long
// was spent in each zone, which is the only story a plain session has to tell.
const W = 1920, H = 1080, PAD = 76;
const GRAPH = { x: PAD, y: 452, w: W - PAD * 2, h: 348 };

const FARBEN = {
  boss: '#ef8b3e', death: '#e22d38', close: '#e0a542', intense: '#b58cff', peak: '#ff5c7a',
  penta: '#f0b232', win: '#2fbf71', lose: '#8a93a8', firstblood: '#d64d4d', steal: '#9b6bff',
  objective: '#0ac8b9', multikill: '#7fd4ff', ace: '#4da3ff',
};

const SPIELE = {
  wow: { name: { de: 'World of Warcraft', en: 'World of Warcraft' }, akzent: '#f1cf70', glanz: 'rgba(239,139,62,.13)' },
  lol: { name: { de: 'League of Legends', en: 'League of Legends' }, akzent: '#0ac8b9', glanz: 'rgba(10,200,185,.13)' },
};
// Ein Abend kann ein Dutzend Ereignistypen haben, die Karte hat Platz für vier.
// Rangfolge: womit man angibt, steht vorn.
const RANG = ['penta', 'win', 'boss', 'steal', 'multikill', 'ace', 'close', 'firstblood', 'death', 'objective', 'intense', 'lose'];
const nachRang = (a, b) => (RANG.indexOf(a) + 1 || 99) - (RANG.indexOf(b) + 1 || 99);

const OHNE_SPIEL = { name: { de: 'Puls-Sitzung', en: 'Heart rate session' }, akzent: '#6f9dff', glanz: 'rgba(90,140,235,.14)' };

const TEXTE = {
  de: { straight: 'am Stück.', peak: 'Spitze', avg: 'Durchschnitt', peakL: 'Spitze', low: 'Ruhigster',
        inZone: 'in', bosses: 'Bosse', deaths: 'Tode', moments: 'Momente',
        tagline: 'Kostenloses Puls-Overlay · macOS · Windows · Linux',
        titles: { boss: 'Boss besiegt', death: 'Gestorben', close: 'Knapp überlebt', penta: 'Pentakill',
                  win: 'Sieg', lose: 'Niederlage', firstblood: 'First Blood', steal: 'Ziel geklaut',
                  objective: 'Ziel gesichert', multikill: 'Multikill', ace: 'Ace', intense: 'Härtester Gegner' } },
  en: { straight: 'straight.', peak: 'Peak', avg: 'Average', peakL: 'Peak', low: 'Calmest',
        inZone: 'in', bosses: 'Bosses', deaths: 'Deaths', moments: 'Moments',
        tagline: 'Free heart rate overlay · macOS · Windows · Linux',
        titles: { boss: 'Boss Defeated', death: 'You Died', close: 'Close Call', penta: 'Pentakill',
                  win: 'Victory', lose: 'Defeat', firstblood: 'First Blood', steal: 'Objective Stolen',
                  objective: 'Objective', multikill: 'Multikill', ace: 'Ace', intense: 'Most Intense Enemy' } },
};

// Der Verlauf der Schlagzeile war fest auf Gold gerechnet und wurde mit jeder anderen
// Akzentfarbe schlammig. Jetzt wird er aus dem Akzent gemischt.
const mische = (hex, mit, anteil) => {
  const z = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [z(hex), z(mit)];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * anteil).toString(16).padStart(2, '0')).join('');
};

function bauen(sitzung, sprache = 'de', mittel = {}) {
  const t = TEXTE[sprache] || TEXTE.en;
  const loc = sprache === 'de' ? 'de-DE' : 'en-GB';
  const spiel = SPIELE[sitzung.game] || OHNE_SPIEL;
  const mitSpiel = !!SPIELE[sitzung.game] && sitzung.events.length > 0;

  // Die Datei speichert einen Wert je Sekunde ab startedAt, Lücken als null
  const samples = sitzung.samples
    || sitzung.bpm.map((b, i) => (b == null ? null : { t: sitzung.startedAt + i * 1000, bpm: b })).filter(Boolean);
  const bpms = samples.map(s => s.bpm);
  const spitze = Math.max(...bpms), tiefster = Math.min(...bpms);
  const schnitt = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
  const dauerMin = Math.round((sitzung.endedAt - sitzung.startedAt) / 60000);
  const zonenZeit = sitzung.zones
    .map(z => ({ ...z, minuten: Math.round(bpms.filter(b => b >= z.min && b <= z.max).length / 60) }))
    .filter(z => z.minuten > 0);
  const obenZone = [...zonenZeit].reverse().find(z => z.min >= 140);
  const zaehle = (typ) => sitzung.events.filter(e => (e.style || e.type) === typ).length;

  const uhr = (ms) => new Date(ms).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const dauer = (m) => m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;

  // ── Kurve ──
  const minY = tiefster - 6, maxY = spitze + 10;
  const px = (ms) => GRAPH.x + ((ms - sitzung.startedAt) / (sitzung.endedAt - sitzung.startedAt)) * GRAPH.w;
  const py = (b) => GRAPH.y + GRAPH.h - ((b - minY) / (maxY - minY)) * GRAPH.h;
  const schritt = Math.max(1, Math.ceil(samples.length / 700));
  const punkte = samples.filter((_, i) => i % schritt === 0);
  const linie = punkte.map((s, i) => `${i ? 'L' : 'M'}${px(s.t).toFixed(1)},${py(s.bpm).toFixed(1)}`).join('');
  const flaeche = `${linie}L${px(punkte.at(-1).t).toFixed(1)},${GRAPH.y + GRAPH.h}L${GRAPH.x},${GRAPH.y + GRAPH.h}Z`;

  const baender = sitzung.zones.filter(z => z.max >= minY && z.min <= maxY).map(z => {
    const oben = py(Math.min(z.max, maxY)), unten = py(Math.max(z.min, minY));
    return `<rect x="${GRAPH.x}" y="${oben.toFixed(1)}" width="${GRAPH.w}" height="${Math.max(0, unten - oben).toFixed(1)}" fill="${z.color}" opacity=".055"/>`;
  }).join('');

  const zeit = (e) => (e.t > 1e10 ? e.t : sitzung.startedAt + e.t * 1000);   // absolut oder Sekunden seit Start
  const marker = sitzung.events.map(e => {
    const x = px(zeit(e)), y = py(e.bpm ?? schnitt), c = FARBEN[e.style || e.type] || '#9aa4bf';
    return `<line x1="${x.toFixed(1)}" y1="${(y + 7).toFixed(1)}" x2="${x.toFixed(1)}" y2="${GRAPH.y + GRAPH.h}" stroke="${c}" stroke-width="1.5" opacity=".28"/>
            <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7.5" fill="#070d1c" stroke="${c}" stroke-width="3.5"/>`;
  }).join('');

  const sx = px(samples[bpms.indexOf(spitze)].t), sy = py(spitze);

  // Die Zeile über der Kurve: mit Spiel die Ereignisse, ohne Spiel die Zonen
  const typen = [...new Set(sitzung.events.map(e => e.style || e.type))].sort(nachRang);
  const gezeigt = typen.slice(0, 4);
  const rest = sitzung.events.filter(e => !gezeigt.includes(e.style || e.type)).length;

  const legende = (mitSpiel
    ? [...gezeigt.map(typ => ({ farbe: FARBEN[typ] || '#9aa4bf', text: `${t.titles[typ] || typ} · ${zaehle(typ)}` })),
       ...(rest ? [{ farbe: '#55607e', text: `+${rest}` }] : [])]
    : zonenZeit.map(z => ({ farbe: z.color, text: `${z.name} · ${z.minuten} min` }))
  ).map(l => `<span class="lg"><i style="background:${l.farbe}"></i>${l.text}</span>`).join('');

  const kpi = (wert, titel, farbe) =>
    `<div><div class="kv"${farbe ? ` style="color:${farbe}"` : ''}>${wert}</div><div class="kt">${titel}</div></div>`;

  // Die zwei stärksten Ereignistypen bekommen eine eigene Kennzahl, der Rest wird gezählt
  const stark = typen.slice(0, 2);
  const kennzahlen = mitSpiel
    ? [kpi(schnitt, t.avg), kpi(spitze, t.peakL, FARBEN.peak),
       obenZone ? kpi(obenZone.minuten + ' min', `${t.inZone} ${obenZone.name}`, obenZone.color) : '',
       ...stark.map(typ => kpi(zaehle(typ), t.titles[typ] || typ, FARBEN[typ])),
       kpi(sitzung.events.length, t.moments)]
    : [kpi(schnitt, t.avg), kpi(spitze, t.peakL, FARBEN.peak), kpi(tiefster, t.low, '#22c55e'),
       obenZone ? kpi(obenZone.minuten + ' min', `${t.inZone} ${obenZone.name}`, obenZone.color) : ''];

  const datum = new Date(sitzung.startedAt).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' });

  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>@font-face{font-family:'Alegreya';src:url('${mittel.alegreya}') format('truetype');font-weight:400 900;}</style>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:#060a14;font-family:'DM Sans',sans-serif;color:#eef2fb}
  .bg{position:absolute;inset:0;background:
      radial-gradient(ellipse 40% 44% at 84% 8%, ${spiel.glanz}, transparent 64%),
      radial-gradient(ellipse 56% 40% at 22% 96%, rgba(59,149,209,.09), transparent 70%),
      linear-gradient(180deg,#0a1226 0%,#070d1c 55%,#050912 100%)}
  .wrap{position:absolute;inset:0;padding:${PAD}px}
  .kicker{display:flex;align-items:center;gap:14px;font-family:'Space Mono',monospace;font-size:19px;font-weight:700;
          letter-spacing:.17em;text-transform:uppercase;color:${spiel.akzent}}
  .kicker .dot{width:6px;height:6px;border-radius:50%;background:${spiel.akzent};opacity:.7}
  .kicker .dim{color:#6f7ea3}
  h1{font-family:'Alegreya',Georgia,serif;font-weight:800;font-size:112px;line-height:.96;margin-top:26px;
     color:#f5ead4;text-shadow:0 4px 0 #000}
  h1 em{font-style:normal;background:linear-gradient(180deg,${mische(spiel.akzent,'#ffffff',.74)} 0%,${spiel.akzent} 52%,${mische(spiel.akzent,'#0a0a14',.52)} 100%);
        -webkit-background-clip:text;background-clip:text;color:transparent;text-shadow:none;filter:drop-shadow(0 4px 0 #000)}
  svg.graph{position:absolute;left:0;top:0;width:${W}px;height:${H}px}
  .legende{position:absolute;left:${PAD}px;top:${GRAPH.y - 42}px;display:flex;gap:28px;font-size:17px;color:#93a3c2}
  .lg{display:flex;align-items:center;gap:8px}
  .lg i{width:9px;height:9px;border-radius:50%;display:block}
  .achse{position:absolute;left:${PAD}px;right:${PAD}px;top:${GRAPH.y + GRAPH.h + 14}px;display:flex;justify-content:space-between;
         font-family:'Space Mono',monospace;font-size:17px;color:#6f7ea3}
  .kpis{position:absolute;left:${PAD}px;right:${PAD}px;top:${GRAPH.y + GRAPH.h + 70}px;display:flex;gap:70px}
  .kv{font-family:'Space Mono',monospace;font-size:46px;font-weight:700;line-height:1}
  .kt{font-family:'Space Mono',monospace;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:#6f7ea3;margin-top:9px}
  .foot{position:absolute;left:${PAD}px;right:${PAD}px;bottom:${PAD - 24}px;display:flex;align-items:center;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:15px}
  .brand img{width:58px;height:58px;border-radius:15px;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 8px 26px rgba(0,0,0,.6)}
  .bn{font-family:'Space Mono',monospace;font-weight:700;font-size:23px}
  .bs{font-size:16px;color:#93a3c2;margin-top:3px;font-weight:300}
  .url{font-family:'Space Mono',monospace;font-weight:700;font-size:23px;color:#071427;padding:14px 28px;border-radius:999px;
       background:linear-gradient(180deg,#e6efff,${spiel.akzent});box-shadow:0 0 30px rgba(120,170,220,.22)}
</style></head><body>
<div class="bg"></div>
<div class="wrap">
  <div class="kicker">${spiel.name[sprache] || spiel.name.en}<span class="dot"></span><span class="dim">${datum}</span></div>
  <h1>${dauer(dauerMin)} ${t.straight}<br><em>${t.peak} ${spitze} BPM.</em></h1>
  <div class="legende">${legende}</div>
  <div class="achse"><span>${uhr(sitzung.startedAt)}</span><span>${uhr(sitzung.endedAt)}</span></div>
  <div class="kpis">${kennzahlen.filter(Boolean).join('')}</div>
  <div class="foot">
    <div class="brand"><img src="${mittel.icon}"><div><div class="bn">HypeRate Desktop</div><div class="bs">${t.tagline}</div></div></div>
    <div class="url">desktop.hyperate.io</div>
  </div>
</div>
<svg class="graph" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${spiel.akzent}" stop-opacity=".30"/><stop offset="100%" stop-color="${spiel.akzent}" stop-opacity="0"/>
  </linearGradient></defs>
  ${baender}
  <path d="${flaeche}" fill="url(#fill)"/>
  <path d="${linie}" fill="none" stroke="${spiel.akzent}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>
  ${marker}
  <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="${FARBEN.peak}"/>
  <text x="${sx.toFixed(1)}" y="${(sy - 26).toFixed(1)}" text-anchor="middle"
        font-family="Space Mono, monospace" font-size="26" font-weight="700" fill="${FARBEN.peak}">${spitze}</text>
</svg>
</body></html>`;
}

module.exports = { build: bauen, W, H };
