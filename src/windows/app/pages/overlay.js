// Overlay: how the heart rate widget looks, with a live preview over a game-like scene.
// Every change goes to the open overlay right away and is saved a moment later.

import { h, svg } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { get } from '../lib/state.js';
import { dayScene } from '../lib/scene.js';
import { withDefaults, heartShapes, drawPreview, DEFAULT_ZONES, customFile, assetUrl, fontFor } from '../lib/overlay-config.js';

export const id = 'overlay';

const api = window.electronAPI;
let tab = 'heart';
let saveTimer = null;
let displays = null;      // { displays, selected, supportsSpaces, allSpaces }
let systemFonts = null;
let uploadError = null;   // { kind, text } after a refused upload
let suggestion = null;    // zones from the user's own sessions, { at, data }

// ── Uploaded hearts and fonts ──
async function upload(kind) {
  uploadError = null;
  const res = await api.assetsPick(kind);
  if (!res?.ok) {
    if (res?.code && res.code !== 'canceled') uploadError = { kind, text: t('upload_' + (['type', 'size', 'empty'].includes(res.code) ? res.code : 'error'), { detail: res.detail || '' }) };
    rerender();
    return;
  }
  get().settings[kind === 'heart' ? 'customHearts' : 'customFonts'] = res.list;
  change(kind === 'heart' ? { heartStyle: 'custom:' + res.asset.file } : { fontStyle: 'custom:' + res.asset.file });
  rerender();
}

async function removeUpload(kind, file) {
  const s = get();
  s.settings[kind === 'heart' ? 'customHearts' : 'customFonts'] = await api.assetsRemove(kind, file);
  // whatever used it falls back to the default
  const c = config();
  if (kind === 'heart' && c.heartStyle === 'custom:' + file) change({ heartStyle: 'filled' });
  else if (kind === 'font' && c.fontStyle === 'custom:' + file) change({ fontStyle: 'mono' });
  rerender();
}

const config = () => withDefaults(get().settings.config);

function change(patch) {
  const s = get();
  const next = { ...config(), ...patch };
  s.settings.config = next;
  // The element on screen, not the last rendered one: the window patches the screen from renders
  const shown = document.querySelector('.scene .preview-widget');
  if (shown) drawPreview(shown, next, s.bpm);
  api.updateConfig(next);   // reaches the overlay if it is open
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveSettings({ config: next }), 500);
}

const rerender = () => window.dispatchEvent(new Event('hr-rerender'));
// The sun and the colours move with the clock; once a minute is enough
setInterval(() => { if (document.querySelector('.day-scene')) rerender(); }, 60 * 1000);

export function render(s) {
  const c = config();
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'h1' }, t('nav_overlay')), h('p', { class: 'sub' }, t('overlay_sub'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => api.closeOverlay() }, t('overlay_hide')),
        h('button', { class: 'btn primary', onclick: () => api.launchOverlay(config()) }, t('overlay_show')))),
    scene(c, s.bpm),
    gameHint(c),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': t('nav_overlay') },
      [['heart', 'tab_heart'], ['font', 'tab_font_long'], ['layout', 'tab_layout_long'], ['zones', 'tab_zones'], ['display', 'tab_display']]
        .map(([id, key]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { tab = id; rerender(); } }, t(key)))),
    { heart: heartTab, font: fontTab, layout: layoutTab, zones: zonesTab, display: displayTab }[tab](c));
}

// ── Preview ──
function scene(c, bpm) {
  const preview = h('div', { class: 'preview-widget' },
    h('div', { class: 'ph' }),
    h('div', { class: 'pv-num' }, h('div', { class: 'pn num' }), h('div', { class: 'pl' }, 'BPM')));
  drawPreview(preview, c, bpm);
  return h('div', { class: 'card scene-card' },
    h('div', { class: 'scene' },
      // the landscape follows the time of day (lib/scene.js)
      dayScene(),
      h('span', { class: 'scene-note' }, t(c.showWidget ? 'preview_note' : 'preview_no_widget')),
      c.showWidget ? h('div', { class: 'scene-widget' }, preview) : null));
}

function gameHint(c) {
  const games = (c.gameThemes || []).map(g => ({ wow: 'World of Warcraft', lol: 'League of Legends' }[g])).filter(Boolean);
  if (!games.length) return null;
  return h('div', { class: 'note' }, t('game_bar_hint', { games: games.join(' / ') }));
}

