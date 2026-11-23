// Tiny helpers to build the UI without a framework.
//
//   h('div', { class: 'card', onclick: fn }, 'text', child, [more, children])
//
// Text is always set as text, never as HTML, so values from the strap, the cloud or settings
// cannot inject markup. The only HTML that goes in comes from the translation files, through
// `html()`, which the app ships itself.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);   // custom properties need setProperty
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith('on') && typeof value === 'function') listen(el, key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

// Handlers live in a table on the element behind one listener per event type, so morph() can
// hand an existing element the handlers of its freshly rendered twin.
function dispatch(e) { e.currentTarget.__on?.[e.type]?.(e); }
function listen(el, type, fn) {
  if (!el.__on) el.__on = {};
  if (!(type in el.__on)) el.addEventListener(type, dispatch);
  el.__on[type] = fn;
}

// Brings `live` (what is on screen) to look like `next` (a fresh render) and keeps every element
// that is still the same kind. Rebuilding everything once a second, with each heart rate, made
// clicks get lost (mouse down on one button, up on its replacement) and restarted every
// animation, which showed as a faint flicker in time with the pulse.
export function morph(live, next) {
  if (live.nodeType !== next.nodeType || live.nodeName !== next.nodeName || live.namespaceURI !== next.namespaceURI) {
    live.replaceWith(next);
    return next;
  }
  if (live.nodeType === Node.TEXT_NODE || live.nodeType === Node.COMMENT_NODE) {
    if (live.nodeValue !== next.nodeValue) live.nodeValue = next.nodeValue;
    return live;
  }
  if (live.nodeType === Node.ELEMENT_NODE) {
    syncAttributes(live, next);
    // handlers: the fresh render's closures see the current state
    if (live.__on) for (const type of Object.keys(live.__on)) if (!next.__on || !(type in next.__on)) live.__on[type] = undefined;
    if (next.__on) for (const [type, fn] of Object.entries(next.__on)) listen(live, type, fn);
  }
  const a = [...live.childNodes], b = [...next.childNodes];
  for (let i = 0; i < b.length; i++) {
    if (i < a.length) morph(a[i], b[i]);
    else live.appendChild(b[i]);
  }
  for (let i = b.length; i < a.length; i++) a[i].remove();
  return live;
}

function syncAttributes(live, next) {
  for (const { name } of [...live.attributes]) if (!next.hasAttribute(name)) live.removeAttribute(name);
  for (const { name, value } of [...next.attributes]) if (live.getAttribute(name) !== value) live.setAttribute(name, value);
  // Form state lives in properties; leave a field alone while someone is in it
  if (live === document.activeElement) return;
  if ('value' in next && live.tagName !== 'OPTION' && live.tagName !== 'BUTTON' && live.value !== next.value) live.value = next.value;
  if ('checked' in next && live.checked !== next.checked) live.checked = next.checked;
  if (live.tagName === 'OPTION' && live.selected !== next.hasAttribute('selected')) live.selected = next.hasAttribute('selected');
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

// Markup from the app's own translation files (links, <strong>, <code>)
export function html(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup;
  return template.content;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) el.setAttribute(key, value);
  for (const child of children.flat(Infinity)) if (child) el.append(child);
  return el;
}

// Stroke icons used across the window (24×24 grid)
const ICONS = {
  live: 'M3 12h4l2-6 4 12 2-6h6',
  sessions: 'M5 20V11M11 20V5M17 20v-6M3 20h18',
  overlay: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  source: 'M7 7l10 10-5 4V3l5 4L7 17',
  games: 'M7.5 7h9a4.5 4.5 0 0 1 4.4 5.4l-.9 4.4a2.2 2.2 0 0 1-3.8 1L14.6 16H9.4l-1.6 1.8a2.2 2.2 0 0 1-3.8-1l-.9-4.4A4.5 4.5 0 0 1 7.5 7zM8 10.5v3M6.5 12h3',
  integrations: 'M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4',
  cloud: 'M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18H7z',
  collapse: 'M4 5h16v14H4zM9 5v14M15.5 10l-2 2 2 2',
  expand: 'M4 5h16v14H4zM9 5v14M13.5 10l2 2-2 2',
  minimize: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
};

export function icon(name, size = 20) {
  return svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: ICONS[name] }));
}

// The HypeRate logo without its dark app-icon tile: the red heart and the white pulse line,
// redrawn from assets/icon.png so it stays sharp at any size
export function logo({ size = 24, className } = {}) {
  return svg('svg', { viewBox: '150 215 724 610', width: size, height: Math.round(size * 610 / 724), class: className, role: 'img', 'aria-label': 'HypeRate' },
    svg('path', { d: 'M507 812 L238 540 C158 460 172 326 268 262 C350 208 452 228 507 290 C562 228 664 208 746 262 C842 326 856 460 776 540 Z', fill: '#e2203f' }),
    svg('path', { d: 'M167 471 H281 L438 336 V640 L528 527 C548 500 590 506 590 540 V606 L744 471 H857', fill: 'none', stroke: '#fff', 'stroke-width': 31, 'stroke-linejoin': 'miter', 'stroke-miterlimit': 10 }));
}

export const HEART_PATH ='M12 20.5C7 16.8 3 13.4 3 9.3 3 6.6 5.1 4.5 7.7 4.5c1.7 0 3.3.9 4.3 2.3 1-1.4 2.6-2.3 4.3-2.3 2.6 0 4.7 2.1 4.7 4.8 0 4.1-4 7.5-9 11.2z';

export function heart({ size = 24, fill = 'url(#hr-gradient)', stroke, className } = {}) {
  return svg('svg', { viewBox: '0 0 24 24', width: size, height: size, class: className, 'aria-hidden': 'true' },
    svg('path', { d: HEART_PATH, fill: stroke ? 'none' : fill, stroke, 'stroke-width': stroke ? 1.5 : undefined }));
}
