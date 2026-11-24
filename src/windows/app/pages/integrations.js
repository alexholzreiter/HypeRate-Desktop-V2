// Integrations: other apps that get the heart rate (Discord, VRChat, Home Assistant, the
// HypeRaid addon in WoW). An overview, and one page per integration.

import { h, html } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { integrations as ig } from '../lib/state.js';
import { addonTiles, addonPage, addonOverlays, guideButton } from './addons.js';

export const id = 'integrations';

let detail = null;    // null = overview, or a key of LIST
let oscTest = null;   // { ok, text } for a few seconds after a test ping
let mqttTest = null;
const rerender = () => window.dispatchEvent(new Event('hr-rerender'));
const flash = (set, value) => { set(value); rerender(); setTimeout(() => { set(null); rerender(); }, 4000); };

const LIST = {
  discord:  { name: 'Discord',        mono: 'DC', desc: 'integ_discord_desc',  enabled: s => !!s.settings.discordEnabled,  status: discordStatus,  page: discordPage },
  osc:      { name: 'VRChat OSC',     mono: 'VR', desc: 'integ_osc_desc',      enabled: s => !!s.settings.oscEnabled,      status: oscStatus,      page: oscPage },
  mqtt:     { name: 'Home Assistant', mono: 'HA', desc: 'integ_mqtt_desc',     enabled: s => !!s.settings.mqttEnabled,     status: mqttStatus,     page: mqttPage },
  hyperaid: { name: 'HypeRaid',       mono: 'HR', desc: 'integ_hyperaid_desc', enabled: s => !!s.settings.hyperaidEnabled, status: hyperaidStatus, page: hyperaidPage },
};
const nameOf = it => it.nameKey ? t(it.nameKey) : it.name;

// Pages elsewhere can open one integration directly (the WoW page links to HypeRaid)
export function open(key) { detail = key; }

export function render(s) {
  const page = detail?.startsWith('addon:')
    ? addonPage(s, detail.slice(6), () => { detail = null; rerender(); })
    : detail ? detailPage(s, detail) : overview(s);
  return [page, addonOverlays(s, folder => { detail = 'addon:' + folder; rerender(); })];
}

// ── Overview ──
function overview(s) {
  return h('div', { class: 'page' },
    h('div', { class: 'page-head row between', style: { alignItems: 'flex-start', gap: '16px' } },
      h('div', {}, h('h1', { class: 'h1' }, t('nav_integrations')), h('p', { class: 'sub' }, t('integ_sub'))),
      guideButton()),
    h('div', { class: 'integ-grid' },
      addonTiles(s, folder => { detail = 'addon:' + folder; rerender(); }, 'before'),
      Object.entries(LIST).map(([key, it]) => {
        const st = it.enabled(s) ? it.status(s) : { tone: 'off', text: t('off') };
        return h('button', { class: 'card integ-card ' + key, onclick: () => { detail = key; rerender(); } },
          h('div', { class: 'row between' },
            h('span', { class: 'integ-mono' }, it.mono),
            h('span', { class: 'pill ' + st.tone }, h('span', { class: 'dot ' + dotFor(st.tone) }), st.short || st.text)),
          h('div', { class: 'stack', style: { gap: '4px' } },
            h('p', { style: { margin: 0, fontWeight: 600, fontSize: '17px' } }, nameOf(it)),
            h('p', { class: 'small muted', style: { margin: 0 } }, t(it.desc))),
          h('span', { class: 'small', style: { color: 'var(--accent-text)', fontWeight: 600 } }, t('open') + ' →'));
      }),
      addonTiles(s, folder => { detail = 'addon:' + folder; rerender(); }, 'after')));
}

const dotFor = tone => ({ ok: 'live', warn: 'warn', bad: 'bad' }[tone] || '');

// ── One integration: shared head ──
function detailPage(s, key) {
  const it = LIST[key];
  const on = it.enabled(s);
  const st = on ? it.status(s) : { tone: 'off', text: t('off') };
  return h('div', { class: 'page' },
    h('div', { class: 'card integ-hero ' + key },
      h('a', { class: 'small', onclick: () => { detail = null; rerender(); } }, '← ' + t('nav_integrations')),
      h('div', { class: 'row', style: { gap: '18px', flexWrap: 'wrap' } },
        h('span', { class: 'integ-mono big' }, it.mono),
        h('div', { style: { flex: 1, minWidth: '220px' } },
          h('h1', { class: 'h1' }, nameOf(it)),
          h('div', { class: 'row small', style: { gap: '8px', marginTop: '6px' }, role: 'status' },
            h('span', { class: 'dot ' + dotFor(st.tone) }), h('span', { title: st.title || '' }, st.text))),
        h('div', { class: 'row' }, h('span', {}, t('integ_' + key + '_toggle')), toggle(on, v => setOn(key, v), t('integ_' + key + '_toggle'))))),
    it.page(s, on));
}