// ── Controls ──
function field(label, control, extra) {
  return h('div', { class: 'ctl' }, h('span', { class: 'ctl-label' }, label), h('div', { class: 'ctl-input' }, control, extra));
}

function select(key, options) {
  const c = config();
  // Some choices bring their own fields (a colour for "Gradient"), so draw the page again at once
  return h('select', { class: 'field select', onchange: e => { change({ [key]: e.target.value }); rerender(); } },
    options.map(([value, label]) => h('option', { value, selected: c[key] === value ? true : null }, label)));
}

function color(key) {
  const c = config();
  // The partner field is found from the event: the window patches the screen from fresh renders,
  // so an element kept from this render may not be the one on screen
  const hex = h('input', { class: 'field hex', value: c[key], maxlength: 7, spellcheck: 'false', 'aria-label': key,
    onchange: e => { const v = e.target.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) { e.target.previousSibling.value = v; change({ [key]: v }); } else e.target.value = config()[key]; } });
  const swatch = h('input', { type: 'color', class: 'swatch', value: c[key], 'aria-label': key,
    oninput: e => { e.target.nextSibling.value = e.target.value; change({ [key]: e.target.value }); } });
  return h('div', { class: 'row', style: { gap: '8px' } }, swatch, hex);
}

function range(key, min, max, unit) {
  const c = config();
  const out = h('span', { class: 'num range-value' }, `${c[key]}${unit}`);
  return h('div', { class: 'row', style: { gap: '12px', flex: 1 } },
    h('input', { type: 'range', min, max, value: c[key], 'aria-label': key, style: { flex: 1 },
      oninput: e => { e.target.nextSibling.textContent = `${e.target.value}${unit}`; change({ [key]: Number(e.target.value) }); } }),
    out);
}

function toggle(key, label) {
  const on = config()[key] !== false && !!config()[key];
  return h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': label,
    onclick: () => { change({ [key]: !on }); rerender(); } }, h('span'));
}

function switchRow(key, label, sub) {
  return h('div', { class: 'row between' },
    h('div', {}, h('p', { style: { margin: 0 } }, label), sub ? h('p', { class: 'small muted', style: { margin: '3px 0 0' } }, sub) : null),
    toggle(key, label));
}

// ── Tabs ──
function heartTab(c) {
  const shapes = heartShapes();
  return h('div', { class: 'split' },
    h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('heart_style')),
      h('div', { class: 'shape-grid' }, shapes.map(sh => h('button', {
        class: 'shape' + (c.heartStyle === sh.id ? ' on' : ''), title: sh.label, 'aria-label': sh.label, 'aria-pressed': String(c.heartStyle === sh.id),
        onclick: () => { change({ heartStyle: sh.id }); rerender(); },
      }, shapeIcon(sh, c.heartStyle === sh.id ? c.heartColor : '#c9cde8')))),
      h('p', { class: 'small muted', style: { margin: 0 } }, shapes.find(sh => sh.id === c.heartStyle)?.label
        || (get().settings.customHearts || []).find(a => 'custom:' + a.file === c.heartStyle)?.name || ''),
      h('hr', { class: 'divider' }),
      h('div', { class: 'row between' }, h('p', { class: 'label' }, t('own_hearts')), h('span', { class: 'small muted' }, t('own_hearts_formats'))),
      h('div', { class: 'shape-grid' },
        (get().settings.customHearts || []).map(a => h('div', { class: 'shape-wrap' },
          h('button', { class: 'shape' + (c.heartStyle === 'custom:' + a.file ? ' on' : ''), title: a.name, 'aria-label': a.name, 'aria-pressed': String(c.heartStyle === 'custom:' + a.file),
            onclick: () => { change({ heartStyle: 'custom:' + a.file }); rerender(); } },
            // a light silhouette like the built-in shapes, so a dark image still shows on the dark tile
            h('span', { class: 'shape-img', style: { '--mask': `url(${assetUrl(a.file)})`, background: c.heartStyle === 'custom:' + a.file ? c.heartColor : '#c9cde8' } })),
          h('button', { class: 'shape-remove', title: t('remove'), 'aria-label': t('remove') + ': ' + a.name, onclick: () => removeUpload('heart', a.file) }, '×'))),
        h('button', { class: 'shape upload', title: t('upload_heart'), 'aria-label': t('upload_heart'), onclick: () => upload('heart') }, '+')),
      uploadError?.kind === 'heart' ? h('p', { class: 'small bad-text', role: 'status', style: { margin: 0 } }, uploadError.text) : null,
      ownHeartInUse(c) ? switchRow('heartTint', t('own_heart_tint')) : null,
      ownHeartInUse(c) ? h('p', { class: 'small muted', style: { margin: 0 } }, t(c.heartTint !== false ? 'own_heart_tint_on' : 'own_heart_color_note')) : null),
    h('div', { class: 'card stack' },
      field(t('anim'), select('heartAnim', [['pulse', t('anim_pulse')], ['beat', t('anim_beat')], ['bounce', t('anim_bounce')], ['shake', t('anim_shake')], ['glow', t('anim_glow')], ['none', t('anim_none')]])),
      field(t('color'), color('heartColor')),
      c.zonesEnabled ? zoneNote(c) : null,
      field(t('size'), range('heartSize', 24, 80, 'px')),
      h('hr', { class: 'divider' }),
      switchRow('heartGlow', t('glow_effect')),
      c.heartGlow ? field(t('glow_color'), color('glowColor')) : null,
      c.heartGlow || c.heartAnim === 'glow' ? field(t('glow_opacity'), range('heartGlowOpacity', 0, 100, '%')) : null));
}

