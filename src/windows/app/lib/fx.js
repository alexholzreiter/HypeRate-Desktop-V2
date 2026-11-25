// Little celebrations, each a small scene behind the page: snow at Christmas, fireworks on New Year's Eve, hearts on Valentine's Day,
// lanterns at Chinese New Year, bats out of an orange moon at Halloween, sky lanterns under the
// full moon at the Mid-Autumn Festival, a spring morning with cherry blossom at Easter, confetti
// on HypeRate's birthday and on a new personal record.
//
// Filmed like a scene: what is near is large and out of focus, what is far is small and sharp,
// over it lie film grain and a vignette. The scene sits in #fx-back behind the page, so the cards
// stay in front of it; only the line of text after confetti sits over the page (#fx-front). Redrawing the page never touches these layers. Everything moves in CSS on
// transform, opacity and filter, which the GPU runs without the page; only the fireworks need a
// canvas, and it sleeps between rockets. Nothing shows to someone who asked for less motion.

import { h, svg, HEART_PATH } from './dom.js';
import { t } from './i18n.js';

export const SEASONS = ['christmas', 'newyear', 'valentine', 'lunar', 'halloween', 'midautumn', 'easter', 'birthday'];

// The two festivals that follow the moon, by year (month-day of the first day)
const LUNAR_NEW_YEAR = { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23', 2032: '02-11', 2033: '01-31', 2034: '02-19', 2035: '02-08' };
const MID_AUTUMN = { 2026: '09-25', 2027: '09-15', 2028: '10-03', 2029: '09-22', 2030: '09-12', 2031: '10-01', 2032: '09-19', 2033: '09-08', 2034: '09-27', 2035: '09-16' };
const BIRTH_YEAR = 2020;   // HypeRate went live on 10 November 2020

// Easter Sunday (Gregorian, the anonymous algorithm)
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451);
  const month = Math.floor((hh + l - 7 * m + 114) / 31), day = ((hh + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Whole days from `target` to `date`, both taken as local calendar days
function daysFrom(date, target) {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((a - b) / 86400000);
}
const md = (year, s) => s ? new Date(year, Number(s.slice(0, 2)) - 1, Number(s.slice(3))) : null;
const near = (date, target, before, after) => {
  if (!target) return false;
  const d = daysFrom(date, target);
  return d >= -before && d <= after;
};

// Which celebration is on at this moment, or null
export function seasonOn(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  if ((m === 12 && d === 31 && date.getHours() >= 18) || (m === 1 && d === 1)) return 'newyear';
  if (m === 12 && d >= 20 && d <= 26) return 'christmas';
  if (m === 2 && (d === 13 || d === 14)) return 'valentine';
  if (near(date, md(y, LUNAR_NEW_YEAR[y]), 1, 4)) return 'lunar';
  if (m === 10 && d >= 29) return 'halloween';
  if (near(date, md(y, MID_AUTUMN[y]), 1, 1)) return 'midautumn';
  if (near(date, easter(y), 2, 1)) return 'easter';
  if (m === 11 && d === 10) return 'birthday';
  return null;
}

// ── State ──
let back = null, scene = null, bursts = null, front = null;
let shown;                // the season whose scene is built (undefined until the first update)
let preview = null;       // picked in the developer window; wins over the calendar and the switch
let cached = { at: 0, key: null };
let fireworks = null;
let celebrated = null;    // the session whose record already got its confetti
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

export const previewed = () => preview;
export function setPreview(key) { preview = SEASONS.includes(key) ? key : null; window.dispatchEvent(new Event('hr-rerender')); }

// The season on screen for these settings
export function active(s) {
  if (preview) return preview;
  if (s?.settings?.seasonalEffects === false || reduced.matches) return null;
  const now = Date.now();
  if (now - cached.at > 30000) cached = { at: now, key: seasonOn(new Date(now)) };
  return cached.key;
}

// Fine film grain as a small tile of noise (as in the Overlay page's scene)
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".95" numOctaves="1" stitchTiles="stitch"/>'
  + '<feColorMatrix values="1.8 0 0 0 -.4  1.8 0 0 0 -.4  1.8 0 0 0 -.4  0 0 0 0 1"/></filter><rect width="180" height="180" filter="url(#n)"/></svg>')}")`;

