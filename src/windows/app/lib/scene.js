// The landscape behind the overlay preview, following the time of day: the sun moves in a flat
// arc from left (sunrise) to right (sunset), the moon takes the night, and sky, haze and the soft
// mountain ridges blend from one mood to the next. Film grain and a few soft specks of light
// (bokeh) lie over it.
//
// Sky and ridges stretch with the width (gradients and soft curves do not mind); sun, moon,
// stars and bokeh are placed in percent, so they stay round at any width. The grain is a small
// repeating noise tile, so it stays equally fine.

import { h, svg } from './dom.js';

// Moods through the day, by hour. Between two of them every colour is blended.
//   sky: top → horizon · haze: the mist between ridges · ridges: back → front
//   sun: core, edge, glow · bokeh: colour (r,g,b) and how much of it · night: stars and moon (0–1)
const MOODS = [
  { at: 0,    sky: ['#04071a', '#0a1233', '#17204d', '#253064'], haze: '#3a4a8a', ridges: ['#2a336a', '#1d2452', '#121738', '#070917'], sun: ['#fff4d8', '#ffb46c', '#ffaf73'], bokeh: [170, 185, 255], amount: .35, night: 1 },
  { at: 4.8,  sky: ['#060a20', '#101a42', '#24305e', '#3b3f72'], haze: '#4a5390', ridges: ['#333a72', '#232a5a', '#151a3e', '#080a1a'], sun: ['#fff4d8', '#ffb46c', '#ffaf73'], bokeh: [180, 185, 255], amount: .35, night: .9 },
  { at: 6.2,  sky: ['#1f2a62', '#5d4f93', '#d98a86', '#f8c39a'], haze: '#e8a493', ridges: ['#856a9e', '#634e86', '#3d305e', '#1d1733'], sun: ['#fff0d0', '#ff9d5c', '#ff9a68'], bokeh: [255, 180, 140], amount: .8, night: .15 },
  { at: 8,    sky: ['#2b3a76', '#7d64a3', '#ee9f80', '#ffd7a6'], haze: '#f4b393', ridges: ['#9b7aa6', '#76598f', '#4b3a6a', '#251c3c'], sun: ['#fff4d8', '#ffb46c', '#ffaf73'], bokeh: [255, 190, 140], amount: .8, night: 0 },
  { at: 12.5, sky: ['#2b68cc', '#5795e4', '#a3cef9', '#dcedff'], haze: '#cfe3ff', ridges: ['#8fa4d8', '#6c80c0', '#47579a', '#262f63'], sun: ['#ffffff', '#fff1bd', '#fffadc'], bokeh: [255, 255, 240], amount: .45, night: 0 },
  { at: 16.5, sky: ['#3164bf', '#6a8fd6', '#c2c6e8', '#ffe1bf'], haze: '#f1d3c0', ridges: ['#9b9bcf', '#7779b6', '#4c4f8e', '#272b5c'], sun: ['#fffaf0', '#ffd68a', '#ffe3a8'], bokeh: [255, 225, 180], amount: .55, night: 0 },
  { at: 19,   sky: ['#1f2357', '#68397c', '#d15f78', '#ffa060'], haze: '#ef8c6e', ridges: ['#94547a', '#6c3a66', '#40234f', '#1a1028'], sun: ['#fff1c6', '#ff7a3b', '#ff733c'], bokeh: [255, 160, 90], amount: 1, night: 0 },
  { at: 20.8, sky: ['#0f1240', '#33286a', '#6e3d78', '#a5566c'], haze: '#8a5a86', ridges: ['#563f72', '#3a2a5a', '#211839', '#0c0918'], sun: ['#fff1c6', '#ff7a3b', '#ff733c'], bokeh: [220, 160, 200], amount: .6, night: .55 },
  { at: 22,   sky: ['#04071a', '#0a1233', '#17204d', '#253064'], haze: '#3a4a8a', ridges: ['#2a336a', '#1d2452', '#121738', '#070917'], sun: ['#fff4d8', '#ffb46c', '#ffaf73'], bokeh: [170, 185, 255], amount: .35, night: 1 },
];
const SUNRISE = 6, SUNSET = 20.5;

