// Drives the real MQTT module against a broker running inside this test.
const { createBroker } = require('./helpers/tiny-broker');
const mqttLib = require('mqtt');
const out = require('../src/mqtt');

const PORT = 18833;
const checks = [];
const check = (n, ok, info = '') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${info}`); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const seen = new Map();          // topic → last payload
const history = [];              // [topic, payload] in order

(async () => {
  const broker = createBroker(PORT);
  await broker.listen();
  broker.onMessage((topic, text) => { seen.set(topic, text); history.push([topic, text]); });

  const statuses = [];
  out.init({ onStatus: (s, x) => statuses.push([s, x]) });
  out.start({ host: '127.0.0.1', port: PORT, baseTopic: 'hyperate', deviceId: 'desktop', zonesEnabled: true, events: true, appVersion: '1.0.9' });
  await sleep(700);

  check('reports connected', statuses.at(-1)?.[0] === 'connected', JSON.stringify(statuses));
  check('announces itself as online', seen.get('hyperate/desktop/availability') === 'online');

  // ── discovery ──
  const disco = [...seen.keys()].filter(t => t.startsWith('homeassistant/'));
  check('publishes discovery for heart rate and zone and event', disco.length === 3, disco.join(' | '));
  const hr = JSON.parse(seen.get('homeassistant/sensor/hyperate_desktop/heart_rate/config') || '{}');
  check('heart rate entity is a bpm measurement', hr.unit_of_measurement === 'bpm' && hr.state_class === 'measurement' && hr.value_template === '{{ value_json.bpm }}', JSON.stringify(hr));
  check('heart rate entity has availability + device', hr.availability_topic === 'hyperate/desktop/availability' && hr.device?.name === 'HypeRate Desktop' && hr.device.sw_version === '1.0.9', JSON.stringify(hr.device));
  const zone = JSON.parse(seen.get('homeassistant/sensor/hyperate_desktop/zone/config') || '{}');
  check('zone entity carries the colour as an attribute', /zone_color/.test(zone.json_attributes_template || ''), JSON.stringify(zone));
  const ev = JSON.parse(seen.get('homeassistant/event/hyperate_desktop/game_event/config') || '{}');
  check('event entity lists the types', Array.isArray(ev.event_types) && ev.event_types.includes('death') && ev.event_types.includes('pentakill'), JSON.stringify(ev.event_types));
  // Home Assistant expects a value_template to render a WHOLE JSON event payload. Ours already is
  // one, so there must be no template – one that returns just the type is rejected and the entity
  // keeps its old state, which is exactly what happened in the first live test.
  check('event entity has no value_template', ev.value_template === undefined, JSON.stringify(ev.value_template));

  // ── state ──
  out.publishBpm(142, 'ble', { name: 'High', color: '#ef4444' });
  await sleep(200);
  const state = JSON.parse(seen.get('hyperate/desktop/state') || '{}');
  check('publishes bpm, zone, colour and source', state.bpm === 142 && state.zone === 'High' && state.zone_color === '#ef4444' && state.source === 'bluetooth', JSON.stringify(state));

  // ── throttling ──
  const before = history.filter(([t]) => t === 'hyperate/desktop/state').length;
  for (let i = 0; i < 12; i++) { out.publishBpm(140 + i, 'cloud', {}); await sleep(30); }
  await sleep(300);
  const during = history.filter(([t]) => t === 'hyperate/desktop/state').length - before;
  check('12 samples in 400 ms are held back', during <= 1, `${during} Nachrichten`);
  await sleep(1100);                                   // the throttle releases one second later
  const after = history.filter(([t]) => t === 'hyperate/desktop/state').length - before;
  check('exactly one message follows, with the newest value', after === 1 && JSON.parse(seen.get('hyperate/desktop/state')).bpm === 151,
    `${after} Nachrichten, zuletzt ${seen.get('hyperate/desktop/state')}`);

  // ── game events ──
  out.publishMoment({ game: 'lol', card: { style: 'penta', title: 'Pentakill', kicker: 'Jinx' }, peakBpm: 178 });
  await sleep(150);
  const event = JSON.parse(seen.get('hyperate/desktop/event') || '{}');
  check('pentakill arrives as its own event type', event.event_type === 'pentakill' && event.game === 'lol' && event.title === 'Pentakill', JSON.stringify(event));
  out.publishMoment({ game: 'wow', type: 'death', peakBpm: 161, name: 'Grimspire Raider' });
  await sleep(150);
  const wowDeath = JSON.parse(seen.get('hyperate/desktop/event') || '{}');
  check('a WoW death maps to "death"', wowDeath.event_type === 'death', seen.get('hyperate/desktop/event'));
  check('a WoW result carries a readable title and name', wowDeath.title === 'You Died' && wowDeath.detail === 'Grimspire Raider', seen.get('hyperate/desktop/event'));

  // a fight result without a name should name the enemy instead, like the overlay does
  out.publishMoment({ game: 'wow', type: 'boss', peakBpm: 175, killer: { name: 'Grimspire Warlord' } });
  await sleep(150);
  const boss = JSON.parse(seen.get('hyperate/desktop/event') || '{}');
  check('a boss kill names the enemy', boss.title === 'Boss Defeated' && boss.detail === 'vs. Grimspire Warlord', seen.get('hyperate/desktop/event'));

  // empty fields would show up as blank attributes in Home Assistant
  out.publishMoment({ game: 'lol', card: { style: 'ace', title: 'Ace' } });
  await sleep(150);
  const ace = JSON.parse(seen.get('hyperate/desktop/event') || '{}');
  check('empty fields are left out entirely', !('detail' in ace) && !('bpm' in ace), seen.get('hyperate/desktop/event'));

  // events switched off
  out.setOptions({ events: false });
  const eventsBefore = history.filter(([t]) => t === 'hyperate/desktop/event').length;
  out.publishMoment({ game: 'lol', card: { style: 'death', title: 'You Died' } });
  await sleep(200);
  check('no events when the option is off', history.filter(([t]) => t === 'hyperate/desktop/event').length === eventsBefore);
  out.setOptions({ events: true });

  // ── test button ──
  check('test button publishes', out.test() === true);
  await sleep(150);
  check('test value lands on the state topic', JSON.parse(seen.get('hyperate/desktop/state')).zone === 'Test', seen.get('hyperate/desktop/state'));

  // ── announcing again on every start makes Home Assistant rebuild the entities ──
  // A rebuilt event entity restores its last event into the logbook, which reads as if the
  // game had been played once more.
  let merkte = null;
  out.init({ onStatus: () => {}, onDiscovery: (sig) => { merkte = sig; } });
  out.stop();
  const zaehleDiscovery = () => history.filter(([t]) => t.startsWith('homeassistant/')).length;

  out.start({ host: '127.0.0.1', port: PORT, baseTopic: 'hyperate', deviceId: 'desktop', zonesEnabled: true, events: true, appVersion: '1.0.9' });
  await sleep(600);
  const nachErstem = zaehleDiscovery();
  check('the first start announces the entities', nachErstem > 0 && !!merkte, `${nachErstem} Nachrichten`);

  out.stop();
  out.start({ host: '127.0.0.1', port: PORT, baseTopic: 'hyperate', deviceId: 'desktop', zonesEnabled: true, events: true, appVersion: '1.0.9', discoverySignature: merkte });
  await sleep(600);
  check('an unchanged start announces nothing again', zaehleDiscovery() === nachErstem, `${zaehleDiscovery() - nachErstem} zusätzliche`);

  out.stop();
  out.start({ host: '127.0.0.1', port: PORT, baseTopic: 'hyperate', deviceId: 'desktop', zonesEnabled: false, events: true, appVersion: '1.0.9', discoverySignature: merkte });
  await sleep(600);
  check('a changed setup does announce again', zaehleDiscovery() > nachErstem);

  // ── offline on stop ──
  out.stop();
  await sleep(300);
  check('says goodbye as offline', seen.get('hyperate/desktop/availability') === 'offline');

  // ── last will: a hard disconnect must mark it offline too ──
  out.start({ host: '127.0.0.1', port: PORT, baseTopic: 'hyperate', deviceId: 'desktop', zonesEnabled: false, events: false });
  await sleep(600);
  check('zone entity is removed when zones are off', seen.get('homeassistant/sensor/hyperate_desktop/zone/config') === '', JSON.stringify(seen.get('homeassistant/sensor/hyperate_desktop/zone/config')));
  broker.killClients();                   // pull the plug, no clean disconnect
  await sleep(700);
  check('broker publishes the last will after a crash', seen.get('hyperate/desktop/availability') === 'offline', seen.get('hyperate/desktop/availability'));

  // ── a broker that turns the password down, and then does not ──
  // What a wrong broker password looks like from the app's side. The client has to notice the
  // corrected password and reconnect on its own, without the app being restarted.
  out.stop();
  const broker2 = createBroker(PORT + 1, { refuse: true });
  await broker2.listen();
  const verlauf = [];
  out.init({ onStatus: (s) => verlauf.push(s) });
  out.start({ host: '127.0.0.1', port: PORT + 1, baseTopic: 'hyperate', deviceId: 'desktop', username: 'hyperate', password: 'falsch' });
  await sleep(900);
  check('a refused password shows up as an error', verlauf.includes('error'), verlauf.join(' → ') || '(nichts gemeldet)');

  broker2.accept();
  out.setOptions({ password: 'richtig' });
  await sleep(1000);
  check('the corrected password reconnects on its own', verlauf.at(-1) === 'connected', verlauf.join(' → '));
  check('the broker saw the user name on the accepted connection', broker2.connects.at(-1) === 'hyperate', JSON.stringify(broker2.connects));
  out.stop(); broker2.close();

  out.stop(); broker.close();
  const failed = checks.filter(x => !x).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
