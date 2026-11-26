// Your own addons, as part of Integrations: one tile per addon next to Discord & co., a + tile
// to make a new one, a page per addon, the dialogs (allow, create, approve, AI prompt) and a
// step-by-step guide. The main process side is src/addons.

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { addons as ad, showOverlay } from '../lib/state.js';
import { FEEDBACK_URL } from './settings.js';

// The guide for writing addons, with examples to download
export const ADDONS_DOCS_URL = 'https://github.com/HypeRate/HypeRate-Desktop-Addons';
const openDocs = () => window.electronAPI.openExternal(ADDONS_DOCS_URL);

const toggle = (on, onChange, label) =>
  h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
const initials = (item) => (item.manifest?.name || item.folder).replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '+';
const byFolder = (s, folder) => (s.addons.addons || []).find(a => a.folder === folder);
const changedSinceApproval = (item) => !!(item.manifest && item.granted && !item.approved);

// master: own addons allowed at all (Settings › Privacy); while off, addons are shown but never run
function status(item, master = true) {
  if (!master) return { tone: 'off', text: t('addons_master_off') };
  if (item.error) return { tone: 'bad', text: t('addons_error') };
  if (changedSinceApproval(item)) return { tone: 'warn', text: t('addons_changed') };
  if (item.running) return { tone: 'ok', text: t('addons_running') };
  if (item.enabled && !item.approved) return { tone: 'warn', text: t('addons_needs_ok') };
  return { tone: 'off', text: t('off') };
}
const dotFor = tone => ({ ok: 'live', warn: 'warn', bad: 'bad' }[tone] || '');

// ── Tiles ──
export function addonTiles(s, openAddon, where) {
  if (where !== 'after') return null;
  // Shown also while own addons are off, so they do not seem gone; they just do not run
  const items = s.addons.addons || [];
  return [
    items.map(item => {
      const st = status(item, s.addons.master);
      return h('button', { class: 'card integ-card addon', onclick: () => openAddon(item.folder) },
        h('div', { class: 'row between' },
          h('span', { class: 'integ-mono addon-mono' }, initials(item)),
          h('span', { class: 'pill tile-pill ' + st.tone, title: st.text }, h('span', { class: 'dot ' + dotFor(st.tone) }), h('span', { class: 'pill-text' }, st.text))),
        h('div', { class: 'stack', style: { gap: '4px' } },
          h('p', { style: { margin: 0, fontWeight: 600, fontSize: '17px' } }, item.manifest?.name || item.folder),
          h('p', { class: 'small muted', style: { margin: 0 } }, item.manifest?.description || item.error || t('addons_own_tile'))),
        h('span', { class: 'small', style: { color: 'var(--accent-text)', fontWeight: 600 } }, t('open') + ' →'));
    }),
    h('button', { class: 'card integ-card addon-plus', 'aria-label': t('addons_plus'), onclick: () => ad.plus() },
      h('span', { class: 'addon-plus-sign' }, '+'),
      h('p', { style: { margin: 0, fontWeight: 600, fontSize: '17px' } }, t('addons_plus')),
      h('p', { class: 'small muted', style: { margin: 0, textAlign: 'center' } }, t('addons_plus_sub'))),
  ];
}

export function guideButton() {
  return h('button', { class: 'btn small guide-btn', title: t('guide_open'), 'aria-label': t('guide_open'), onclick: () => ad.openGuide(0) }, '?  ' + t('guide_short'));
}