// An uploaded heart is chosen and still exists
const ownHeartInUse = c => (get().settings.customHearts || []).some(a => 'custom:' + a.file === c.heartStyle);

// With zones on, the zone colour wins while a heart rate comes in. Say which one is showing right
// now, and offer the two ways out, so a colour change that "does nothing" is not a mystery.
function zoneNote(c) {
  const bpm = get().bpm;
  const zone = bpm == null ? null : (c.zones || []).find(z => bpm >= z.min && bpm <= z.max);
  return h('div', { class: 'note warn stack', style: { gap: '10px', padding: '12px 14px', fontSize: '13px' } },
    h('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-start' } },
      zone ? h('span', { class: 'zone-chip', style: { background: zone.color } }) : null,
      h('span', {}, zone ? t('zone_now_color', { zone: zone.name, bpm }) : t('zone_replaces_color'))),
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn small', onclick: () => { change({ zonesEnabled: false }); rerender(); } }, t('zones_turn_off')),
      h('button', { class: 'btn small', onclick: () => { tab = 'zones'; rerender(); } }, t('zones_edit'))));
}

function shapeIcon(sh, fill) {
  if (!sh.svg) return h('span', { class: 'shape-dot', style: { background: fill } });
  const wrap = h('span', { class: 'shape-svg', style: { color: fill } });
  wrap.innerHTML = sh.svg;   // shipped with the app in src/hearts.js
  return wrap;
}

function fontTab(c) {
  if (c.fontStyle === 'system' && !systemFonts) {
    systemFonts = [];
    api.getSystemFonts?.().then(list => { systemFonts = list || []; rerender(); }).catch(() => {});
  }
  return h('div', { class: 'split' },
    h('div', { class: 'card stack' },
      field(t('font_style'), select('fontStyle', [['mono', 'Space Mono'], ['sans', 'DM Sans'], ['serif', 'Playfair Display'], ['display', 'Bebas Neue'], ['retro', 'VT323'], ['system', t('font_system')],
        ...(get().settings.customFonts || []).map(a => ['custom:' + a.file, a.name + ' · ' + t('own_font_tag')])])),
      c.fontStyle === 'system' ? field(t('font_system_name'), h('div', { style: { flex: 1 } },
        h('input', { class: 'field', list: 'systemFonts', value: c.systemFont || '', placeholder: t('font_system_placeholder'), onchange: e => change({ systemFont: e.target.value.trim() }) }),
        h('datalist', { id: 'systemFonts' }, (systemFonts || []).map(f => h('option', { value: f }))))) : null,
      h('div', { class: 'stack', style: { gap: '8px' } },
        (get().settings.customFonts || []).map(a => h('div', { class: 'font-row' + (c.fontStyle === 'custom:' + a.file ? ' on' : '') },
          h('button', { class: 'font-pick', onclick: () => { change({ fontStyle: 'custom:' + a.file }); rerender(); } },
            h('span', { class: 'font-sample', style: { fontFamily: fontFor({ fontStyle: 'custom:' + a.file }) } }, '123'),
            h('span', { class: 'small' }, a.name)),
          h('button', { class: 'shape-remove inline', title: t('remove'), 'aria-label': t('remove') + ': ' + a.name, onclick: () => removeUpload('font', a.file) }, '×'))),
        h('button', { class: 'btn small', style: { alignSelf: 'flex-start' }, onclick: () => upload('font') }, t('upload_font')),
        uploadError?.kind === 'font' ? h('p', { class: 'small bad-text', role: 'status', style: { margin: 0 } }, uploadError.text) : null,
        h('p', { class: 'small muted', style: { margin: 0 } }, t('own_font_note'))),
      h('hr', { class: 'divider' }),
      field(t('bpm_size'), range('bpmSize', 16, 96, 'px')),
      field(t('num_anim'), select('numAnim', [['flip', t('num_flip')], ['fade', t('num_fade')], ['pop', t('num_pop')], ['none', t('anim_none')]]))),
    h('div', { class: 'card stack' },
      field(t('bpm_color'), color('bpmColor')),
      field(t('label_color'), color('labelColor')),
      h('hr', { class: 'divider' }),
      switchRow('textGlow', t('text_glow')),
      c.textGlow ? field(t('glow_opacity'), range('textGlowOpacity', 0, 100, '%')) : null));
}

