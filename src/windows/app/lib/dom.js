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
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
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
  minimize: 'M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
};

export function icon(name, size = 20) {
  return svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    svg('path', { d: ICONS[name] }));
}

export const HEART_PATH = 'M12 20.5C7 16.8 3 13.4 3 9.3 3 6.6 5.1 4.5 7.7 4.5c1.7 0 3.3.9 4.3 2.3 1-1.4 2.6-2.3 4.3-2.3 2.6 0 4.7 2.1 4.7 4.8 0 4.1-4 7.5-9 11.2z';

export function heart({ size = 24, fill = 'url(#hr-gradient)', stroke, className } = {}) {
  return svg('svg', { viewBox: '0 0 24 24', width: size, height: size, class: className, 'aria-hidden': 'true' },
    svg('path', { d: HEART_PATH, fill: stroke ? 'none' : fill, stroke, 'stroke-width': stroke ? 1.5 : undefined }));
}