const hex = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, f) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * f));
const mixNum = (a, b, f) => a + (b - a) * f;

// The mood at an hour (0–24): the two neighbours, blended smoothly
export function moodAt(hour) {
  const list = [...MOODS, { ...MOODS[0], at: 24 }];
  const k = list.findIndex((m, i) => hour >= m.at && hour < list[i + 1].at);
  const a = list[k], b = list[k + 1];
  const lin = (hour - a.at) / (b.at - a.at);
  const f = lin * lin * (3 - 2 * lin);   // eased, so no mood starts or ends with a visible jolt
  return {
    sky: a.sky.map((c, i) => mixHex(c, b.sky[i], f)),
    haze: mixHex(a.haze, b.haze, f),
    ridges: a.ridges.map((c, i) => mixHex(c, b.ridges[i], f)),
    sun: a.sun.map((c, i) => mixHex(c, b.sun[i], f)),
    bokeh: a.bokeh.map((v, i) => mixNum(v, b.bokeh[i], f)),
    amount: mixNum(a.amount, b.amount, f),
    night: mixNum(a.night, b.night, f),
  };
}

// Where sun and moon are (percent of the width and height), and how visible
export function skyBodies(hour) {
  const arc = (p) => ({ x: 4 + p * 92, y: 62 - Math.sin(p * Math.PI) * 50 });
  const day = (hour - SUNRISE) / (SUNSET - SUNRISE);
  const nightLength = 24 - (SUNSET - SUNRISE);
  const night = ((hour - SUNSET + 24) % 24) / nightLength;
  return {
    sun: day >= -0.03 && day <= 1.03 ? arc(Math.max(0, Math.min(1, day))) : null,
    moon: night >= 0 && night <= 1 ? arc(night) : null,
  };
}

