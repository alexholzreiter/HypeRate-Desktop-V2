// MQTT output — publishes heart rate, zone and (optionally) game moments so Home Assistant
// can react to them. Entities are created through MQTT discovery, so nothing has to be
// configured on the Home Assistant side.

const mqtt = require('mqtt');
const moments = require('./moments');

const STATE_THROTTLE_MS = 1000;   // BLE can deliver several samples per second; one is plenty
const RECONNECT_MS      = 5000;

// Which game moments become events, and the type Home Assistant sees: moments.EVENT_TYPES
const EVENT_TYPES = moments.EVENT_TYPES;

let onStatus = null;
let client = null, options = null;
let lastStateAt = 0, lastState = null, throttleTimer = null;
let lastStatusKey = '', lastError = null;

const clean = (s, fallback) => String(s || fallback).trim().replace(/^\/+|\/+$/g, '');

function topics() {
  const base = clean(options.baseTopic, 'hyperate');
  const id = clean(options.deviceId, 'desktop');
  return {
    state: `${base}/${id}/state`,
    event: `${base}/${id}/event`,
    availability: `${base}/${id}/availability`,
    discovery: (component, key) => `${clean(options.discoveryPrefix, 'homeassistant')}/${component}/hyperate_${id}/${key}/config`,
    uid: `hyperate_${id}`,
  };
}

function init(callbacks = {}) {
  onStatus = callbacks.onStatus;
}