function layoutTab(c) {
  return h('div', { class: 'split' },
    h('div', { class: 'card stack' },
      field(t('background'), select('bgStyle', [['transparent', t('bg_transparent')], ['dark-pill', t('bg_pill')], ['glass', t('bg_glass')], ['solid', t('bg_solid')], ['gradient', t('bg_gradient')]])),
      ['solid', 'gradient'].includes(c.bgStyle) ? field(t(c.bgStyle === 'gradient' ? 'bg_color_from' : 'bg_color'), color('bgColor')) : null,
      c.bgStyle === 'gradient' ? field(t('bg_color_to'), color('bgColor2')) : null,
      c.bgStyle !== 'transparent' ? field(t('bg_opacity'), range('bgOpacity', 0, 100, '%')) : null,
      c.bgStyle !== 'transparent' ? field(t('corner_radius'), range('borderRadius', 0, 50, 'px')) : null),
    h('div', { class: 'card stack' },
      field(t('layout'), select('layoutStyle', [['horizontal', t('layout_h')], ['vertical', t('layout_v')], ['compact', t('layout_c')]])),
      h('hr', { class: 'divider' }),
      switchRow('showLabel', t('show_label')),
      switchRow('showBorder', t('show_border'))));
}

// Zones from the user's own sessions. Asked again after a minute, so new sessions count.
function suggestedZones(sg) {
  return [
    { name: t('zone_calm'), min: 0, max: sg.calmMax, color: '#22c55e' },
    { name: t('zone_excited'), min: sg.calmMax + 1, max: sg.excitedMax, color: '#f59e0b' },
    { name: t('zone_peak'), min: sg.excitedMax + 1, max: 999, color: '#ef4444' },
  ];
}

function duration(minutes) {
  return minutes >= 120 ? t('zone_sg_hours', { n: Math.round(minutes / 60) }) : t('zone_sg_minutes', { n: minutes });
}

function suggestBox(zones) {
  if (!suggestion || Date.now() - suggestion.at > 60000) {
    suggestion = { at: Date.now(), data: suggestion?.data ?? null };
    api.sessionsZoneSuggestion?.().then(d => { suggestion = { at: Date.now(), data: d }; rerender(); }).catch(() => {});
  }
  const sg = suggestion.data;
  if (!sg) return null;
  if (!sg.enough) {
    return h('div', { class: 'zone-suggest' },
      h('p', { class: 'label' }, t('zone_sg_title')),
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } },
        t('zone_sg_wait', { sessions: sg.sessions, time: duration(sg.minutes) }),
        get().settings.sessionsEnabled ? '' : ' ' + t('zone_sg_record')));
  }
  const next = suggestedZones(sg);
  const applied = zones.length === 3 && next.every((z, i) => zones[i].min === z.min && zones[i].max === z.max);
  return h('div', { class: 'zone-suggest' },
    h('div', { class: 'row between', style: { flexWrap: 'wrap', gap: '12px' } },
      h('div', { style: { minWidth: 0 } },
        h('p', { class: 'label' }, t('zone_sg_title')),
        h('p', { style: { margin: '6px 0 0', fontWeight: 600 } },
          t('zone_sg_line', { calm: sg.calmMax, from: sg.calmMax + 1, to: sg.excitedMax, peak: sg.excitedMax + 1 }))),
      applied
        ? h('span', { class: 'pill ok' }, t('zone_sg_applied'))
        : h('button', { class: 'btn small primary', onclick: () => { change({ zones: next }); rerender(); } }, t('zone_sg_apply'))),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } },
      t('zone_sg_text', { sessions: sg.sessions, time: duration(sg.minutes) })));
}