// ── One addon's page ──
export function addonPage(s, folder, back) {
  const item = byFolder(s, folder);
  if (!item) { queueMicrotask(back); return null; }
  const m = item.manifest;
  const st = status(item, s.addons.master);
  const id = m?.id;
  if (id && !s.addons.logs[id]) queueMicrotask(() => ad.loadLogs(id));
  if (s.addons.sentWishes === null) { s.addons.sentWishes = []; queueMicrotask(() => ad.loadWishes()); }
  if (s.addons.shared === null) { s.addons.shared = []; queueMicrotask(() => ad.loadShared()); }
  const logs = (id && s.addons.logs[id]) || [];
  return h('div', { class: 'page' },
    h('div', { class: 'card integ-hero addon' },
      h('div', { class: 'row between' },
        h('a', { class: 'small', onclick: back }, '← ' + t('nav_integrations')),
        guideButton()),
      h('div', { class: 'row', style: { gap: '18px', flexWrap: 'wrap' } },
        h('span', { class: 'integ-mono big addon-mono' }, initials(item)),
        h('div', { style: { flex: 1, minWidth: '220px' } },
          h('h1', { class: 'h1' }, m?.name || item.folder),
          h('div', { class: 'row small', style: { gap: '8px', marginTop: '6px', flexWrap: 'wrap' }, role: 'status' },
            h('span', { class: 'dot ' + dotFor(st.tone) }), h('span', {}, st.text),
            m ? h('span', { class: 'muted' }, '· v' + m.version + (m.author ? ' · ' + m.author : '')) : null)),
        m && s.addons.master ? h('div', { class: 'row' }, h('span', {}, t('addons_switch')), toggle(item.enabled && item.approved, v => ad.setEnabled(item, v), t('addons_switch'))) : null),
      m?.description ? h('p', { class: 'muted', style: { margin: 0 } }, m.description) : null,
      m ? h('p', { class: 'small muted', style: { margin: 0 } }, permissionSummary(m)) : null),

    // Own addons are switched off as a whole: say so, and offer to allow them (the allow dialog explains)
    !s.addons.master ? h('div', { class: 'note warn row between', style: { gap: '14px', flexWrap: 'wrap' } },
      h('span', {}, t('addons_master_off_text')),
      h('button', { class: 'btn small primary', onclick: () => ad.dialog({ type: 'allow', then: 'stay' }) }, t('addons_allow_yes'))) : null,
    item.error ? errorCard(item, item.error) : null,
    s.addons.master && changedSinceApproval(item) ? h('div', { class: 'note warn row between', style: { gap: '14px', flexWrap: 'wrap' } },
      h('span', {}, t('addons_changed_text')),
      h('button', { class: 'btn small primary', onclick: () => ad.setEnabled(item, true) }, t('addons_review'))) : null,

    h('div', { class: 'split' },
      h('div', { class: 'stack', style: { gap: '18px', flex: '1.4 1 380px', minWidth: 0 } },
        item.running ? testCard(s, item) : null,
        m?.overlay ? overlayCard(s, item) : null,
        m?.settings?.length ? settingsCard(item) : null,
        !item.error && item.lastError ? errorCard(item, item.lastError) : null,
        item.limits?.length || item.wishes?.length ? limitsCard(s, item) : null,
        h('div', { class: 'card stack' },
          h('div', { class: 'row between' }, h('p', { class: 'label' }, t('addons_log')),
            item.running ? h('a', { class: 'small', onclick: () => ad.reload(id) }, t('addons_restart')) : null),
          logView(logs))),
      h('div', { class: 'stack', style: { gap: '18px', flex: '1 1 300px', minWidth: 0 } },
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('addons_edit')),
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_edit_text')),
        h('textarea', { class: 'field addon-ask', rows: 3, placeholder: t('addons_change_placeholder'), 'aria-label': t('addons_change_placeholder') }),
        h('button', { class: 'btn primary', onclick: e => {
          const wish = e.target.previousSibling.value.trim();
          ad.dialog({ type: 'prompt', kind: 'change', folder, dir: item.dir, task: wish });
        } }, t('addons_change_ai')),
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
          h('button', { class: 'btn small', onclick: () => ad.openEditor(folder) }, t('addons_open_editor')),
          h('button', { class: 'btn small', onclick: () => ad.showFolder(folder) }, t('addons_show_folder')),
          h('button', { class: 'btn small', onclick: openDocs }, t('addons_docs') + ' ↗')),
        h('hr', { class: 'divider' }),
        h('button', { class: 'btn small' + (s.addons.confirmRemove === folder ? ' danger' : ''), onclick: async () => { if (await ad.remove(folder)) back(); } },
          t(s.addons.confirmRemove === folder ? 'addons_remove_confirm' : 'addons_remove'))),
      m ? shareCard(s, item) : null)));
}