function layers() {
  if (back) return;
  scene = h('div', { class: 'fx-scene' });
  bursts = h('div', { class: 'fx-bursts' });
  back = h('div', { id: 'fx-back', 'aria-hidden': 'true' }, scene, bursts,
    h('div', { class: 'fx-vignette' }), h('div', { class: 'fx-grain', style: { backgroundImage: GRAIN } }));
  front = h('div', { id: 'fx-front', 'aria-hidden': 'true' });
  document.body.prepend(back);
  document.body.append(front);
}

// Called on every redraw: cheap unless the season changes
export function update(s, bpm) {
  layers();
  const key = active(s);
  if (key !== shown) build(key);
  document.documentElement.dataset.season = key || '';
  // Halloween: a heart rate of 180 and more makes the red behind the page pulse with the heart
  const scary = key === 'halloween' && bpm >= 180;
  back.classList.toggle('scary', scary);
  if (scary) back.style.setProperty('--fx-beat', (60 / Math.min(220, bpm)).toFixed(3) + 's');
  if (key === 'birthday' && !preview) birthdayOnce();
  if (s && (s.settings?.seasonalEffects !== false) && !reduced.matches) record(s, bpm);
}

function build(key) {
  shown = key;
  fireworks?.stop(); fireworks = null;
  scene.className = 'fx-scene' + (key ? ' fx-' + key : '');
  scene.replaceChildren(...(SCENES[key]?.() || []));
  back.classList.toggle('on', !!key);
  if (key === 'newyear') fireworks = startFireworks(scene.querySelector('canvas'));
}

// A small, repeatable random, so the same season always looks the same
function seeded(n) {
  let seed = n;
  return () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
}
const px = v => v.toFixed(1) + 'px';
const pct = v => v.toFixed(1) + '%';
const sec = v => v.toFixed(2) + 's';

// Depth of field: d runs from 0 (far, small, sharp) to 1 (near, large, out of focus). Most things
// are far away, a few come close.
function field(n, seed, make) {
  const rnd = seeded(seed);
  return Array.from({ length: n }, (_, i) => make(Math.pow(rnd(), 1.7), rnd, i));
}
const focus = d => d > .72 ? `blur(${((d - .72) / .28 * 6 + 1.5).toFixed(1)}px)` : d < .18 ? 'blur(.6px)' : 'none';

// ── The scenes ──

