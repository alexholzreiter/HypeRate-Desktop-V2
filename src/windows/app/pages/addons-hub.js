// The Addons page: the user's own addons and the gallery of shared ones (Discover), behind
// one bar that is always at the top: search, the switch between the two, and "New addon".
// Chips under it filter by state (mine) or by what an addon is and needs (Discover), each with
// its count. An addon's own page and the addon dialogs (create, approve, AI prompt, guide)
// open from here too.

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { addons as ad, gallery as gal, refreshAddonState } from '../lib/state.js';
import { addonPage, addonOverlays, addonState, addonTile, guideButton } from './addons.js';
import { ensureGallery, galleryCard, galleryFacts, sortGallery } from './gallery.js';

export const id = 'addons';

const rerender = () => window.dispatchEvent(new Event('hr-rerender'));
let detail = null;        // an addon's folder: its own page
let tab = 'mine';         // 'mine' | 'discover'
let query = '';
let chip = { mine: 'all', discover: 'all' };

// The menu entry clicked again: back to the list
export function reset() { detail = null; refreshAddonState(true); }
export function open(folder) { detail = folder; tab = 'mine'; }
const openAddon = (folder) => { detail = folder; refreshAddonState(true); rerender(); };
// the page coming into view (from another menu entry): what HypeRate decided meanwhile
export function shown() { refreshAddonState(true); }

// For the menu: how many addons wait for something (an approval, an update)
export function badge(s) {
  const waiting = (s.addons.addons || []).filter(item => ['warn'].includes(addonState(item, s.addons.master).tone)).length;
  const updates = (s.gallery.list || []).filter(a => galleryFacts(s, a).update).length;
  return s.addons.master ? waiting + updates : 0;
}

const norm = (text) => String(text || '').toLocaleLowerCase();
const matches = (fields) => !query.trim() || norm(fields.filter(Boolean).join(' ')).includes(norm(query.trim()));

// ── My addons ──
const MINE = {
  all: () => true,
  active: (item, st) => st.tone === 'ok',
  off: (item, st) => st.tone === 'off',
  approval: (item, st) => st.tone === 'warn',
  problem: (item, st) => st.tone === 'bad' || !!item.lastError,
  update: (item, st, f) => !!f?.update,
  gallery: (item, st, f, s) => !!s.gallery.installed[item.manifest?.id]?.gallery,
};
function mineList(s) {
  const byId = new Map((s.gallery.list || []).map(a => [a.addonId, a]));
  return (s.addons.addons || []).map(item => {
    const shared = byId.get(item.manifest?.id);
    return { item, st: addonState(item, s.addons.master), facts: shared ? galleryFacts(s, shared) : null };
  });
}

// ── Discover ──
const DISCOVER = {
  all: () => true,
  not_installed: (a, f) => !f.installed && !f.own,
  installed: (a, f) => f.installed,
  update: (a, f) => f.update,
  overlay: (a) => a.permissions.includes('overlay'),
  games: (a) => a.permissions.includes('gameMoments'),
  offline: (a) => !a.network.length,
};

export function render(s) {
  ensureGallery(s);
  if (detail) return [addonPage(s, detail, () => { detail = null; rerender(); }), addonOverlays(s, openAddon)];

  const mineAll = mineList(s);
  const mineFound = mineAll.filter(({ item }) => matches([item.manifest?.name, item.manifest?.description, item.manifest?.author, item.folder]));
  const galleryAll = s.gallery.list || [];
  const galleryFound = galleryAll.filter(a => matches([a.name, a.description, a.authorName, a.addonId]));

  return [h('div', { class: 'page' },
    // the bar: always at the top, however long the list
    h('div', { class: 'addons-bar' },
      h('div', { class: 'row between', style: { gap: '14px', flexWrap: 'wrap', alignItems: 'center' } },
        h('h1', { class: 'h1', style: { margin: 0 } }, t('nav_addons')),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          h('label', { class: 'addons-search' },
            icon('search', 16),
            h('input', { class: 'field', type: 'search', value: query, placeholder: t('addons_hub_search'), 'aria-label': t('addons_hub_search'), 'data-live-filter': '',
              oninput: e => { query = e.target.value; rerender(); },
              onkeydown: e => { if (e.key === 'Escape') { query = ''; e.target.value = ''; rerender(); } } })),
          guideButton(),
          h('button', { class: 'btn primary', onclick: () => ad.plus() }, '+ ' + t('addons_hub_new')))),
      h('p', { class: 'sub', style: { margin: '-6px 0 0' } }, t('addons_hub_sub')),
      h('div', { class: 'row', style: { gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
        h('div', { class: 'addons-switch', role: 'tablist', 'aria-label': t('nav_addons') },
          [['mine', mineAll.length], ['discover', galleryAll.length]].map(([key, n]) =>
            h('button', { role: 'tab', 'aria-selected': String(tab === key), class: tab === key ? 'on' : '', onclick: () => { tab = key; rerender(); } },
              t('addons_hub_' + key), h('span', { class: 'count' }, String(n))))),
        tab === 'discover' ? h('div', { class: 'row', style: { gap: '6px', marginLeft: 'auto' } },
          ['popular', 'new'].map(by => h('button', { class: 'btn small' + (s.gallery.sort === by ? ' primary' : ''), 'aria-pressed': String(s.gallery.sort === by), onclick: () => gal.sort(by) }, t('gallery_sort_' + by)))) : null),
      tab === 'mine' ? chips('mine', MINE, (test) => mineFound.filter(x => test(x.item, x.st, x.facts, s)).length)
        : chips('discover', DISCOVER, (test) => galleryFound.filter(a => test(a, galleryFacts(s, a))).length)),

    !s.addons.master ? h('div', { class: 'note warn row between', style: { gap: '14px', flexWrap: 'wrap' } },
      h('span', {}, t('addons_master_off_text')),
      h('button', { class: 'btn small primary', onclick: () => ad.dialog({ type: 'allow', then: 'stay' }) }, t('addons_allow_yes'))) : null,

    tab === 'mine' ? mineView(s, mineAll, mineFound, galleryFound.length) : discoverView(s, galleryFound, mineFound.length)),
    addonOverlays(s, openAddon)];
}

// One row of chips, each with what it would show; a chip with nothing in it is left out
// (except the one that is on, so it can be switched off)
function chips(which, tests, count) {
  return h('div', { class: 'addons-chips', role: 'group', 'aria-label': t('addons_hub_filter') },
    Object.entries(tests).map(([key, test]) => {
      const n = count(test);
      if (!n && key !== 'all' && chip[which] !== key) return null;
      const on = chip[which] === key;
      return h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => { chip[which] = on && key !== 'all' ? 'all' : key; rerender(); } },
        t('addons_chip_' + key), h('span', { class: 'count' }, String(n)));
    }));
}

