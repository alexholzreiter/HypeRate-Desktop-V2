// The Addons page, in three parts with one job each:
//   Installed      addons from the gallery, used like apps: on/off, settings, update, rate,
//                  remove; never edited in the app
//   Discover       the gallery: what others built, reviewed by HypeRate, to install
//   Built by you   the user's own addons: everything to make and change them, and to share
// One bar stays at the top: search (in the open part), the switch, and in "Built by you" the
// "New addon" button. Chips filter, each with its count. An addon's own page and the addon
// dialogs (create, approve, AI prompt, guide) open from here too.

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { addons as ad, gallery as gal, refreshAddonState } from '../lib/state.js';
import { addonPage, addonOverlays, addonState, addonTile, guideButton } from './addons.js';
import { ensureGallery, galleryCard, galleryFacts, sortGallery } from './gallery.js';

export const id = 'addons';

const rerender = () => window.dispatchEvent(new Event('hr-rerender'));
let detail = null;        // an addon's folder: its own page
let tab = null;           // 'installed' | 'discover' | 'own'; chosen on first view
let query = '';
let chip = { installed: 'all', discover: 'all', own: 'all' };

// The menu entry clicked again: back to the list
export function reset() { detail = null; refreshAddonState(true); }
export function open(folder) { detail = folder; }
const openAddon = (folder) => { detail = folder; refreshAddonState(true); rerender(); };
// the page coming into view (from another menu entry): what HypeRate decided meanwhile
export function shown() { refreshAddonState(true); }

const isInstalled = (item) => item.fromGallery === true;
const sharedOf = (s, item) => (s.gallery.list || []).find(a => a.addonId === item.manifest?.id);

// For the menu: updates for installed addons, and addons waiting for the user's OK
export function badge(s) {
  if (!s.addons.master) return 0;
  const items = s.addons.addons || [];
  const updates = items.filter(item => { const a = sharedOf(s, item); return isInstalled(item) && a && galleryFacts(s, a).update; }).length;
  const waiting = items.filter(item => addonState(item, s.addons.master).tone === 'warn').length;
  return updates + waiting;
}

const norm = (text) => String(text || '').toLocaleLowerCase();
const matches = (fields) => !query.trim() || norm(fields.filter(Boolean).join(' ')).includes(norm(query.trim()));
const itemFields = (item) => [item.manifest?.name, item.manifest?.description, item.manifest?.author, item.folder];

const CHIPS = {
  installed: {
    all: () => true,
    active: (x) => x.st.tone === 'ok',
    off: (x) => x.st.tone !== 'ok',
    update: (x) => !!x.facts?.update,
  },
  discover: {
    all: () => true,
    overlay: (a) => a.permissions.includes('overlay'),
    games: (a) => a.permissions.includes('gameMoments'),
    offline: (a) => !a.network.length,
  },
  own: {
    all: () => true,
    active: (x) => x.st.tone === 'ok',
    off: (x) => x.st.tone === 'off',
    problem: (x) => x.st.tone === 'bad' || !!x.item.lastError,
    shared: (x, s) => (s.addons.shared || []).some(sh => sh.addonId === x.item.manifest?.id && sh.status === 'APPROVED'),
  },
};

export function render(s) {
  ensureGallery(s);
  if (detail) return [addonPage(s, detail, () => { detail = null; rerender(); }), addonOverlays(s, openAddon)];

  const rows = (s.addons.addons || []).map(item => {
    const shared = sharedOf(s, item);
    return { item, st: addonState(item, s.addons.master), facts: shared ? galleryFacts(s, shared) : null };
  });
  const lists = {
    installed: rows.filter(x => isInstalled(x.item)),
    own: rows.filter(x => !isInstalled(x.item)),
    discover: s.gallery.list || [],
  };
  // Opens with what the user has: installed addons, else the gallery
  if (!tab) tab = lists.installed.length ? 'installed' : 'discover';

  const found = {
    installed: lists.installed.filter(x => matches(itemFields(x.item))),
    own: lists.own.filter(x => matches(itemFields(x.item))),
    discover: lists.discover.filter(a => matches([a.name, a.description, a.authorName, a.addonId])),
  };
  const shownIn = (key) => found[key].filter(x => CHIPS[key][chip[key]](x, s));

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
          tab === 'own' ? h('button', { class: 'btn primary', onclick: () => ad.plus() }, '+ ' + t('addons_hub_new')) : null)),
      h('p', { class: 'sub', style: { margin: '-6px 0 0' } }, t('addons_hub_sub_' + tab)),
      h('div', { class: 'row', style: { gap: '12px', flexWrap: 'wrap', alignItems: 'center' } },
        h('div', { class: 'addons-switch', role: 'tablist', 'aria-label': t('nav_addons') },
          ['installed', 'discover', 'own'].map(key =>
            h('button', { role: 'tab', 'aria-selected': String(tab === key), class: tab === key ? 'on' : '', onclick: () => { tab = key; rerender(); } },
              t('addons_hub_' + key), h('span', { class: 'count' }, String(lists[key].length))))),
        tab === 'discover' ? h('div', { class: 'row', style: { gap: '6px', marginLeft: 'auto' } },
          ['popular', 'new'].map(by => h('button', { class: 'btn small' + (s.gallery.sort === by ? ' primary' : ''), 'aria-pressed': String(s.gallery.sort === by), onclick: () => gal.sort(by) }, t('gallery_sort_' + by)))) : null),
      lists[tab].length ? chips(tab, (test) => found[tab].filter(x => test(x, s)).length) : null),

    !s.addons.master ? h('div', { class: 'note warn row between', style: { gap: '14px', flexWrap: 'wrap' } },
      h('span', {}, t('addons_master_off_text')),
      h('button', { class: 'btn small primary', onclick: () => ad.dialog({ type: 'allow', then: 'stay' }) }, t('addons_allow_yes'))) : null,

    tab === 'discover' ? discoverView(s, shownIn('discover'), found)
      : itemsView(s, tab, lists[tab], shownIn(tab), found)),
    addonOverlays(s, openAddon)];
}