const SCENES = {
  // Snow in three depths: a fine far fall, a middle layer, and a few big soft flakes close by
  christmas: () => [
    h('div', { class: 'fx-sky fx-sky-winter' }),
    ...field(120, 3, (d, rnd) => h('span', { class: 'fx-flake', style: {
      left: pct(rnd() * 100), '--size': px(2.5 + d * d * 26), '--sway': px(12 + rnd() * 40 + d * 40),
      opacity: (d > .72 ? .55 : .5 + rnd() * .4).toFixed(2), filter: focus(d),
      animationDuration: sec(26 - d * 16 + rnd() * 6), animationDelay: sec(-rnd() * 30) } })),
  ],

  valentine: () => [
    h('div', { class: 'fx-sky fx-sky-rose' }),
    ...field(26, 5, (d, rnd) => {
      const size = 9 + d * d * 46;
      return h('span', { class: 'fx-heart', style: {
        left: pct(4 + rnd() * 92), '--drift': px((rnd() - .5) * 140), '--spin': (rnd() - .5) * 50 + 'deg', '--alpha': (.45 + rnd() * .35).toFixed(2),
        filter: focus(d), animationDuration: sec(24 - d * 12 + rnd() * 6), animationDelay: sec(-rnd() * 26) } },
        svg('svg', { viewBox: '0 0 24 24', width: size.toFixed(0), height: size.toFixed(0) },
          svg('path', { d: HEART_PATH, fill: rnd() < .5 ? '#ff4d7d' : '#ff8fb1' })));
    }),
  ],

  // Red lanterns swaying on the right, one close and out of focus, gold sparks rising
  lunar: () => {
    const spots = [[62, 70, 1, 0], [71, 110, .75, 1], [80, 60, 1.1, 0], [89, 124, .7, 1], [96, 84, .85, 0], [52, 30, 2.1, 6]];
    return [
      h('div', { class: 'fx-sky fx-sky-lunar' }),
      ...spots.map(([left, string, scale, blur], i) => h('div', { class: 'fx-lantern', style: {
        left: left + '%', '--string': string + 'px', '--scale': scale, filter: blur ? `blur(${blur}px)` : null,
        animationDelay: sec(-i * 1.3), animationDuration: sec(5 + i * .7) } },
        h('span', { class: 'fx-lantern-body' }), h('span', { class: 'fx-lantern-tassel' }))),
      ...field(30, 8, (d, rnd) => h('span', { class: 'fx-spark', style: {
        left: pct(rnd() * 100), '--size': px(2 + d * 7), '--drift': px((rnd() - .5) * 90), filter: focus(d),
        animationDuration: sec(16 - d * 7 + rnd() * 5), animationDelay: sec(-rnd() * 19) } })),
    ];
  },

  // An orange moon, fog drifting low, and bats coming out of the moon: small and far at first,
  // then large and blurred as they fly past, alone or as a swarm
  halloween: () => [
    h('div', { class: 'fx-sky fx-sky-halloween' }),
    h('div', { class: 'fx-moon fx-moon-orange' }),
    h('div', { class: 'fx-fog a' }), h('div', { class: 'fx-fog b' }), h('div', { class: 'fx-fog c' }),
    ...BAT_FLIGHTS.flatMap(flight),
    h('div', { class: 'fx-scare' }),
  ],

  // The full moon rising behind thin clouds, and sky lanterns drifting up towards it
  midautumn: () => [
    h('div', { class: 'fx-sky fx-sky-night' }),
    h('div', { class: 'fx-moon-rise' }, h('div', { class: 'fx-halo' }), h('div', { class: 'fx-moon fx-moon-full' })),
    h('div', { class: 'fx-cloud a' }), h('div', { class: 'fx-cloud b' }), h('div', { class: 'fx-cloud c' }),
    ...field(22, 21, (d, rnd) => {
      const w = 7 + d * d * 34;
      return h('span', { class: 'fx-skylantern', style: {
        left: pct(6 + rnd() * 90), '--w': px(w), '--drift': px((rnd() - .3) * 160), filter: focus(d),
        animationDuration: sec(40 - d * 18 + rnd() * 10), animationDelay: sec(-rnd() * 50) } },
        h('span', { class: 'fx-skylantern-glow', style: { animationDelay: sec(-rnd() * 3) } }));
    }),
  ],

  // A spring morning: warm low sun with slow rays, and cherry blossom drifting through the light
  easter: () => [
    h('div', { class: 'fx-sky fx-sky-spring' }),
    h('div', { class: 'fx-sun' }),
    h('div', { class: 'fx-rays' }),
    ...field(34, 17, (d, rnd, i) => {
      const size = 9 + d * d * 40;
      return h('span', { class: 'fx-blossom', style: {
        left: pct(rnd() * 104 - 2), '--sway': px(30 + rnd() * 70), '--spin': (240 + rnd() * 420).toFixed(0) + 'deg', filter: focus(d),
        animationDuration: sec(30 - d * 14 + rnd() * 8), animationDelay: sec(-rnd() * 34) } }, blossom(size, i));
    }),
  ],

  birthday: () => [
    h('div', { class: 'fx-sky fx-sky-party' }),
    ...field(40, 19, (d, rnd, i) => confettiPiece(rnd, i, { slow: true, d })),
  ],

  newyear: () => [h('div', { class: 'fx-sky fx-sky-night' }), h('canvas', { class: 'fx-canvas' })],
};

// A cherry blossom: five petals around a darker centre
function blossom(size, i) {
  const petal = ['#ffd6e4', '#ffe8ef', '#fbc4d6'][i % 3];
  return svg('svg', { viewBox: '0 0 24 24', width: size.toFixed(0), height: size.toFixed(0) },
    [0, 72, 144, 216, 288].map(a => svg('ellipse', { cx: 12, cy: 6.6, rx: 3.9, ry: 5.6, fill: petal, transform: `rotate(${a} 12 12)` })),
    svg('circle', { cx: 12, cy: 12, r: 2.6, fill: '#f48fb1' }),
    svg('circle', { cx: 12, cy: 12, r: 1.1, fill: '#ffd36b' }));
}

