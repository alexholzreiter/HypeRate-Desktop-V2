const assert = require('node:assert/strict');
const { createInApp, cleanMessage } = require('../src/in-app');

async function check(name, fn) {
  await fn();
  console.log('PASS ' + name);
}

const credentials = async () => ({ installationId: 'inst-1', token: 't' });
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const r = routes.find(([match]) => url.includes(match));
    if (!r) return { ok: false, status: 404, json: async () => ({}), headers: new Map() };
    const [, status, body, type] = r;
    return {
      ok: status < 400, status,
      json: async () => body,
      arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.from('')),
      headers: { get: () => type || 'application/json' },
    };
  };
  fn.calls = calls;
  return fn;
}

(async () => {
  await check('a message is fetched with the poll feature and its image comes as a data URL', async () => {
    const fetchImpl = fakeFetch([
      ['/api/in-app/messages?', 200, { success: true, message: { id: 'm1', type: 'message', title: 'Hi', body: 'News', ctaText: 'Read', deepLink: 'https://hyperate.io/x', imageUrl: 'https://push.hyperate.io/a.png' } }],
      ['a.png', 200, Buffer.from([1, 2, 3]), 'image/png'],
    ]);
    const m = await createInApp({ baseUrl: 'https://push', credentials, fetchImpl }).fetchMessage();
    assert.match(fetchImpl.calls[0].url, /installationId=inst-1&features=poll$/);
    assert.equal(m.title, 'Hi');
    assert.equal(m.link, 'https://hyperate.io/x');
    assert.equal(m.image, 'data:image/png;base64,AQID');
    assert.equal(m.imageUrl, undefined);
  });

  await check('no message, an SVG image or a non-https link are handled safely', async () => {
    const none = await createInApp({ baseUrl: 'https://push', credentials, fetchImpl: fakeFetch([['/api/in-app/messages?', 200, { success: true, message: null }]]) }).fetchMessage();
    assert.equal(none, null);
    const fetchImpl = fakeFetch([
      ['/api/in-app/messages?', 200, { success: true, message: { id: 'm2', title: 'x', body: 'y', deepLink: 'hyperate://activity', imageUrl: 'https://push/evil.svg' } }],
      ['evil.svg', 200, Buffer.from('<svg/>'), 'image/svg+xml'],
    ]);
    const m = await createInApp({ baseUrl: 'https://push', credentials, fetchImpl }).fetchMessage();
    assert.equal(m.image, null);
    assert.equal(m.link, '');
  });

  await check('a poll needs at least two answers and keeps their ids', async () => {
    assert.equal(cleanMessage({ id: 'p', type: 'poll', title: 't', options: [{ id: 'o1', label: 'A' }] }), null);
    const p = cleanMessage({ id: 'p', type: 'poll', title: 't', options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }] });
    assert.deepEqual(p.options.map(o => o.id), ['o1', 'o2']);
  });

  await check('events and votes go to the right endpoints with the installation', async () => {
    const fetchImpl = fakeFetch([
      ['/event', 200, { success: true }],
      ['/vote', 200, { success: true, results: { totalVotes: 10, options: [{ id: 'o1', label: 'A', votes: 7, percent: 70 }, { id: 'o2', label: 'B', votes: 3, percent: 30 }] } }],
    ]);
    const ia = createInApp({ baseUrl: 'https://push', credentials, fetchImpl });
    assert.equal(await ia.report('m1', 'impression'), true);
    assert.equal(await ia.report('m1', 'hack'), false);
    const r = await ia.vote('p1', 'o1');
    assert.equal(r.totalVotes, 10);
    assert.equal(r.options[0].percent, 70);
    assert.deepEqual(JSON.parse(fetchImpl.calls[0].opts.body), { installationId: 'inst-1', event: 'impression' });
    assert.match(fetchImpl.calls[1].url, /\/api\/in-app\/messages\/p1\/vote$/);
  });
})().catch(e => { console.error(e); process.exit(1); });