// Trying it out without waiting for a real moment: made-up values for this addon only (the
// main side plays them at the pace of a real source). Only what its permissions let it hear.
const HEART_TESTS = ['rise', 'fall', 'zones'];
const MOMENT_TESTS = ['boss', 'close', 'death', 'penta'];
let simTick = null;
function testCard(s, item) {
  const m = item.manifest, id = m.id, sim = item.simulating;
  const hears = (p) => m.permissions.includes(p);
  const kinds = [...(hears('heartRate') || hears('zones') ? HEART_TESTS : []), ...(hears('gameMoments') ? MOMENT_TESTS : [])];
  if (!kinds.length) return null;
  const left = sim ? Math.max(0, Math.ceil((sim.endsAt - Date.now()) / 1000)) : 0;
  // the seconds count down while a run goes on
  if (sim && !simTick) simTick = setTimeout(() => { simTick = null; window.dispatchEvent(new Event('hr-rerender')); }, 1000);
  return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('addons_test')),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_test_text')),
    m.overlay && !s.overlayOpen ? h('div', { class: 'note row between', style: { gap: '12px', flexWrap: 'wrap' } },
      h('span', { class: 'small' }, t('addons_test_overlay_closed')),
      h('button', { class: 'btn small', onclick: () => showOverlay() }, t('overlay_show'))) : null,
    h('div', { class: 'dev-buttons' },
      kinds.map(kind => h('button', { class: 'btn small' + (sim?.kind === kind ? ' primary' : ''), 'aria-pressed': sim?.kind === kind ? 'true' : null,
        onclick: () => ad.simulate(id, kind) }, t('addons_test_' + kind)))),
    sim ? h('div', { class: 'row between', role: 'status', style: { gap: '12px' } },
      h('span', { class: 'small' }, t('addons_test_running', { what: t('addons_test_' + sim.kind), s: left })),
      h('button', { class: 'btn small', onclick: () => ad.simulate(id, null) }, t('addons_test_stop'))) : null,
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_test_nothing'), ' ',
      h('a', { onclick: () => ad.dialog({ type: 'prompt', kind: 'change', folder: item.folder, dir: item.dir, task: t('addons_test_fix_task') }) }, t('addons_test_fix'))));
}

// ── Sharing: on GitHub, checked by HypeRate, then offered to others ──
function shareCard(s, item) {
  const m = item.manifest;
  const mine = (s.addons.shared || []).filter(x => x.addonId === m.id);
  const latest = mine[0];
  const approved = mine.find(x => x.status === 'APPROVED');
  const tone = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'bad' };
  // nothing waiting for a review: it can be sent (again, or as an update)
  const canSend = !latest || latest.status !== 'PENDING';
  return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('addons_share')),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_share_text')),
    latest ? h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' }, role: 'status' },
      h('span', { class: 'pill ' + tone[latest.status] }, t('addons_share_status_' + latest.status)),
      h('span', { class: 'small muted' }, 'v' + latest.version)) : null,
    latest?.status === 'REJECTED' && latest.reviewNote ? h('p', { class: 'small', style: { margin: 0 } }, t('addons_share_reason', { note: latest.reviewNote })) : null,
    approved ? h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_share_live', { version: approved.version })) : null,
    canSend ? h('button', { class: 'btn' + (latest ? '' : ' primary'), onclick: async () => {
      const saved = await ad.shareForm(m.id);
      ad.dialog({ type: 'share', folder: item.folder, dir: item.dir, name: m.name, version: m.version, update: !!approved, sentVersion: latest?.version, form: saved || {} });
    } }, t(approved ? 'addons_share_update' : 'addons_share_go')) : null);
}