function mineView(s, all, found, inGallery) {
  if (!all.length) return h('div', { class: 'card stack', style: { alignItems: 'center', textAlign: 'center', padding: '36px 24px' } },
    h('span', { class: 'icon-tile' }, icon('puzzle')),
    h('h2', { class: 'h1', style: { fontSize: '20px', margin: 0 } }, t('addons_hub_empty_title')),
    h('p', { class: 'muted', style: { margin: 0, maxWidth: '460px', lineHeight: 1.6 } }, t('addons_hub_empty_text')),
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn primary', onclick: () => ad.plus() }, t('addons_hub_new')),
      h('button', { class: 'btn', onclick: () => { tab = 'discover'; rerender(); } }, t('addons_hub_discover'))));
  const shown = found.filter(x => MINE[chip.mine](x.item, x.st, x.facts, s));
  if (!shown.length) return nothing(inGallery, 'discover');
  return h('div', { class: 'integ-grid' }, shown.map(({ item, facts }) => addonTile(s, item, openAddon,
    facts?.update ? h('span', { class: 'pill warn', style: { alignSelf: 'flex-start' } }, t('addons_chip_update')) : null)));
}

function discoverView(s, found, inMine) {
  const g = s.gallery;
  if (g.list === undefined) return h('p', { class: 'muted' }, t('gallery_loading'));
  if (g.failed && !found.length) return h('div', { class: 'note warn row between', style: { gap: '12px', flexWrap: 'wrap' } },
    h('span', {}, t('gallery_failed')), h('button', { class: 'btn small', onclick: () => gal.load() }, t('gallery_retry')));
  if (!(g.list || []).length) return h('div', { class: 'card', style: { textAlign: 'center' } }, h('p', { class: 'muted', style: { margin: 0 } }, t('gallery_empty')));
  const shown = sortGallery(found.filter(a => DISCOVER[chip.discover](a, galleryFacts(s, a))), g.sort);
  if (!shown.length) return nothing(inMine, 'mine');
  return h('div', { class: 'gallery-grid' }, shown.map(a => galleryCard(s, a, openAddon)));
}

// Nothing for this search or chip: say so, and point at the other side if it has something
function nothing(elsewhere, other) {
  return h('div', { class: 'card stack', style: { alignItems: 'center', textAlign: 'center' } },
    h('p', { class: 'muted', style: { margin: 0 } }, t(query.trim() ? 'addons_hub_none_search' : 'addons_hub_none_chip', { q: query.trim() })),
    query.trim() && elsewhere ? h('button', { class: 'btn small', onclick: () => { tab = other; chip[other] = 'all'; rerender(); } },
      t('addons_hub_elsewhere_' + other, { n: elsewhere })) : null,
    h('a', { class: 'small', onclick: () => { query = ''; chip = { mine: 'all', discover: 'all' }; rerender(); } }, t('addons_hub_clear')));
}

// "/" anywhere (not in a field) jumps to the search
window.addEventListener('keydown', e => {
  if (e.key !== '/' || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const field = document.querySelector('.addons-search input');
  if (field) { e.preventDefault(); field.focus(); }
});