// One row of chips, each with what it would show; a chip with nothing in it is left out
// (except the one that is on, so it can be switched off)
function chips(which, count) {
  return h('div', { class: 'addons-chips', role: 'group', 'aria-label': t('addons_hub_filter') },
    Object.entries(CHIPS[which]).map(([key, test]) => {
      const n = count(test);
      if (!n && key !== 'all' && chip[which] !== key) return null;
      const on = chip[which] === key;
      return h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => { chip[which] = on && key !== 'all' ? 'all' : key; rerender(); } },
        t('addons_chip_' + key), h('span', { class: 'count' }, String(n)));
    }));
}

// Installed or built by you: tiles
function itemsView(s, which, all, shown, found) {
  if (!all.length) return empty(which);
  if (!shown.length) return nothing(which, found);
  return h('div', { class: 'integ-grid' }, shown.map(({ item, facts }) => addonTile(s, item, openAddon,
    facts?.update && which === 'installed' ? h('span', { class: 'pill warn', style: { alignSelf: 'flex-start' } }, t('addons_chip_update')) : null)));
}

function discoverView(s, shown, found) {
  const g = s.gallery;
  if (g.list === undefined) return h('p', { class: 'muted' }, t('gallery_loading'));
  if (g.failed && !(g.list || []).length) return h('div', { class: 'note warn row between', style: { gap: '12px', flexWrap: 'wrap' } },
    h('span', {}, t('gallery_failed')), h('button', { class: 'btn small', onclick: () => gal.load() }, t('gallery_retry')));
  if (!(g.list || []).length) return empty('discover');
  if (!shown.length) return nothing('discover', found);
  return h('div', { class: 'gallery-grid' }, sortGallery(shown, g.sort).map(a => galleryCard(s, a, openAddon)));
}

// Nothing in this part yet: what it is for, and the way to fill it
function empty(which) {
  const action = {
    installed: h('button', { class: 'btn primary', onclick: () => { tab = 'discover'; rerender(); } }, t('addons_hub_discover')),
    discover: null,
    own: h('button', { class: 'btn primary', onclick: () => ad.plus() }, t('addons_hub_new')),
  }[which];
  return h('div', { class: 'card stack', style: { alignItems: 'center', textAlign: 'center', padding: '36px 24px' } },
    h('span', { class: 'icon-tile' }, icon(which === 'own' ? 'pen' : which === 'installed' ? 'puzzle' : 'star')),
    h('h2', { class: 'h1', style: { fontSize: '20px', margin: 0 } }, t('addons_hub_empty_title_' + which)),
    h('p', { class: 'muted', style: { margin: 0, maxWidth: '460px', lineHeight: 1.6 } }, t('addons_hub_empty_text_' + which)),
    action);
}

// Nothing for this search or chip: say so, and point at another part if it has something
function nothing(which, found) {
  const q = query.trim();
  const elsewhere = q ? ['installed', 'discover', 'own'].filter(key => key !== which && found[key].length) : [];
  return h('div', { class: 'card stack', style: { alignItems: 'center', textAlign: 'center' } },
    h('p', { class: 'muted', style: { margin: 0 } }, t(q ? 'addons_hub_none_search' : 'addons_hub_none_chip', { q })),
    elsewhere.length ? h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } },
      elsewhere.map(key => h('button', { class: 'btn small', onclick: () => { tab = key; chip[key] = 'all'; rerender(); } },
        t('addons_hub_elsewhere', { n: found[key].length, where: t('addons_hub_' + key) })))) : null,
    h('a', { class: 'small', onclick: () => { query = ''; chip = { installed: 'all', discover: 'all', own: 'all' }; rerender(); } }, t('addons_hub_clear')));
}

// "/" anywhere (not in a field) jumps to the search
window.addEventListener('keydown', e => {
  if (e.key !== '/' || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const field = document.querySelector('.addons-search input');
  if (field) { e.preventDefault(); field.focus(); }
});
