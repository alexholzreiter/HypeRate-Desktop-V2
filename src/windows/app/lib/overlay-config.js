// The overlay's look: the config format the overlay window reads, its defaults, and a preview
// drawn the same way as in the previous settings window, so what you see is what the overlay shows.

export const DEFAULT_ZONES = [
  { name: 'Low', min: 0, max: 99, color: '#22c55e' },
  { name: 'Medium', min: 100, max: 139, color: '#f59e0b' },
  { name: 'High', min: 140, max: 999, color: '#ef4444' },
];

export const DEFAULTS = {
  heartAnim: 'pulse', heartStyle: 'filled', heartColor: '#2563eb', heartSize: 48,
  heartGlow: true, heartGlowOpacity: 100, glowColor: '#2563eb',
  fontStyle: 'mono', systemFont: '', bpmColor: '#ffffff', labelColor: '#8888bb', bpmSize: 40,
  numAnim: 'flip', textGlow: true, textGlowOpacity: 100,
  bgStyle: 'dark-pill', bgColor: '#000000', bgColor2: '#000000', bgOpacity: 75,
  layoutStyle: 'horizontal', borderRadius: 16, showLabel: true, showBorder: false, heartTint: true,
  zonesEnabled: false, zonesAffectFont: true, zones: DEFAULT_ZONES,
};

export const FONTS = {
  mono: "'Space Mono',monospace", sans: "'DM Sans',sans-serif", serif: "'Playfair Display',serif",
  display: "'Bebas Neue',cursive", retro: "'VT323',monospace",
};

// Settings from an older version may lack keys; the game settings (gameThemes, wowScale …)
// live in the same object and are kept untouched.
export function withDefaults(config) {
  return { ...DEFAULTS, ...(config || {}), zones: config?.zones?.length ? config.zones : DEFAULT_ZONES };
}

export function heartShapes() {
  const shapes = window.HEART_SHAPES || {};
  return [
    ...Object.entries(shapes).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([id, s]) => ({ id, label: s.label, svg: s.svg })),
    { id: 'minimal', label: 'Minimal dot', svg: null },
  ];
}

const rgba = (hex, a) => {
  const n = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000';
  return `rgba(${parseInt(n.slice(1, 3), 16)},${parseInt(n.slice(3, 5), 16)},${parseInt(n.slice(5, 7), 16)},${a})`;
};

// Uploaded hearts and fonts: config values 'custom:<file>', served from hr-asset://a/<file>.
// Only names the app gave them pass, so nothing else ends up in a URL or a style.
const CUSTOM_FILE = /^(heart|font)-[0-9a-f]{16}\.[a-z0-9]{2,5}$/;
export function customFile(value, kind) {
  const file = typeof value === 'string' && value.startsWith('custom:') ? value.slice(7) : '';
  return CUSTOM_FILE.test(file) && file.startsWith(kind + '-') ? file : null;
}
export const assetUrl = file => 'hr-asset://a/' + file;

// The uploaded hearts that still exist; set by the window on every render
let knownHearts = null;
export function setKnownHearts(list) { knownHearts = new Set((list || []).map(a => a.file)); }

const loadedFonts = new Set();
export function customFontFamily(file) {
  const family = 'hr-' + file.replace(/\W/g, '-');
  if (!loadedFonts.has(file)) {
    loadedFonts.add(file);
    new FontFace(family, `url(${assetUrl(file)})`).load()
      .then(face => { document.fonts.add(face); window.dispatchEvent(new Event('hr-rerender')); })
      .catch(() => {});
  }
  return `'${family}',sans-serif`;
}

// How far to move the number so its digits sit in the middle of a box trimmed to cap height and
// baseline. Fonts place digits differently (old-style figures sit low, handwriting high); this
// measures the real outline of all ten digits, so the result is the same for every value.
const digitCtx = document.createElement('canvas').getContext('2d');
export function digitOffset(family, size) {
  digitCtx.font = `700 ${size}px ${family}`;
  const d = digitCtx.measureText('0123456789'), cap = digitCtx.measureText('H');
  const glyphMid = (d.actualBoundingBoxAscent - d.actualBoundingBoxDescent) / 2;
  return Math.round((cap.actualBoundingBoxAscent / 2 - glyphMid) * 10) / 10;
}

export function fontFor(c) {
  const custom = customFile(c.fontStyle, 'font');
  if (custom) return customFontFamily(custom);
  return c.fontStyle === 'system' && c.systemFont ? `'${c.systemFont.replace(/'/g, '')}',sans-serif` : (FONTS[c.fontStyle] || FONTS.mono);
}