function start(opts = {}) {
  stop();
  options = {
    host: opts.host || 'localhost',
    port: Number(opts.port) || 1883,
    tls: !!opts.tls,
    username: opts.username || '',
    password: opts.password || '',
    baseTopic: opts.baseTopic || 'hyperate',
    deviceId: opts.deviceId || 'desktop',
    discovery: opts.discovery !== false,
    discoveryPrefix: opts.discoveryPrefix || 'homeassistant',
    events: opts.events !== false,
    zonesEnabled: !!opts.zonesEnabled,
    appVersion: opts.appVersion || '',
  };
  const t = topics();

  client = mqtt.connect(`${options.tls ? 'mqtts' : 'mqtt'}://${options.host}:${options.port}`, {
    username: options.username || undefined,
    password: options.password || undefined,
    clientId: `hyperate-desktop-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: RECONNECT_MS,
    connectTimeout: 8000,
    clean: true,
    will: { topic: t.availability, payload: 'offline', qos: 0, retain: true },
  });

  client.on('connect', () => {
    lastError = null;
    client.publish(t.availability, 'online', { retain: true });
    if (options.discovery) publishDiscovery();
    if (lastState) client.publish(t.state, JSON.stringify(lastState));
    emitStatus();
  });
  client.on('reconnect', () => emitStatus());
  client.on('close',     () => emitStatus());
  client.on('error', (err) => {
    // mqtt.js keeps retrying on its own; remember the reason for the settings panel
    lastError = err.code || err.message;
    emitStatus();
  });
}

function stop() {
  clearTimeout(throttleTimer);
  throttleTimer = null;
  if (client) {
    const t = topics();
    try { client.publish(t.availability, 'offline', { retain: true }); } catch {}
    try { client.end(true); } catch {}
  }
  client = null; options = null; lastState = null; lastStateAt = 0;
  lastStatusKey = ''; lastError = null;
}

function setOptions(opts = {}) {
  if (!options) return;
  // Anything that changes the connection or the entity layout needs a fresh session
  const reconnectKeys = ['host', 'port', 'tls', 'username', 'password', 'baseTopic', 'deviceId', 'discovery', 'discoveryPrefix', 'zonesEnabled'];
  const needsRestart = reconnectKeys.some(k => opts[k] !== undefined && String(opts[k]) !== String(options[k]));
  const next = { ...options, ...opts };
  if (needsRestart) start(next);
  else options = next;
}

// ── Home Assistant discovery ────────────────────────────────────────────────
function publishDiscovery() {
  const t = topics();
  const device = {
    identifiers: [t.uid],
    name: 'HypeRate Desktop',
    manufacturer: 'HypeRate',
    model: 'HypeRate Desktop',
    sw_version: options.appVersion || undefined,
  };
  const common = { availability_topic: t.availability, state_topic: t.state, device };

  const entities = [
    ['sensor', 'heart_rate', {
      ...common,
      name: 'Heart rate',
      unique_id: `${t.uid}_heart_rate`,
      unit_of_measurement: 'bpm',
      state_class: 'measurement',
      icon: 'mdi:heart-pulse',
      value_template: '{{ value_json.bpm }}',
      json_attributes_topic: t.state,
    }],
  ];
  if (options.zonesEnabled) {
    entities.push(['sensor', 'zone', {
      ...common,
      name: 'Heart rate zone',
      unique_id: `${t.uid}_zone`,
      icon: 'mdi:heart-flash',
      value_template: '{{ value_json.zone }}',
      // the zone colour rides along so one automation can paint a light without repeating colours
      json_attributes_topic: t.state,
      json_attributes_template: '{{ {"zone_color": value_json.zone_color, "source": value_json.source} | tojson }}',
    }]);
  }
  if (options.events) {
    entities.push(['event', 'game_event', {
      availability_topic: t.availability,
      state_topic: t.event,
      device,
      name: 'Game event',
      unique_id: `${t.uid}_game_event`,
      icon: 'mdi:sword-cross',
      // No value_template: Home Assistant expects one to render a whole JSON event payload,
      // and ours already is one. A template returning just the type is rejected and the
      // entity silently keeps its old state.
      event_types: [...new Set(Object.values(EVENT_TYPES))],
    }]);
  }

  for (const [component, key, payload] of entities) {
    client.publish(t.discovery(component, key), JSON.stringify(payload), { retain: true });
  }
  // an entity that is switched off should not linger in Home Assistant
  if (!options.zonesEnabled) client.publish(t.discovery('sensor', 'zone'), '', { retain: true });
  if (!options.events)       client.publish(t.discovery('event', 'game_event'), '', { retain: true });
}

// ── Publishing ───────────────────────────────────────────────────────────────
function publishBpm(bpm, source, zone = {}) {
  if (!options) return;
  lastState = {
    bpm,
    zone: zone.name || null,
    zone_color: zone.color || null,
    source: source === 'ble' ? 'bluetooth' : 'cloud',
  };
  const now = Date.now();
  const wait = STATE_THROTTLE_MS - (now - lastStateAt);
  if (wait > 0) {
    if (!throttleTimer) throttleTimer = setTimeout(() => { throttleTimer = null; flushState(); }, wait);
    return;
  }
  flushState();
}

function flushState() {
  if (!client?.connected || !lastState) return;
  lastStateAt = Date.now();
  client.publish(topics().state, JSON.stringify(lastState));
}

function publishMoment(moment) {
  if (!options?.events || !client?.connected) return;
  const m = moments.describe(moment);
  if (!m) return;
  const payload = {
    event_type: m.type, game: m.game, title: m.title, detail: m.detail, bpm: m.bpm,
    at: new Date().toISOString(),
  };
  // an attribute that is empty is noise in Home Assistant
  for (const key of Object.keys(payload)) if (payload[key] == null) delete payload[key];
  client.publish(topics().event, JSON.stringify(payload));
}

// ── Status ───────────────────────────────────────────────────────────────────
// 'connected' | 'connecting' | 'error'
function emitStatus(force = false) {
  if (!options) return;
  const state = client?.connected ? 'connected' : lastError ? 'error' : 'connecting';
  const extra = { error: lastError, host: `${options.host}:${options.port}` };
  const key = state + JSON.stringify(extra);
  if (!force && key === lastStatusKey) return;
  lastStatusKey = key;
  onStatus?.(state, extra);
}

// Test button in the settings: sends one state and one event
function test() {
  if (!client?.connected) return false;
  const t = topics();
  client.publish(t.state, JSON.stringify({ bpm: 72, zone: 'Test', zone_color: '#22c55e', source: 'test' }));
  if (options.events) {
    client.publish(t.event, JSON.stringify({ event_type: 'death', game: 'test', title: 'Test event', detail: 'from HypeRate Desktop', bpm: 72, at: new Date().toISOString() }));
  }
  return true;
}

module.exports = { init, start, stop, setOptions, publishBpm, publishMoment, test, EVENT_TYPES };