// ── Halloween's bats ──
// Each flight starts small near the moon (top right) and ends large in another corner. A flight
// takes up the first part of its cycle; for the rest of it the sky is empty again.
const BAT_FLIGHTS = [
  // a swarm out of the moon, along the sky above the cards and out at the top left, close by
  { n: 14, cycle: 30, delay: -3, from: [80, 12, .07], via: [52, 15, .45], to: [-20, 6, 1.9], spread: 70, blur: 5 },
  // a single one out of the moon, straight at you past the right edge
  { n: 1, cycle: 23, delay: -12, from: [82, 11, .07], via: [92, 20, .7], to: [112, 40, 2.6], spread: 0, blur: 8 },
  // a swarm low down, under the cards, from the right towards the bottom left
  { n: 8, cycle: 41, delay: -24, from: [96, 84, .1], via: [62, 90, .5], to: [-25, 102, 1.6], spread: 45, blur: 4 },
  // far away, across the moon and back into the distance
  { n: 3, cycle: 37, delay: -6, from: [60, 16, .06], via: [80, 9, .1], to: [95, 14, .05], spread: 26, blur: 0, span: .42 },
];

function flight(f, fi) {
  const rnd = seeded(31 + fi * 7);
  return Array.from({ length: f.n }, (_, i) => {
    const dx = i ? (rnd() - .5) * f.spread * 2 : 0, dy = i ? (rnd() - .5) * f.spread : 0;
    return h('div', { class: 'fx-bat-flight' + (f.span ? ' long' : ''), style: {
      '--x0': f.from[0] + 'vw', '--y0': f.from[1] + 'vh', '--s0': f.from[2],
      '--xm': f.via[0] + 'vw', '--ym': f.via[1] + 'vh', '--sm': f.via[2],
      '--x1': f.to[0] + 'vw', '--y1': f.to[1] + 'vh', '--s1': f.to[2], '--b1': f.blur + 'px',
      animationDuration: sec(f.cycle), animationDelay: sec(f.delay + i * .16 + rnd() * .25) } },
      h('div', { class: 'fx-bat-offset', style: { transform: `translate(${px(dx)}, ${px(dy)})` } }, bat(rnd)));
  });
}

function bat(rnd) {
  const wing = 'M50 24 C42 13 28 7 6 11 C11 15 13 19 11 25 C17 23 21 25 23 31 C28 27 33 28 36 33 C39 28 45 27 50 29 Z';
  const flap = sec(.16 + rnd() * .1);
  return svg('svg', { class: 'fx-bat', viewBox: '0 0 100 50', width: 92, height: 46 },
    svg('path', { class: 'fx-wing', d: wing, style: `animation-duration:${flap}` }),
    svg('g', { transform: 'translate(100 0) scale(-1 1)' }, svg('path', { class: 'fx-wing', d: wing, style: `animation-duration:${flap}` })),
    svg('ellipse', { cx: 50, cy: 28, rx: 5, ry: 9 }),
    svg('circle', { cx: 50, cy: 19, r: 4.2 }),
    svg('path', { d: 'M46.2 17 L46.8 10.5 L49.2 16 Z M53.8 17 L53.2 10.5 L50.8 16 Z' }));
}

// ── Confetti ──
const CONFETTI = ['#5b9bff', '#ff4d7d', '#ffd166', '#34d399', '#c084fc', '#38bdf8', '#ffffff'];
function confettiPiece(rnd, i, { slow = false, d = rnd() } = {}) {
  const k = .7 + d * 1.6;
  return h('span', { class: 'fx-confetti' + (slow ? ' slow' : ''), style: {
    left: pct(rnd() * 100), background: CONFETTI[i % CONFETTI.length], '--w': px((5 + rnd() * 5) * k), '--h': px((8 + rnd() * 8) * k),
    '--sway': px((rnd() - .5) * 160), '--spin': (360 + rnd() * 900).toFixed(0) + 'deg', filter: focus(d),
    animationDuration: sec(slow ? 26 - d * 12 + rnd() * 8 : 2.8 + rnd() * 2 - d), animationDelay: sec(slow ? -rnd() * 30 : rnd() * .9) } });
}

// One shower of confetti behind the page, with a line of text over it that fades in and out
export function burst(text) {
  if (reduced.matches && !preview) return;
  layers();
  const rnd = seeded(Date.now() % 233280);
  const node = h('div', { class: 'fx-burst' }, Array.from({ length: 140 }, (_, i) => confettiPiece(rnd, i)));
  const toast = text ? h('div', { class: 'fx-toast' }, text) : null;
  bursts.append(node);
  if (toast) front.append(toast);
  back.classList.add('bursting');
  setTimeout(() => { node.remove(); toast?.remove(); if (!bursts.childElementCount) back.classList.remove('bursting'); }, 7000);
}

export function birthdayBurst() {
  burst(t('fx_birthday_toast', { n: new Date().getFullYear() - BIRTH_YEAR }));
}