const SHARE_LINK_KEYS = ['x', 'youtube', 'twitch', 'website'];
function shareDialog(d) {
  // what is typed goes straight into the dialog's state, so a redraw keeps it
  d.form ||= {};
  d.form.links ||= {};
  const trimmed = (v) => (v || '').trim();
  const form = () => ({
    repoUrl: trimmed(d.form.repoUrl), authorName: trimmed(d.form.authorName),
    links: Object.fromEntries(SHARE_LINK_KEYS.map(k => [k, trimmed(d.form.links[k])]).filter(([, v]) => v)),
  });
  const send = async () => {
    const f = form();
    const local = [];
    if (!/github\.com\/[^/\s]+\/[^/\s]+/i.test(f.repoUrl)) local.push('invalid_url');
    if (f.authorName.length < 2) local.push('no_name');
    if (Object.values(f.links).some(v => !/^https:\/\//i.test(v))) local.push('bad_link');
    if (!d.confirmed) local.push('not_confirmed');
    if (local.length) { ad.dialog({ ...d, form: f, problems: local }); return; }
    ad.dialog({ ...d, form: f, problems: null, sending: true });
    const res = await ad.share(d.folder, f);
    ad.dialog({ ...d, form: f, sending: false, sent: res.ok ? res.submission : null, problems: res.ok ? null : res.problems });
  };
  const close = () => ad.dialog(null);
  if (d.sent) return modal('addons-prompt addons-share', t('addons_share'), close,
    h('div', { class: 'guide-icon' }, icon('tick', 26)),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('addons_share_sent_title')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_share_sent', { version: d.sent.version || d.version })),
    d.sent.warnings?.includes('fingerprint_mismatch') ? h('div', { class: 'note warn' }, t('addons_share_mismatch')) : null,
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onclick: close }, t('addons_done'))));
  const f = d.form;
  // the hints from the last try go as soon as something is corrected
  const fixed = () => { if (d.problems) { d.problems = null; document.querySelector('.addons-share [role=alert]')?.remove(); } };
  const input = (cls, label, val, set, attrs = {}) => h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, label),
    h('input', { class: 'field ' + cls, value: val || '', oninput: e => { set(e.target.value); fixed(); }, ...attrs }));
  return modal('addons-prompt addons-share', t('addons_share'), close,
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t(d.update ? 'addons_share_update_title' : 'addons_share_title', { name: d.name, version: d.version })),
    h('div', { class: 'note stack', style: { gap: '8px' } },
      h('b', {}, t('addons_share_step1')),
      h('span', { class: 'small', style: { lineHeight: 1.6 } }, t(d.update ? 'addons_share_step1_update' : 'addons_share_step1_text')),
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn small', onclick: () => ad.dialog({ type: 'prompt', kind: d.update ? 'share_update' : 'share', folder: d.folder, dir: d.dir, task: '', back: d }) }, t('addons_share_ai')),
        h('button', { class: 'btn small', onclick: openDocs }, t('addons_docs') + ' ↗'))),
    h('b', {}, t('addons_share_step2')),
    input('share-repo', t('addons_share_repo'), f.repoUrl, v => { f.repoUrl = v; }, { placeholder: 'https://github.com/…', maxlength: 300 }),
    input('share-name', t('addons_share_name'), f.authorName, v => { f.authorName = v; }, { maxlength: 60 }),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_share_links')),
    h('div', { class: 'share-links' },
      SHARE_LINK_KEYS.map(k => input('share-' + k, t('addons_share_link_' + k), f.links[k], v => { f.links[k] = v; }, { placeholder: 'https://…', maxlength: 200 }))),
    h('label', { class: 'row small', style: { gap: '10px', alignItems: 'flex-start' } },
      h('input', { type: 'checkbox', class: 'share-ok', checked: d.confirmed ? true : null, onchange: e => { d.confirmed = e.target.checked; fixed(); }, style: { marginTop: '3px' } }),
      h('span', { style: { lineHeight: 1.5 } }, t('addons_share_confirm'))),
    d.problems?.length ? h('ul', { class: 'small warn-text addon-perms', role: 'alert', style: { margin: 0 } },
      d.problems.map(p => h('li', {}, t('addons_share_problem_' + p)))) : null,
    h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: close }, t('addons_cancel')),
      h('button', { class: 'btn primary', disabled: d.sending ? true : null, onclick: send }, t(d.sending ? 'addons_share_checking' : 'addons_share_send'))));
}

// What the addon shows in the overlay: a window of its own that comes and goes with the
// overlay (moved like the heart rate widget), or, with "mode": "screen", the whole screen
function overlayCard(s, item) {
  const id = item.manifest.id, o = item.overlay;
  const screenMode = item.manifest.overlay.mode === 'screen';
  const scales = s.addons.overlayScales || [50, 75, 100, 125, 150, 200];
  return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('addons_overlay')),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } },
      t(screenMode ? 'addons_overlay_screen' : 'addons_overlay_text'), ' ',
      t('addons_overlay_hotkey', { hotkey: (s.settings.hotkey?.keys || ['Ctrl', 'Shift', 'H']).join(' + ') }),
      s.overlayOpen ? null : ' ' + t('addons_overlay_closed')),
    h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, t('addons_overlay_show')),
      h('div', { class: 'ctl-input' }, toggle(o.on, on => ad.setOverlay(id, { on }), t('addons_overlay_show')))),
    screenMode ? null : h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, t('addons_overlay_size')),
      h('div', { class: 'ctl-input' }, h('select', { class: 'field select', 'aria-label': t('addons_overlay_size'), onchange: e => ad.setOverlay(id, { scale: Number(e.target.value) }) },
        scales.map(v => h('option', { value: v, selected: v === o.scale ? true : null }, v + ' %'))))),
    screenMode ? null : h('a', { class: 'small', onclick: () => ad.setOverlay(id, { resetPosition: true }) }, t('addons_overlay_reset')));
}