// Soft ridge lines: slow waves of different length added up, drawn as a smooth curve
const W = 900, H = 240;
function ridge(base, amp, seed, detail) {
  const pts = [];
  for (let x = -20; x <= W + 20; x += 12) {
    pts.push([x, base
      - amp * (0.55 * Math.sin(x / 140 + seed) + 0.3 * Math.sin(x / 63 + seed * 2.1) + 0.15 * detail * Math.sin(x / 27 + seed * 3.7))
      - amp * 0.35 * Math.exp(-(((x - (300 + seed * 97) % W) / 120) ** 2))]);
  }
  let d = `M ${pts[0][0]} ${H + 5} L ${pts[0][0]} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {   // Catmull-Rom → Bézier: a curve without corners
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], [x2, y2] = pts[i + 1], [x3, y3] = pts[Math.min(i + 2, pts.length - 1)];
    d += ` C ${(x1 + (x2 - x0) / 6).toFixed(1)} ${(y1 + (y2 - y0) / 6).toFixed(1)}, ${(x2 - (x3 - x1) / 6).toFixed(1)} ${(y2 - (y3 - y1) / 6).toFixed(1)}, ${x2} ${y2.toFixed(1)}`;
  }
  return d + ` L ${pts.at(-1)[0]} ${H + 5} Z`;
}
const RIDGES = [ridge(122, 44, 1.3, .7), ridge(150, 46, 4.1, .9), ridge(182, 34, 2.2, 1), ridge(212, 20, 5.6, 1)];
const RIDGE_BLUR = [2.2, 1.2, .5, 0];
const HAZE_AT = [95, 125, 160];

// Stars and bokeh stay where they are (seeded), only their light changes
let seed = 11;
const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const STARS = Array.from({ length: 70 }, () => ({ x: rnd() * 100, y: rnd() * 50, r: rnd() * 1.1 + .4, o: rnd() * .6 + .3 }));
const BOKEH = Array.from({ length: 18 }, () => ({ x: rnd() * 100, y: 18 + rnd() * 72, r: rnd() * 7 + 3, o: rnd() * .35 + .15 }));

// Fine film grain as a small tile of noise
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".95" numOctaves="1" stitchTiles="stitch"/>'
  + '<feColorMatrix values="1.8 0 0 0 -.4  1.8 0 0 0 -.4  1.8 0 0 0 -.4  0 0 0 0 1"/></filter><rect width="180" height="180" filter="url(#n)"/></svg>')}")`;

// The scene for a moment (minutes are enough: nothing moves faster than that)
export function dayScene(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const m = moodAt(hour);
  const { sun, moon } = skyBodies(hour);
  const rgb = m.bokeh.map(Math.round).join(',');
  const body = (pos, cls, size, glow) => h('div', { class: 'sky-body ' + cls, style: { left: pos.x + '%', top: pos.y + '%', '--size': size + 'px', '--glow': glow } });
  return h('div', { class: 'day-scene', 'aria-hidden': 'true' },
    h('div', { class: 'day-sky', style: { background: `linear-gradient(180deg, ${m.sky[0]} 0%, ${m.sky[1]} 45%, ${m.sky[2]} 78%, ${m.sky[3]} 100%)` } }),
    m.night > .05 ? h('div', { class: 'day-stars', style: { opacity: m.night.toFixed(2) } },
      STARS.map(s => h('span', { style: { left: s.x + '%', top: s.y + '%', width: s.r * 2 + 'px', height: s.r * 2 + 'px', opacity: s.o } }))) : null,
    sun ? body(sun, 'sun', 52, m.sun[2]) : null,
    sun ? h('div', { class: 'sky-body sun-core', style: { left: sun.x + '%', top: sun.y + '%', background: `radial-gradient(circle, ${m.sun[0]} 0%, ${m.sun[1]} 70%, transparent 100%)` } }) : null,
    // the moon's glow lies outside its crescent (the crescent is masked, the glow would be cut)
    moon && m.night > .3 ? h('div', { class: 'sky-body sun', style: { left: moon.x + '%', top: moon.y + '%', '--size': '44px', '--glow': 'rgba(185, 195, 255, .4)', opacity: (Math.min(1, (m.night - .3) / .5) * .75).toFixed(2) } }) : null,
    moon && m.night > .3 ? h('div', { class: 'sky-body moon', style: { left: moon.x + '%', top: moon.y + '%', opacity: Math.min(1, (m.night - .3) / .5).toFixed(2), '--sky': m.sky[1] } }, h('span')) : null,
    svg('svg', { class: 'day-ridges', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' },
      svg('defs', {},
        m.ridges.map((c, k) => svg('linearGradient', { id: 'dr' + k, x1: 0, y1: 0, x2: 0, y2: 1 },
          svg('stop', { offset: 0, 'stop-color': c }), svg('stop', { offset: 1, 'stop-color': m.ridges[Math.min(3, k + 1)] }))),
        svg('linearGradient', { id: 'dhaze', x1: 0, y1: 0, x2: 0, y2: 1 },
          svg('stop', { offset: 0, 'stop-color': m.haze, 'stop-opacity': 0 }), svg('stop', { offset: .55, 'stop-color': m.haze, 'stop-opacity': .28 }), svg('stop', { offset: 1, 'stop-color': m.haze, 'stop-opacity': 0 })),
        RIDGE_BLUR.map((b, k) => svg('filter', { id: 'dblur' + k, x: '-5%', y: '-20%', width: '110%', height: '140%' }, svg('feGaussianBlur', { stdDeviation: b })))),
      RIDGES.map((d, k) => [
        svg('path', { d, fill: `url(#dr${k})`, filter: RIDGE_BLUR[k] ? `url(#dblur${k})` : null }),
        k < 3 ? svg('rect', { y: HAZE_AT[k], width: W, height: 70, fill: 'url(#dhaze)' }) : null,
      ])),
    h('div', { class: 'day-bokeh' }, BOKEH.map((b, i) => i < Math.round(BOKEH.length * m.amount)
      ? h('span', { style: { left: b.x + '%', top: b.y + '%', width: b.r * 2 + 'px', height: b.r * 2 + 'px', opacity: b.o, background: `radial-gradient(circle, rgb(${rgb}) 0%, rgba(${rgb}, .55) 60%, rgba(${rgb}, 0) 100%)` } })
      : null)),
    h('div', { class: 'day-vignette' }),
    h('div', { class: 'day-grain', style: { backgroundImage: GRAIN } }));
}