function setOn(key, on) {
  if (key === 'discord') ig.setDiscord(on);
  if (key === 'osc') ig.saveOsc({ oscEnabled: on });
  if (key === 'mqtt') ig.setMqtt(on);
  if (key === 'hyperaid') ig.configureHyperaid({ hyperaidEnabled: on });
}

// ── Discord ──
function discordStatus(s) {
  const { state, reason } = s.discord || {};
  if (state === 'connected') return { tone: 'ok', text: t('discord_connected') };
  if (state === 'waiting') return { tone: 'warn', text: t('discord_waiting') };
  if (state === 'error') return { tone: 'bad', text: reason || t('integ_error'), short: t('integ_error') };
  return { tone: 'warn', text: t('discord_idle') };
}

function discordPage() {
  return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('integ_how')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, html(t('integ_discord_info_html'))));
}

// ── VRChat OSC ──
function oscStatus(s) {
  const save = ig.oscSave;
  if (save.state === 'error') return { tone: 'bad', text: t('osc_not_saved', { error: save.error || '' }), short: t('integ_error') };
  return { tone: 'ok', text: t('integ_osc_sending', { host: s.settings.oscHost || '127.0.0.1', port: s.settings.oscPort || 9000 }), short: t('integ_on') };
}

function oscPage(s, on) {
  const o = ig.osc();
  const save = ig.oscSave;
  if (!on) return h('div', { class: 'card stack' },
    h('p', { class: 'label' }, t('integ_how')),
    h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('integ_osc_off_text')),
    h('div', { class: 'note' }, html(t('osc_enable_html'))));

  const text = (key, extra = {}) => h('input', { class: 'field', value: String(o[key] ?? ''), spellcheck: 'false', maxlength: 256, ...extra,
    onchange: e => ig.saveOsc({ [key]: extra.type === 'number' ? e.target.valueAsNumber : e.target.value.trim() }) });
  const output = (flag, label, fields, hint) => h('div', { class: 'osc-output' + (o[flag] ? ' on' : '') },
    h('div', { class: 'row between' }, h('b', {}, label), toggle(o[flag], v => ig.saveOsc({ [flag]: v }), label)),
    o[flag] && fields ? h('div', { class: 'osc-fields' }, fields) : null,
    hint ? h('p', { class: 'small muted', style: { margin: 0 } }, hint) : null);
  const labelled = (label, input) => h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, label), input);

  return [
    h('div', { class: 'split' },
      h('div', { class: 'card stack' },
        h('div', { class: 'row between' }, h('p', { class: 'label' }, t('integ_osc_outputs')),
          save.state ? h('span', { class: 'small ' + (save.state === 'error' ? 'bad-text' : 'muted'), role: 'status' },
            save.state === 'saving' ? t('osc_saving') : save.state === 'saved' ? t('osc_saved') : t('integ_not_saved')) : null),
        save.state === 'error' ? h('div', { class: 'note warn' }, t('osc_not_saved', { error: save.error || '' })) : null,
        h('p', { class: 'small muted', style: { margin: 0 } }, html(t('osc_outputs_hint_html'))),
        output('oscNormalizedEnabled', t('osc_normalized'), [
          labelled(t('osc_param_short'), text('oscNormalizedParam')),
          h('div', { class: 'row', style: { gap: '8px' } },
            labelled(t('osc_min_bpm'), text('oscMinBpm', { type: 'number', min: 0 })),
            labelled(t('osc_max_bpm'), text('oscMaxBpm', { type: 'number', min: 0 })))]),
        output('oscRawEnabled', t('osc_raw'), [
          labelled(t('osc_param_short'), text('oscRawParam')),
          labelled(t('osc_type'), h('select', { class: 'field select', onchange: e => ig.saveOsc({ oscRawType: e.target.value }) },
            h('option', { value: 'i', selected: o.oscRawType === 'i' ? true : null }, t('osc_type_int')),
            h('option', { value: 'f', selected: o.oscRawType === 'f' ? true : null }, t('osc_type_float'))))]),
        output('oscBoolEnabled', t('osc_bool'), [
          labelled(t('osc_param_short'), text('oscBoolParam')),
          labelled(t('osc_bool_value'), h('select', { class: 'field select', onchange: e => ig.saveOsc({ oscBoolValue: e.target.value === 'true' }) },
            h('option', { value: 'true', selected: o.oscBoolValue ? true : null }, 'True'),
            h('option', { value: 'false', selected: o.oscBoolValue ? null : true }, 'False')))], t('osc_bool_hint')),
        output('oscLegacyEnabled', t('osc_legacy'), null, html(t('osc_legacy_hint_html'))),
        h('hr', { class: 'divider' }),
        output('oscChatbox', t('osc_chatbox_toggle'), [
          labelled(t('osc_chatbox_format'), text('oscChatboxFormat')),
          h('p', { class: 'small muted', style: { margin: 0 } }, html(t('integ_osc_chatbox_html')))])),
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('integ_connection')),
        h('div', { class: 'row', style: { gap: '8px' } },
          labelled('Host', text('oscHost')),
          h('div', { style: { flex: '0 0 110px' } }, labelled('Port', text('oscPort', { type: 'number', min: 1, max: 65535 })))),
        h('div', { class: 'note' }, html(t('osc_enable_html'))),
        h('button', { class: 'btn', onclick: async () => {
          let res;
          try { res = await ig.testOsc(); } catch (e) { res = { ok: false, error: e.message }; }
          flash(v => { oscTest = v; }, res.ok ? { ok: true, text: t('integ_osc_sent') } : { ok: false, text: res.error || t('integ_error') });
        } }, t('integ_osc_test')),
        oscTest ? h('p', { class: 'small ' + (oscTest.ok ? 'ok-text' : 'bad-text'), role: 'status', style: { margin: 0 } }, oscTest.text) : null)),
  ];
}