// What the addon tried that the app does not allow or offer, in plain words, and what the AI
// wrote into WISHES.md; from here it goes to the AI (to adapt) or to HypeRate (as a wish)
function limitText(l) {
  const detail = l.kind === 'permission' || l.kind === 'integration-off' ? t('addon_perm_short_' + l.detail) : l.detail;
  return t('addons_limit_' + l.kind, { detail }) + (l.count > 1 ? ` (×${l.count})` : '');
}
const limitLines = (item) => [
  ...(item.limits || []).map(l => '- ' + limitText(l)),
  ...(item.wishes || []).map(w => '- ' + w.title + (w.text ? ': ' + w.text.replace(/\s+/g, ' ') : '')),
].join('\n');

function limitsCard(s, item) {
  const m = item.manifest;
  return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('addons_limits')),
    item.limits?.length ? [
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_limits_text')),
      h('ul', { class: 'addon-perms' }, item.limits.map(l => h('li', {}, limitText(l)))),
    ] : null,
    item.wishes?.length ? [
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_wishes_text')),
      h('ul', { class: 'addon-perms' }, item.wishes.map(w => h('li', {}, h('b', {}, w.title), w.text ? h('span', { class: 'muted' }, ' – ' + w.text) : null))),
    ] : null,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      item.limits?.length ? h('button', { class: 'btn small', onclick: () => ad.dialog({ type: 'prompt', kind: 'limits', folder: item.folder, dir: item.dir, task: limitLines(item) }) }, t('addons_error_ai')) : null,
      h('button', { class: 'btn small', onclick: () => ad.dialog({ type: 'prompt', kind: 'wish', folder: item.folder, dir: item.dir,
        addonName: m?.name || item.folder, addonVersion: m?.version || '',
        title: (item.wishes?.[0]?.title || (item.limits?.[0] ? limitText(item.limits[0]) : '')).slice(0, 100),
        task: limitLines(item) }) }, t('addons_wish'))),
    sentWishes(s, item));
}

// What became of the wishes sent for this addon: waiting, in the forum (with the link), or not
function sentWishes(s, item) {
  const name = item.manifest?.name || item.folder;
  const mine = (s.addons.sentWishes || []).filter(w => w.addonName === name);
  if (!mine.length) return null;
  const tone = { PENDING: 'warn', POSTED: 'ok', REJECTED: 'off' };
  return [
    h('p', { class: 'label', style: { marginTop: '6px' } }, t('addons_wishes_sent')),
    h('ul', { class: 'addon-perms' }, mine.slice(0, 10).map(w => h('li', { class: 'row', style: { gap: '10px', flexWrap: 'wrap' } },
      h('span', { style: { flex: 1, minWidth: '160px' } }, w.title),
      h('span', { class: 'pill ' + (tone[w.status] || 'off') }, t('addons_wish_status_' + w.status)),
      w.status === 'POSTED' && w.discordUrl ? h('a', { class: 'small', onclick: () => window.electronAPI.openExternal(w.discordUrl) }, t('addons_wish_open') + ' ↗') : null))),
  ];
}

function permissionSummary(m) {
  const parts = m.permissions.map(p => t('addon_perm_short_' + p));
  if (m.network.length) parts.push(t('addons_net_short', { hosts: m.network.join(', ') }));
  return t('addons_may') + ' ' + (parts.length ? parts.join(' · ') : t('addons_no_perms'));
}

function errorCard(item, text) {
  return h('div', { class: 'note warn stack', style: { gap: '10px' } },
    h('b', {}, t('addons_has_error')),
    h('code', { class: 'addon-error' }, text),
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn small', onclick: () => ad.dialog({ type: 'prompt', kind: 'error', folder: item.folder, dir: item.dir, task: text }) }, t('addons_error_ai')),
      // stopped by the app (crash, hang, too much CPU): it waits for the user
      item.manifest && !item.running && item.enabled && item.approved ? h('button', { class: 'btn small', onclick: () => ad.reload(item.manifest.id) }, t('addons_restart')) : null));
}

