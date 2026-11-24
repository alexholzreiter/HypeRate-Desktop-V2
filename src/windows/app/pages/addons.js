// Your own addons, as part of Integrations: one tile per addon next to Discord & co., a + tile
// to make a new one, a page per addon, the dialogs (allow, create, approve, AI prompt) and a
// step-by-step guide. The main process side is src/addons.

import { h, icon } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { addons as ad } from '../lib/state.js';

const toggle = (on, onChange, label) =>
  h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
const initials = (item) => (item.manifest?.name || item.folder).replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '+';
const byFolder = (s, folder) => (s.addons.addons || []).find(a => a.folder === folder);
const changedSinceApproval = (item) => !!(item.manifest && item.granted && !item.approved);

function status(item) {
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
  const items = s.addons.master ? (s.addons.addons || []) : [];
  return [
    items.map(item => {
      const st = status(item);
      return h('button', { class: 'card integ-card addon', onclick: () => openAddon(item.folder) },
        h('div', { class: 'row between' },
          h('span', { class: 'integ-mono addon-mono' }, initials(item)),
          h('span', { class: 'pill ' + st.tone }, h('span', { class: 'dot ' + dotFor(st.tone) }), st.text)),
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
  const st = status(item);
  const id = m?.id;
  if (id && !s.addons.logs[id]) queueMicrotask(() => ad.loadLogs(id));
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
        m ? h('div', { class: 'row' }, h('span', {}, t('addons_switch')), toggle(item.enabled && item.approved, v => ad.setEnabled(item, v), t('addons_switch'))) : null),
      m?.description ? h('p', { class: 'muted', style: { margin: 0 } }, m.description) : null,
      m ? h('p', { class: 'small muted', style: { margin: 0 } }, permissionSummary(m)) : null),

    item.error ? errorCard(item, item.error) : null,
    changedSinceApproval(item) ? h('div', { class: 'note warn row between', style: { gap: '14px', flexWrap: 'wrap' } },
      h('span', {}, t('addons_changed_text')),
      h('button', { class: 'btn small primary', onclick: () => ad.setEnabled(item, true) }, t('addons_review'))) : null,

    h('div', { class: 'split' },
      h('div', { class: 'stack', style: { gap: '18px', flex: '1.4 1 380px', minWidth: 0 } },
        m?.settings?.length ? settingsCard(item) : null,
        !item.error && item.lastError ? errorCard(item, item.lastError) : null,
        h('div', { class: 'card stack' },
          h('div', { class: 'row between' }, h('p', { class: 'label' }, t('addons_log')),
            item.running ? h('a', { class: 'small', onclick: () => ad.reload(id) }, t('addons_restart')) : null),
          logView(logs))),
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
          h('button', { class: 'btn small', onclick: () => ad.showFolder(folder) }, t('addons_show_folder'))),
        h('hr', { class: 'divider' }),
        h('button', { class: 'btn small' + (s.addons.confirmRemove === folder ? ' danger' : ''), onclick: async () => { if (await ad.remove(folder)) back(); } },
          t(s.addons.confirmRemove === folder ? 'addons_remove_confirm' : 'addons_remove')))));
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
    h('div', { class: 'row', style: { gap: '8px' } },
      h('button', { class: 'btn small', onclick: () => ad.dialog({ type: 'prompt', kind: 'error', folder: item.folder, dir: item.dir, task: text }) }, t('addons_error_ai'))));
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
  if (d.type === 'allow') return allowDialog();
  if (d.type === 'create') return createDialog(openAddon);
  if (d.type === 'prompt') return promptDialog(d, openAddon);
  return null;
}

const modal = (cls, label, onClose, ...children) =>
  h('div', { class: 'modal-backdrop', onclick: e => { if (e.target === e.currentTarget) onClose(); } },
    h('div', { class: 'card modal stack ' + cls, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, style: { width: 'min(560px, 100%)' } }, children));

function allowDialog() {
  return modal('addons-allow', t('addons_allow_title'), () => ad.dialog(null),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('addons_allow_title')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_intro')),
    h('div', { class: 'note' }, t('addons_safety_text')),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_allow_off')),
    h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => ad.dialog(null) }, t('addons_cancel')),
      h('button', { class: 'btn primary', onclick: () => ad.allowAndCreate() }, t('addons_allow_yes'))));
}

function createDialog(openAddon) {
  return modal('addons-create', t('addons_create_title'), () => ad.dialog(null),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t('addons_create_title')),
    h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, t('addons_create_name')),
      h('input', { class: 'field addon-name', maxlength: 60, placeholder: t('addons_create_name_ph') })),
    h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, t('addons_create_task')),
      h('textarea', { class: 'field addon-task', rows: 4, maxlength: 2000, placeholder: t('addons_create_task_ph') })),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_create_hint')),
    h('div', { class: 'row', style: { gap: '10px', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => ad.dialog(null) }, t('addons_cancel')),
      h('button', { class: 'btn primary', onclick: async e => {
        const box = e.target.closest('.modal');
        const name = box.querySelector('.addon-name').value.trim(), task = box.querySelector('.addon-task').value.trim();
        if (!name) { box.querySelector('.addon-name').focus(); return; }
        const folder = await ad.create(name, task);
        openAddon(folder);
      } }, t('addons_create_go'))));
}

// The text to paste into Claude, Codex & co.
function promptText(d) {
  const key = { create: 'addons_prompt_create', change: 'addons_prompt_change', error: 'addons_prompt_error' }[d.kind];
  return t(key, { dir: d.dir, task: d.task || t('addons_prompt_no_task') });
}

function promptDialog(d) {
  const text = promptText(d);
  return modal('addons-prompt', t('addons_prompt_title'), () => ad.dialog(null),
    h('h2', { class: 'h1', style: { fontSize: '22px', margin: 0 } }, t(d.kind === 'create' ? 'addons_prompt_created' : 'addons_prompt_title')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('addons_prompt_how')),
    h('pre', { class: 'addon-prompt' }, text),
    h('div', { class: 'row', style: { gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
      h('button', { class: 'btn', onclick: () => ad.showFolder(d.folder) }, t('addons_show_folder')),
      h('button', { class: 'btn primary', onclick: async e => {
        await navigator.clipboard.writeText(text).catch(() => {});
        e.target.textContent = t('addons_copied');
      } }, t('addons_copy_prompt')),
      h('button', { class: 'btn', onclick: () => ad.dialog(null) }, t('addons_done'))),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('addons_prompt_after')));
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
    safe: s.addons.master ? h('p', { class: 'small ok-text row', style: { margin: 0, gap: '6px' } }, icon('tick', 16), t('guide_safe_on'))
      : h('button', { class: 'btn small', onclick: () => ad.setMaster(true) }, t('addons_allow_yes')),
  }[key] || null;
  return modal('addons-guide', t('guide_title'), () => ad.closeGuide(),
    h('div', { class: 'row between' }, h('p', { class: 'label' }, t('guide_title')), h('span', { class: 'small muted' }, t('guide_step', { n: step + 1, of: GUIDE.length }))),
    h('div', { class: 'welcome-dots', style: { padding: 0 } }, GUIDE.map((_, i) => h('span', { class: i <= step ? 'on' : '' }))),
    h('div', { class: 'guide-icon' }, icon(['puzzle', 'shield', 'pen', 'sparkle', 'check', 'settings', 'wrench'][step], 26)),
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