// ── Home Assistant (MQTT) ──
function mqttStatus(s) {
  const { state, host, error } = s.mqtt || {};
  if (state === 'connected') return { tone: 'ok', text: t('mqtt_connected', { host: host || '' }), short: t('integ_connected') };
  if (state === 'connecting') return { tone: 'warn', text: t('mqtt_connecting') };
  if (state === 'error') return { tone: 'bad', text: t('mqtt_error'), title: error || '', short: t('integ_error') };
  return { tone: 'warn', text: s.settings.mqttHost ? t('mqtt_connecting') : t('integ_mqtt_no_broker') };
}

// macOS refuses a connection to the home network with EHOSTUNREACH when the app has no local
// network permission, which looks exactly like a broker that is switched off. Only say so for a
// private address, so a genuinely unreachable server on the internet is not blamed on macOS.
function blockedByLocalNetwork(m) {
  if (m.state !== 'error' || !/Macintosh/.test(navigator.userAgent)) return false;
  if (!['EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN'].includes(m.error)) return false;
  const host = String(m.host || '').split(':')[0];
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) || /\.local$/i.test(host);
}

function mqttPage(s, on) {
  const st = s.settings;
  const field = (key, extra = {}) => h('input', { class: 'field', value: String(st[key] ?? extra.fallback ?? ''), spellcheck: 'false', autocomplete: 'off', ...extra, fallback: null,
    onchange: e => ig.saveMqtt({ [key]: e.target.value.trim() }) });
  const check = (key, label, def) => {
    const value = st[key] ?? def;
    return h('button', { class: 'moment' + (value ? ' on' : ''), 'aria-pressed': String(!!value), onclick: () => ig.saveMqtt({ [key]: !value }) },
      h('span', { class: 'box' }), label);
  };
  const labelled = (label, input) => h('label', { class: 'osc-field' }, h('span', { class: 'small muted' }, label), input);
  return [
    on && blockedByLocalNetwork(s.mqtt || {}) ? h('div', { class: 'note warn' }, t('mqtt_local_network')) : null,
    h('div', { class: 'split' },
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('integ_broker')),
        h('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-end' } },
          labelled(t('integ_mqtt_host'), field('mqttHost', { placeholder: '192.168.1.10' })),
          h('div', { style: { flex: '0 0 110px' } }, labelled('Port', field('mqttPort', { fallback: 1883, inputmode: 'numeric' })))),
        h('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' } },
          labelled(t('mqtt_user'), field('mqttUser')),
          labelled(t('mqtt_password'), h('input', { class: 'field', type: 'password', autocomplete: 'new-password',
            placeholder: s.mqttPassword === 'ok' ? '••••••••' : '',
            onchange: e => { const pw = e.target.value; if (pw) ig.saveMqtt({}, pw); e.target.value = ''; } }))),
        s.mqttPassword === 'lost' ? h('p', { class: 'small warn-text', style: { margin: 0 } }, t('mqtt_password_lost')) : null,
        labelled(t('mqtt_topic'), field('mqttBaseTopic', { fallback: 'hyperate' })),
        h('div', { class: 'moment-grid' },
          check('mqttTls', t('mqtt_tls'), false),
          check('mqttDiscovery', t('integ_mqtt_discovery'), true),
          check('mqttEvents', t('mqtt_events'), true))),
      h('div', { class: 'card stack' },
        h('p', { class: 'label' }, t('integ_how')),
        h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, html(t('integ_mqtt_info_html'))),
        h('button', { class: 'btn', disabled: on ? null : true, onclick: async () => {
          const ok = await ig.testMqtt().catch(() => false);
          flash(v => { mqttTest = v; }, { ok, text: t(ok ? 'mqtt_test_ok' : 'mqtt_test_fail') });
        } }, t('integ_mqtt_test')),
        mqttTest ? h('p', { class: 'small ' + (mqttTest.ok ? 'ok-text' : 'bad-text'), role: 'status', style: { margin: 0 } }, mqttTest.text) : null)),
  ];
}