// The values from "settings" in addon.json, as a form; changing one needs no new approval
function settingsCard(item) {
  const m = item.manifest;
  const set = (key, value) => ad.setValue(m.id, key, value);
  return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('addons_settings')),
    m.settings.map(st => {
      const v = item.values[st.key];
      const input = {
        number: () => h('input', { class: 'field', type: 'number', value: v, min: st.min ?? null, max: st.max ?? null, onchange: e => set(st.key, e.target.valueAsNumber) }),
        text: () => h('input', { class: 'field', value: v, maxlength: 500, onchange: e => set(st.key, e.target.value) }),
        toggle: () => toggle(v, on => set(st.key, on), st.label),
        color: () => h('input', { type: 'color', class: 'swatch', value: v, onchange: e => set(st.key, e.target.value) }),
        select: () => h('select', { class: 'field select', onchange: e => set(st.key, e.target.value) }, st.options.map(o => h('option', { value: o, selected: o === v ? true : null }, o))),
      }[st.type]();
      return h('div', { class: 'ctl' },
        h('span', { class: 'ctl-label' }, st.label),
        h('div', { class: 'ctl-input' }, input),
        st.help ? h('p', { class: 'small muted', style: { margin: 0, flexBasis: '100%' } }, st.help) : null);
    }),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_settings_note')));
}

function logView(lines) {
  if (!lines.length) return h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_log_empty'));
  return h('div', { class: 'addon-log' }, lines.slice(-80).map(l => h('div', { class: 'addon-log-line ' + l.level },
    h('span', { class: 'num muted' }, new Date(l.t).toLocaleTimeString()), h('span', {}, l.text + (l.repeat ? ` (×${l.repeat})` : '')))));
}

// ── Dialogs and the guide, drawn over the page ──
export function addonOverlays(s, openAddon) {
  const a = s.addons;
  if (a.guide != null) return guide(s, openAddon);
  if (a.approving) return approvalDialog(a.approving);
  const d = a.dialog;
  if (!d) return null;
  if (d.type === 'allow') return allowDialog(d);
  if (d.type === 'create') return createDialog(openAddon, d);
  if (d.type === 'prompt') return promptDialog(d, openAddon);
  if (d.type === 'share') return shareDialog(d);
  return null;
}

const modal = (cls, label, onClose, ...children) =>
  h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === e.currentTarget) onClose(); } },
    h('div', { class: 'card modal stack ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, style: { width: 'min(560px, 100%)' } }, children));

// then: 'stay' (opened from an addon's page: allow and stay there) or create the first addon
function allowDialog(d = {}) {
  return modal('addons-allow', t('addons_allow_title'), () => ad.dialog(null),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('addons_allow_title')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_intro')),
    h('div', { class: 'note' }, t('addons_safety_text')),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_allow_off')),
    h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => ad.dialog(null) }, t('addons_cancel')),
      h('button', { class: 'btn primary', onclick: async () => {
        if (d.then === 'stay') { await ad.setMaster(true); ad.dialog(null); } else ad.allowAndCreate();
      } }, t('addons_allow_yes'))));
}

function createDialog(openAddon, d) {
  return modal('addons-create', t('addons_create_title'), () => ad.dialog(null),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('addons_create_title')),
    h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, t('addons_create_name')),
      h('input', { class: 'field addon-name', maxlength: 60, placeholder: t('addons_create_name_ph') })),
    h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, t('addons_create_task')),
      h('textarea', { class: 'field addon-task', rows: 4, maxlength: 2000, placeholder: t('addons_create_task_ph') })),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_create_hint'), ' ',
      h('a', { onclick: openDocs }, t('addons_docs') + ' ↗')),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_install_text'), ' ',
      h('a', { onclick: () => ad.openFolder() }, t('addons_open_folder_link'))),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_no_ai')),
    d.error ? h('p', { class: 'small warn-text', role: 'alert', style: { margin: 0 } }, t('addons_create_empty')) : null,
    h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => ad.dialog(null) }, t('addons_cancel')),
      h('button', { class: 'btn primary', onclick: async e => {
        const box = e.target.closest('.modal');
        const task = box.querySelector('.addon-task').value.trim();
        // no name given: the first words of the wish will do
        const name = box.querySelector('.addon-name').value.trim() || task.split(/\s+/).slice(0, 4).join(' ').replace(/[.,;:!?]+$/, '').slice(0, 60);
        // focus only after the hint is drawn: the window holds redraws while someone types
        if (!name) { ad.dialog({ type: 'create', error: true }); setTimeout(() => document.querySelector('.addon-task')?.focus(), 150); return; }
        e.target.disabled = true;
        const folder = await ad.create(name, task);
        openAddon(folder);
      } }, t('addons_create_go'))));
}

