// Discover (on the Addons page, pages/addons-hub.js): addons other people shared, reviewed by HypeRate. Install puts exactly the
// approved version into the addons folder (it then asks for approval like any other); a
// newer approved version shows as an update. Addons installed from here can be rated with
// stars, by dragging across them: from two stars the card starts to shake, at five its
// outline glows, and letting go sends the rating and calms it down again.

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { addons as ad, gallery } from '../lib/state.js';

const rerender = () => window.dispatchEvent(new Event('hr-rerender'));
const initials = (name) => name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const LINKS = { x: 'X', youtube: 'YouTube', twitch: 'Twitch', website: 'Website' };

// The rating being dragged: kept here so a redraw in between (the heart rate redraws every
// second) keeps the stars and the shaking where the pointer is
let drag = null;   // { addonId, stars }

// Loaded once when first needed (the Addons page, or its badge)
export function ensureGallery(s) {
  if (s.gallery.list === null) { s.gallery.list = undefined; queueMicrotask(() => gallery.load()); }
}

// What a shared addon is to this computer, for the filters
export function galleryFacts(s, a) {
  const mine = s.gallery.installed[a.addonId];
  return { installed: !!mine?.gallery, own: !!mine && !mine.gallery, update: !!mine?.gallery && mine.version !== a.version };
}

// Popular: a few votes do not top many. New: the latest approval first.
export function sortGallery(list, by) {
  const score = (a) => (a.rating.average * a.rating.count + 3.5 * 3) / (a.rating.count + 3);
  return [...list].sort(by === 'new' ? (a, b) => String(b.approvedAt).localeCompare(String(a.approvedAt)) : (a, b) => score(b) - score(a));
}

export const galleryCard = (s, a, openAddon) => card(s, a, openAddon);

// The average, and for an addon installed from here your own stars (on an installed addon's page)
export function ratingBlock(s, a) {
  const f = galleryFacts(s, a);
  const stars = drag?.addonId === a.addonId ? drag.stars : 0;
  return [average(a.rating), f.installed && !a.own ? rater(a, stars) : null];
}

function card(s, a, openAddon) {
  const g = s.gallery;
  const mine = g.installed[a.addonId];
  const fromHere = !!mine?.gallery;
  const update = fromHere && mine.version !== a.version;
  const busy = g.busy[a.addonId];
  const error = g.error[a.addonId];
  const stars = drag?.addonId === a.addonId ? drag.stars : 0;
  const open = async () => {
    const folder = mine && !update ? mine.folder : await gallery.install(a.addonId);
    if (!folder) return;
    openAddon(folder);
    // freshly installed: ask for approval right away
    const item = s.addons.addons.find(x => x.folder === folder);
    if (item && !item.approved) ad.setEnabled(item, true);
  };
  return h('div', { class: 'card stack gallery-card' + (stars >= 5 ? ' glow' : ''), 'data-shake': stars >= 2 ? String(stars) : null },
    h('div', { class: 'row', style: { gap: '14px', alignItems: 'flex-start' } },
      h('span', { class: 'integ-mono addon-mono' }, initials(a.name)),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('p', { style: { margin: 0, fontWeight: 600, fontSize: '17px' } }, a.name, h('span', { class: 'small muted', style: { fontWeight: 400 } }, '  v' + a.version)),
        h('p', { class: 'small muted', style: { margin: '2px 0 0' } }, t('gallery_by', { name: a.authorName }),
          Object.entries(a.links || {}).map(([k, url]) => [' · ', h('a', { onclick: () => window.electronAPI.openExternal(url) }, LINKS[k] || k)])))),
    a.description ? h('p', { class: 'small', style: { margin: 0, lineHeight: 1.55 } }, a.description) : null,
    average(a.rating),
    h('p', { class: 'small muted', style: { margin: 0 } }, permissions(a)),
    fromHere && !a.own ? rater(a, stars) : null,
    a.own ? h('p', { class: 'small muted', style: { margin: 0 } }, t('gallery_own')) : null,
    error ? h('p', { class: 'small warn-text', role: 'alert', style: { margin: 0 } }, t('gallery_error_' + error)) : null,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginTop: 'auto' } },
      mine && !fromHere ? h('span', { class: 'small muted' }, t('gallery_have_own'))
        : h('button', { class: 'btn small' + (mine && !update ? '' : ' primary'), disabled: busy ? true : null, onclick: open },
          busy === 'install' ? t('gallery_installing') : update ? t('gallery_update', { version: a.version }) : mine ? t('gallery_open') : t('gallery_install')),
      h('a', { class: 'small', style: { alignSelf: 'center' }, onclick: () => window.electronAPI.openExternal(codeUrl(a)) }, t('gallery_code') + ' ↗')));
}