function zonesTab(c) {
  const zones = c.zones?.length ? c.zones : DEFAULT_ZONES;
  const set = (i, patch) => change({ zones: zones.map((z, j) => (j === i ? { ...z, ...patch } : z)) });
  return h('div', { class: 'card stack' },
    switchRow('zonesEnabled', t('zones_enable'), t('zones_sub')),
    switchRow('zonesAffectFont', t('zones_font')),
    suggestBox(zones),
    h('div', { class: 'zone-table' },
      h('div', { class: 'zone-row head' }, h('span', { class: 'label' }, t('color')), h('span', { class: 'label' }, t('zone_name')), h('span', { class: 'label' }, t('zone_from')), h('span', { class: 'label' }, t('zone_to')), h('span')),
      zones.map((z, i) => h('div', { class: 'zone-row' },
        h('input', { type: 'color', class: 'swatch', value: z.color, 'aria-label': t('color'), onchange: e => set(i, { color: e.target.value }) }),
        h('input', { class: 'field', value: z.name, maxlength: 24, 'aria-label': t('zone_name'), onchange: e => set(i, { name: e.target.value.trim() || z.name }) }),
        h('input', { class: 'field', type: 'number', min: 0, max: 300, value: z.min, 'aria-label': t('zone_from'), onchange: e => set(i, { min: Number(e.target.value) || 0 }) }),
        h('input', { class: 'field', type: 'number', min: 0, max: 999, value: z.max, 'aria-label': t('zone_to'), onchange: e => set(i, { max: Number(e.target.value) || 0 }) }),
        h('button', { class: 'btn small', 'aria-label': t('zone_remove'), disabled: zones.length <= 1 ? true : null, onclick: () => { change({ zones: zones.filter((_, j) => j !== i) }); rerender(); } }, '×')))),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => {
        const last = zones[zones.length - 1];
        change({ zones: [...zones, { name: t('zone_new'), min: (last?.max ?? 0) + 1, max: 999, color: '#7c3aed' }] });
        rerender();
      } }, t('zone_add')),
      h('button', { class: 'btn small', onclick: () => { change({ zones: DEFAULT_ZONES }); rerender(); } }, t('zone_reset'))),
    h('p', { class: 'small muted', style: { margin: 0 } }, t('zones_discord')));
}

function displayTab() {
  if (!displays) {
    displays = { displays: [] };
    api.getOverlayDisplays?.().then(d => { displays = d || { displays: [] }; rerender(); }).catch(() => {});
  }
  const hotkey = (get().settings.hotkey?.keys || ['Ctrl', 'Shift', 'H']).join(' + ');
  return h('div', { class: 'card stack' },
    switchRow('showWidget', t('overlay_show_widget'), t('overlay_show_widget_sub')),
    h('hr', { class: 'divider' }),
    displays.displays.length > 1 ? field(t('overlay_display'), h('select', {
      class: 'field select',
      onchange: async e => { displays = await api.setOverlayDisplay(Number(e.target.value)); rerender(); },
    }, displays.displays.map(d => h('option', { value: d.id, selected: d.id === displays.selected ? true : null }, d.label + (d.primary ? ` (${t('display_primary')})` : ''))))) :
      h('p', { class: 'small muted', style: { margin: 0 } }, t('display_single')),
    displays.supportsSpaces ? h('div', { class: 'row between' },
      h('div', {}, h('p', { style: { margin: 0 } }, t('overlay_all_spaces')), h('p', { class: 'small muted', style: { margin: '3px 0 0' } }, t('all_spaces_sub'))),
      h('button', { class: 'toggle' + (displays.allSpaces ? ' on' : ''), role: 'switch', 'aria-checked': String(!!displays.allSpaces), 'aria-label': t('overlay_all_spaces'),
        onclick: async () => { const on = !displays.allSpaces; await api.setOverlayAllSpaces(on); displays = { ...displays, allSpaces: on }; rerender(); } }, h('span'))) : null,
    h('hr', { class: 'divider' }),
    h('div', { class: 'row between' }, h('span', {}, t('hotkey_toggle')), h('span', { class: 'kbd' }, hotkey)),
    h('hr', { class: 'divider' }),
    h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('overlay_fullscreen_note')));
}