// The text to paste into Claude, Codex & co.
function promptText(d) {
  if (d.kind === 'wish') return d.task;
  const key = { create: 'addons_prompt_create', change: 'addons_prompt_change', error: 'addons_prompt_error', limits: 'addons_prompt_limits', share: 'addons_prompt_share', share_update: 'addons_prompt_share_update' }[d.kind];
  return t(key, { dir: d.dir, task: d.task || t('addons_prompt_no_task') });
}

function promptDialog(d) {
  const text = promptText(d);
  if (d.kind === 'wish') return wishDialog(d, text);
  return modal('addons-prompt', t('addons_prompt_title'), () => ad.dialog(null),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t(d.kind === 'create' ? 'addons_prompt_created' : 'addons_prompt_title')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_prompt_how')),
    h('pre', { class: 'addon-prompt' }, text),
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => ad.showFolder(d.folder) }, t('addons_show_folder')),
      h('button', { class: 'btn primary', onclick: async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        ad.dialog({ ...d, copied: true });
      } }, d.copied ? [icon('tick', 16), ' ', t('addons_copied')] : t('addons_copy_prompt')),
      // opened from the share dialog: back there, with what was typed
      h('button', { class: 'btn', onclick: () => ad.dialog(d.back || null) }, t(d.back ? 'addons_share_back' : 'addons_done'))),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_prompt_after')));
}

// A wish for HypeRate: sent only when the user presses Send, exactly as they see and edit it
// here. HypeRate looks at it before it becomes a post in the Discord forum. The feedback form
// stays as the other way (copied, pasted there by the user).
function wishDialog(d, text) {
  const field = (cls) => document.querySelector('.addons-wish .' + cls)?.value.trim() || '';
  const send = async () => {
    const wish = { title: field('wish-title'), body: field('wish-body'), contactName: field('wish-name'), addonName: d.addonName, addonVersion: d.addonVersion };
    if (wish.title.length < 3 || wish.body.length < 10) { ad.dialog({ ...d, ...wish, task: wish.body, error: 'short' }); return; }
    ad.dialog({ ...d, ...wish, task: wish.body, sending: true, error: null });
    const res = await ad.sendWish(wish);
    ad.dialog({ ...d, ...wish, task: wish.body, sending: false, sent: res.ok, error: res.ok ? null : res.reason });
  };
  if (d.sent) return modal('addons-prompt addons-wish', t('addons_wish'), () => ad.dialog(null),
    h('div', { class: 'guide-icon' }, icon('tick', 26)),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('addons_wish_thanks')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_wish_sent')),
    h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn primary', onclick: () => ad.dialog(null) }, t('addons_done'))));
  return modal('addons-prompt addons-wish', t('addons_wish'), () => ad.dialog(null),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('addons_wish_title')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_wish_how')),
    h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, t('addons_wish_field_title')),
      h('input', { class: 'field wish-title', maxlength: 100, value: d.title || '' })),
    h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, t('addons_wish_field_text')),
      h('textarea', { class: 'field wish-body', rows: 7, maxlength: 4000 }, text)),
    h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, t('addons_wish_field_name')),
      h('input', { class: 'field wish-name', maxlength: 40, value: d.contactName || '' })),
    d.error ? h('p', { class: 'small warn-text', role: 'alert', style: { margin: 0 } }, t('addons_wish_failed_' + d.error)) : null,
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
      h('a', { class: 'small', style: { marginRight: 'auto', alignSelf: 'center' }, onclick: async () => {
        // the form knows nothing of the addon: say which one it is about
        const list = field('wish-body') || text;
        await navigator.clipboard.writeText(t('addons_wish_text', { name: d.addonName || '', version: d.addonVersion || '', list })).catch(() => {});
        window.electronAPI.openExternal(FEEDBACK_URL);
        ad.dialog({ ...d, copied: true });
      } }, d.copied ? t('addons_wish_copied') : t('addons_wish_form')),
      h('button', { class: 'btn', onclick: () => ad.dialog(null) }, t('addons_cancel')),
      h('button', { class: 'btn primary', disabled: d.sending ? true : null, onclick: send }, t(d.sending ? 'addons_wish_sending' : 'addons_wish_send'))));
}