// ── HypeRaid ──
function hyperaidStatus(s) {
  const st = s.hyperaid || {};
  const tone = { writing: 'ok', waiting: 'warn', installing: 'warn', error: 'bad', setup: 'warn', folder: 'warn' }[st.state] || 'off';
  if (st.justInstalled && (st.state === 'waiting' || st.state === 'writing')) return { tone, text: t('hyperaid_restart') };
  const key = { off: 'hyperaid_off', folder: 'hyperaid_folder_status', setup: 'hyperaid_setup', installing: 'hyperaid_installing',
    waiting: 'hyperaid_waiting', writing: 'hyperaid_writing', error: 'hyperaid_error' }[st.state] || 'hyperaid_off';
  return { tone, text: t(key, { bpm: st.bpm ?? '' }), title: st.error || '',
    short: { writing: t('integ_on'), setup: t('integ_setup_needed'), folder: t('integ_setup_needed'), error: t('integ_error') }[st.state] };
}

function hyperaidPage(s, on) {
  const st = s.hyperaid || {};
  return h('div', { class: 'split' },
    h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('integ_how')),
      h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.6 } }, t('integ_hyperaid_info')),
      on ? h('div', { class: 'stack', style: { gap: '8px' } },
        h('span', { class: 'ctl-label' }, t('hyperaid_folder')),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('input', { class: 'field', value: s.settings.hyperaidFolder || '', spellcheck: 'false', 'aria-label': t('hyperaid_folder'),
            onchange: e => ig.configureHyperaid({ hyperaidFolder: e.target.value.trim() }) }),
          h('button', { class: 'btn small', onclick: () => ig.pickHyperaidFolder() }, t('choose')))) : null),
    h('div', { class: 'card stack' },
      h('p', { class: 'label' }, t('integ_addon')),
      st.installedVersion ? h('p', { class: 'small muted', style: { margin: 0 } }, t('hyperaid_version', { version: st.installedVersion })) : null,
      h('button', { class: 'btn primary', disabled: on && st.canInstall && !st.busy && st.state !== 'installing' ? null : true,
        onclick: () => ig.installHyperaid() }, t('integ_hyperaid_install')),
      h('p', { class: 'small muted', style: { margin: 0, lineHeight: 1.6 } }, t('hyperaid_help')),
      st.curseforgeUrl ? h('a', { class: 'small', 'data-external': st.curseforgeUrl }, t('hyperaid_curseforge')) : null));
}

function toggle(on, onChange, label) {
  return h('button', { class: 'toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label, onclick: () => onChange(!on) }, h('span'));
}
