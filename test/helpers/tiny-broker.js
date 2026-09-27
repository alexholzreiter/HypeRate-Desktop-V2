// A minimal MQTT 3.1.1 broker for tests: enough to accept clients, route publishes,
// keep retained messages and deliver a client's will when its socket dies.
const net = require('net');
const mqttPacket = require('mqtt-packet');

function createBroker(port, opts = {}) {
  const clients = new Set();          // { socket, will, subs: [RegExp] }
  const connects = [];                // usernames of accepted connections, in order
  const retained = new Map();         // topic → payload
  const listeners = [];               // (topic, payload) => void

  const matches = (filter, topic) => new RegExp('^' + filter.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\\\+/g, '[^/]+').replace(/#$/, '.*') + '$').test(topic);

  function deliver(topic, payload, retain) {
    if (retain) { if (payload.length) retained.set(topic, payload); else retained.delete(topic); }
    listeners.forEach(fn => fn(topic, payload.toString()));
    for (const c of clients) {
      if (c.subs.some(f => matches(f, topic))) {
        c.socket.write(mqttPacket.generate({ cmd: 'publish', topic, payload, qos: 0, retain: false }, { protocolVersion: c.version }));
      }
    }
  }

  const server = net.createServer((socket) => {
    const client = { socket, will: null, subs: [], version: 4 };
    clients.add(client);
    let parser = null;

    // The version is only known once CONNECT arrives, and mqtt-packet needs it up front.
    const sniffVersion = (buf) => {
      const i = buf.indexOf(Buffer.from('MQTT'));      // protocol name sits right before the version byte
      return i > 0 && buf.length > i + 4 ? buf[i + 4] : 4;
    };
    const gen = (p) => mqttPacket.generate(p, { protocolVersion: client.version });

    const onPacket = (packet) => {
      switch (packet.cmd) {
        case 'connect':
          client.will = packet.will || null;
          // opts.refuse lets a test reproduce a broker that turns credentials down
          if (opts.refuse) {
            socket.write(gen({ cmd: 'connack', returnCode: 5, reasonCode: 135, sessionPresent: false }));
            socket.end();
            break;
          }
          connects.push(packet.username || '');
          socket.write(gen({ cmd: 'connack', returnCode: 0, reasonCode: 0, sessionPresent: false }));
          break;
        case 'subscribe':
          client.subs.push(...packet.subscriptions.map(s => s.topic));
          socket.write(gen({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => (opts.denySubscribe ? 128 : 0)), reasonCode: opts.denySubscribe ? 135 : 0 }));
          for (const [topic, payload] of retained) {
            if (packet.subscriptions.some(s => matches(s.topic, topic))) {
              socket.write(gen({ cmd: 'publish', topic, payload, qos: 0, retain: true }));
            }
          }
          break;
        case 'publish':
          deliver(packet.topic, packet.payload, packet.retain);
          if (packet.qos === 1) socket.write(gen({ cmd: 'puback', messageId: packet.messageId, reasonCode: 0 }));
          break;
        case 'pingreq':
          socket.write(gen({ cmd: 'pingresp' }));
          break;
        case 'disconnect':
          client.will = null;          // a clean goodbye cancels the will
          socket.end();
          break;
      }
    };
    socket.on('data', (d) => {
      if (!parser) {
        client.version = sniffVersion(d);
        parser = mqttPacket.parser({ protocolVersion: client.version });
        parser.on('packet', onPacket);
        parser.on('error', () => socket.destroy());
      }
      parser.parse(d);
    });
    socket.on('close', () => {
      clients.delete(client);
      if (client.will) deliver(client.will.topic, Buffer.from(client.will.payload), client.will.retain);
    });
    socket.on('error', () => {});
  });

  return {
    listen: () => new Promise(r => server.listen(port, '127.0.0.1', r)),
    onMessage: (fn) => listeners.push(fn),
    killClients: () => { for (const c of clients) c.socket.destroy(); },   // simulate a crash
    close: () => { for (const c of clients) c.socket.destroy(); server.close(); },
    accept: () => { opts.refuse = false; },        // ab jetzt Anmeldungen annehmen
    refuse: () => { opts.refuse = true; },
    connects,
  };
}

module.exports = { createBroker };