// What the addon asks for, before it runs for the first time or after any change; what is new
// since the last approval is marked
function approvalDialog(item) {
  const m = item.manifest;
  const before = item.granted;
  const isNew = (list, x) => before && !list.includes(x);
  const removed = before ? [...before.permissions.filter(p => !m.permissions.includes(p)).map(p => t('addon_perm_' + p)),
    ...before.network.filter(h => !m.network.includes(h)).map(host => t('addons_net_long', { host }))] : [];
  return modal('addons-approve', t('addons_approve_title', { name: m.name }), () => ad.cancelApproval(),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t(before ? 'addons_approve_again' : 'addons_approve_title', { name: m.name })),
    h('p', { class: 'small muted', style: { margin: 0 } }, 'v' + m.version + (m.author ? ' · ' + m.author : '') + ' · ' + item.folder),
    before ? h('p', { class: 'small', style: { margin: 0 } }, t('addons_approve_changed')) : null,
    h('p', { class: 'label' }, t('addons_approve_wants')),
    m.permissions.length || m.network.length ? h('ul', { class: 'addon-perms' },
      m.permissions.map(p => h('li', {}, t('addon_perm_' + p), isNew(before?.permissions || [], p) ? h('span', { class: 'pill warn new-badge' }, t('addons_new_badge')) : null)),
      m.network.map(host => h('li', {}, t('addons_net_long', { host }), isNew(before?.network || [], host) ? h('span', { class: 'pill warn new-badge' }, t('addons_new_badge')) : null)))
      : h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_no_perms')),
    removed.length ? h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_approve_removed', { list: removed.join(', ') })) : null,
    h('div', { class: 'note warn' }, t('addons_approve_warning')),
    h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => ad.cancelApproval() }, t('addons_cancel')),
      h('button', { class: 'btn primary', onclick: () => ad.approve() }, t('addons_allow'))));
}

// ── The guide: what addons are and how to make one, step by step ──
const GUIDE = ['what', 'safe', 'wish', 'ai', 'approve', 'adjust', 'fix'];
function guide(s) {
  const step = Math.max(0, Math.min(GUIDE.length - 1, s.addons.guide));
  const key = GUIDE[step];
  const last = step === GUIDE.length - 1;
  const action = {
    ai: h('button', { class: 'btn small', onclick: openDocs }, t('addons_docs') + ' ↗'),
    safe: s.addons.master ? h('p', { class: 'small ok-text row', style: { margin: 0, gap: '6px' } }, icon('tick', 16), t('guide_safe_on'))
      : h('button', { class: 'btn small', onclick: () => ad.setMaster(true) }, t('addons_allow_yes')),
  }[key] || null;
  return modal('addons-guide', t('guide_title'), () => ad.closeGuide(),
    h('div', { class: 'row between' }, h('p', { class: 'label' }, t('guide_title')), h('span', { class: 'small muted' }, t('guide_step', { n: step + 1, of: GUIDE.length }))),
    h('div', { class: 'welcome-dots', style: { padding: 0 } }, GUIDE.map((_, i) => h('span', { class: i <= step ? 'on' : '' }))),
    h('div', { class: 'guide-icon' }, icon(['puzzle', 'shield', 'pen', 'code', 'check', 'settings', 'wrench'][step], 26)),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('guide_' + key + '_title')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.65, whiteSpace: 'pre-line' } }, t('guide_' + key + '_text')),
    action,
    h('div', { class: 'row between', style: { gap: '10px' } },
      step > 0 ? h('button', { class: 'btn', onclick: () => ad.openGuide(step - 1) }, t('welcome_back')) : h('button', { class: 'btn ghost', onclick: () => ad.closeGuide() }, t('guide_skip')),
      last
        ? h('button', { class: 'btn primary', onclick: () => { ad.closeGuide(); ad.dialog(s.addons.master ? { type: 'create' } : { type: 'allow' }); } }, t('guide_start'))
        : h('button', { class: 'btn primary', onclick: () => ad.openGuide(step + 1) }, t('welcome_next'))));
}

// Escape closes whatever dialog is open
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.querySelector('.addons-guide')) ad.closeGuide();
  else if (document.querySelector('.addons-approve')) ad.cancelApproval();
  else if (document.querySelector('.addons-allow, .addons-create, .addons-prompt')) ad.dialog(null);
});