function zoneColor(c, bpm) {
  if (!c.zonesEnabled || !c.zones?.length) return null;
  if (bpm == null) return c.zones[0]?.color || null;   // no live value: show the first zone as a demo
  return c.zones.find(z => bpm >= z.min && bpm <= z.max)?.color || null;
}

// Draws the widget into `el` (a .preview-widget with .ph, .pn, .pl inside)
export function drawPreview(el, c, bpm) {
  const ph = el.querySelector('.ph'), pn = el.querySelector('.pn'), pl = el.querySelector('.pl');
  const zone = zoneColor(c, bpm);
  const active = zone || c.heartColor;
  const glowBase = zone || (c.glowColor && c.glowColor !== '#000000' ? c.glowColor : active);
  const alpha = c.heartGlowOpacity / 100;
  const glow = rgba(glowBase, alpha);
  ph.style.setProperty('--glow-color', glow);

  if (c.heartStyle === 'minimal') {
    const dot = document.createElement('span');
    Object.assign(dot.style, { display: 'block', borderRadius: '50%', width: c.heartSize + 'px', height: c.heartSize + 'px', background: active });
    if (c.heartGlow) dot.style.boxShadow = `0 0 16px 2px ${glow}, 0 0 32px 4px ${rgba(glowBase, alpha * 64 / 255)}`;
    ph.replaceChildren(dot);
    Object.assign(ph.style, { fontSize: '0', color: 'transparent', filter: 'none' });
  } else {
    let custom = customFile(c.heartStyle, 'heart');
    // Only hearts that are still in the list; a deleted one falls back to the default shape
    if (custom && knownHearts && !knownHearts.has(custom)) custom = null;
    if (custom && c.heartTint !== false) {
      // Tinted: the image as a mask, so it takes the heart colour like the built-in shapes
      const shape = document.createElement('span');
      shape.className = 'custom-heart tinted';
      shape.style.setProperty('--mask', `url(${assetUrl(custom)})`);
      ph.replaceChildren(shape);
    } else if (custom) {
      const img = document.createElement('img');
      img.className = 'custom-heart';
      img.alt = '';
      img.src = assetUrl(custom);
      ph.replaceChildren(img);
    } else {
      const shapes = window.HEART_SHAPES || {};
      const shape = shapes[c.heartStyle] || shapes.filled;
      // Shapes ship with the app (src/hearts.js), they are not user input
      ph.innerHTML = shape ? shape.svg : '';
    }
    Object.assign(ph.style, { fontSize: c.heartSize + 'px', color: active, filter: c.heartAnim === 'glow' || !c.heartGlow ? 'none' : `drop-shadow(0 0 12px ${glow})` });
  }
  ph.className = 'ph' + (c.heartAnim !== 'none' ? ' pa-' + c.heartAnim : '');
  ph.style.display = c.layoutStyle === 'compact' ? 'none' : 'block';

  const fontColor = (c.zonesEnabled && c.zonesAffectFont !== false && zone) ? zone : c.bpmColor;
  pn.textContent = bpm ?? '--';
  Object.assign(pn.style, { fontFamily: fontFor(c), fontSize: c.bpmSize + 'px', color: fontColor, textShadow: c.textGlow ? `0 0 20px ${rgba(fontColor, c.textGlowOpacity / 100)}` : 'none' });
  pl.style.color = c.labelColor;
  pl.style.display = c.showLabel && c.layoutStyle !== 'compact' ? 'block' : 'none';
  // Alone next to the heart, the number is cut to its digits so every font sits centred
  const alone = !(c.showLabel && c.layoutStyle !== 'compact');
  pn.style.setProperty('text-box', alone ? 'trim-both cap alphabetic' : 'normal');
  pn.style.position = 'relative';
  pn.style.top = alone ? digitOffset(fontFor(c), c.bpmSize) + 'px' : '0px';

  el.style.flexDirection = c.layoutStyle === 'vertical' ? 'column' : 'row';
  const op = c.bgOpacity / 100, br = c.borderRadius + 'px';
  const bg = {
    transparent: ['transparent', '0', '0'],
    'dark-pill': [`rgba(0,0,0,${op})`, '12px 18px', br],
    glass: [`rgba(255,255,255,${op * 0.08})`, '12px 18px', br],
    solid: [rgba(c.bgColor, op), '12px 18px', br],
    gradient: [`linear-gradient(135deg,${rgba(c.bgColor, op)},${rgba(c.bgColor2, op)})`, '12px 18px', br],
  }[c.bgStyle] || ['transparent', '0', '0'];
  Object.assign(el.style, { background: bg[0], padding: bg[1], borderRadius: bg[2], border: c.showBorder ? `1px solid ${rgba(c.heartColor, 0.4)}` : 'none' });
}