// The first time the app is opened on the birthday, once a year
function birthdayOnce() {
  const year = String(new Date().getFullYear());
  let seen = null;
  try { seen = localStorage.getItem('hr-fx-birthday'); } catch {}
  if (seen === year) return;
  try { localStorage.setItem('hr-fx-birthday', year); } catch {}
  setTimeout(birthdayBurst, 900);
}

// A heart rate above every finished session's peak, during a running session. Only with three
// sessions or more to compare against, and once per session.
function record(s, bpm) {
  const list = s.sessions?.list || [];
  const live = list.find(x => x.live);
  if (!live || bpm == null || celebrated === live.startedAt) return;
  const done = list.filter(x => !x.live && x.peak > 0);
  if (done.length < 3) return;
  const best = Math.max(...done.map(x => x.peak));
  if (bpm <= best) return;
  celebrated = live.startedAt;
  burst(t('fx_record', { bpm }));
}

// ── New Year's Eve: fireworks on a canvas ──
// A rocket every couple of seconds; on the stroke of midnight (local time) a minute of finale.
// Between rockets, when nothing is in the air, the loop sleeps instead of drawing empty frames.
let finaleUntil = 0;
export function finale() { finaleUntil = Date.now() + 25000; fireworks?.wake(); }

function startFireworks(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const HUES = [210, 340, 45, 150, 280, 190, 20];
  let w = 0, hgt = 0, rockets = [], sparks = [], nextAt = 0, raf = 0, timer = 0, stopped = false, last = 0;
  const scale = .6;   // drawn small and scaled up: soft like a far-off view, and cheap
  const size = () => {
    w = canvas.clientWidth; hgt = canvas.clientHeight;
    canvas.width = Math.round(w * scale); canvas.height = Math.round(hgt * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  };
  size();
  window.addEventListener('resize', size);

  const midnight = () => { const d = new Date(); return d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() < 1; };
  const big = () => Date.now() < finaleUntil || midnight();
  const launch = () => {
    const hue = HUES[Math.floor(Math.random() * HUES.length)];
    rockets.push({ x: w * (.12 + Math.random() * .76), y: hgt + 10, vx: (Math.random() - .5) * .6, vy: -(hgt * .0105 + Math.random() * 3.2), hue, top: hgt * (.12 + Math.random() * .32) });
  };
  const explode = r => {
    const n = big() ? 90 : 64, speed = 2.2 + Math.random() * 1.6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, v = speed * (.55 + Math.random() * .45);
      sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: .011 + Math.random() * .012, hue: r.hue + (Math.random() - .5) * 30 });
    }
  };

  const frame = now => {
    raf = 0;
    if (stopped) return;
    const dt = Math.min(2.5, last ? (now - last) / 16.7 : 1);
    last = now;
    if (Date.now() >= nextAt) { launch(); if (big()) launch(); nextAt = Date.now() + (big() ? 220 + Math.random() * 320 : 1600 + Math.random() * 1800); }
    // fade what was drawn, so the sparks leave short trails on a transparent canvas
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(0, 0, w, hgt);
    ctx.globalCompositeOperation = 'lighter';
    rockets = rockets.filter(r => {
      r.x += r.vx * dt; r.y += r.vy * dt; r.vy += .035 * dt;
      ctx.fillStyle = `hsla(${r.hue},100%,80%,.9)`;
      ctx.fillRect(r.x - 1, r.y - 3, 2, 6);
      if (r.y <= r.top || r.vy >= 0) { explode(r); return false; }
      return true;
    });
    sparks = sparks.filter(p => {
      p.vx *= .985; p.vy = p.vy * .985 + .04 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= p.decay * dt;
      if (p.life <= 0) return false;
      ctx.fillStyle = `hsla(${p.hue},95%,${50 + p.life * 14}%,${(p.life * .7).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.1 + p.life * 1.1, 0, Math.PI * 2); ctx.fill();
      return true;
    });
    if (rockets.length || sparks.length) { raf = requestAnimationFrame(frame); return; }
    // nothing in the air: clear the last trails and sleep until the next rocket
    ctx.clearRect(0, 0, w, hgt);
    last = 0;
    timer = setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, Math.max(0, nextAt - Date.now()));
  };
  raf = requestAnimationFrame(frame);
  return {
    wake() { if (timer) { clearTimeout(timer); timer = 0; nextAt = 0; raf = requestAnimationFrame(frame); } else nextAt = 0; },
    stop() { stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); window.removeEventListener('resize', size); },
  };
}