const codeUrl = (a) => `https://github.com/${a.repoOwner}/${a.repoName}/tree/${a.commitSha}${a.path ? '/' + a.path : ''}`;

function permissions(a) {
  const parts = a.permissions.map(p => t('addon_perm_short_' + p));
  if (a.network.length) parts.push(t('addons_net_short', { hosts: a.network.join(', ') }));
  return t('addons_may') + ' ' + (parts.length ? parts.join(' · ') : t('addons_no_perms'));
}

// The average, as five stars filled to the tenth
function average(r) {
  const pct = Math.round((r.average / 5) * 100);
  return h('div', { class: 'row small', style: { gap: '8px' }, 'aria-label': r.count ? t('gallery_rating', { avg: r.average.toFixed(1), n: r.count }) : t('gallery_unrated') },
    h('span', { class: 'stars-avg', style: { '--fill': pct + '%' } },
      h('span', { class: 'stars-row' }, [0, 1, 2, 3, 4].map(() => icon('star', 16))),
      h('span', { class: 'stars-row on' }, [0, 1, 2, 3, 4].map(() => icon('star', 16)))),
    h('span', { class: 'muted' }, r.count ? `${r.average.toFixed(1)} (${r.count})` : t('gallery_unrated')));
}

// Your own rating: drag across the stars (or click one, or use the arrow keys)
function rater(a, dragging) {
  const shown = dragging || a.myRating || 0;
  const at = (e, el) => {
    const box = el.getBoundingClientRect();
    return Math.max(1, Math.min(5, Math.ceil(((e.clientX - box.left) / box.width) * 5)));
  };
  // during the drag only the DOM is touched; a redraw would bring the same from `drag`
  const show = (el, n) => {
    drag = { addonId: a.addonId, stars: n };
    el.setAttribute('aria-valuenow', String(n));
    el.querySelectorAll('.star').forEach((star, i) => star.classList.toggle('on', i < n));
    const cardEl = el.closest('.gallery-card');
    if (!cardEl) return;
    if (n >= 2) cardEl.dataset.shake = String(n); else delete cardEl.dataset.shake;
    cardEl.classList.toggle('glow', n >= 5);
  };
  const finish = (el) => {
    if (!drag) return;
    const n = drag.stars;
    drag = null;
    const cardEl = el.closest('.gallery-card');
    if (cardEl) { delete cardEl.dataset.shake; cardEl.classList.remove('glow'); }
    gallery.rate(a.addonId, n);
  };
  return h('div', { class: 'row small', style: { gap: '10px', flexWrap: 'wrap' } },
    h('span', { class: 'muted' }, t(a.myRating ? 'gallery_your_rating' : 'gallery_rate')),
    h('div', {
      class: 'stars-rate', role: 'slider', tabindex: 0, 'aria-label': t('gallery_rate'),
      'aria-valuemin': 1, 'aria-valuemax': 5, 'aria-valuenow': shown || null,
      onpointerdown: e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); show(e.currentTarget, at(e, e.currentTarget)); },
      onpointermove: e => { if (drag?.addonId === a.addonId) show(e.currentTarget, at(e, e.currentTarget)); },
      onpointerup: e => finish(e.currentTarget),
      onpointercancel: e => { drag = null; const c = e.currentTarget.closest('.gallery-card'); delete c.dataset.shake; c.classList.remove('glow'); rerender(); },
      onkeydown: e => {
        const n = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!n) return;
        e.preventDefault();
        gallery.rate(a.addonId, Math.max(1, Math.min(5, (a.myRating || 0) + n)));
      },
    }, [0, 1, 2, 3, 4].map(i => h('span', { class: 'star' + (i < shown ? ' on' : '') }, icon('star', 26)))));
}
