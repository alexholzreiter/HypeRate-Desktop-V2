const assert = require('node:assert/strict');
const { sendVisit, visitPayload, UMAMI_URL } = require('../src/usage-stats');

async function check(name, fn) {
  await fn();
  console.log('PASS ' + name);
}

(async () => {
  await check('nothing is sent unless the user switched it on', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, status: 200 }; };
    for (const enabled of [undefined, false, 'true', 1]) {
      assert.equal((await sendVisit({ enabled, fetchImpl })).sent, false);
    }
    assert.equal(calls, 0);
  });

  await check('when on, one visit of /desktop-app goes to the Umami endpoint', async () => {
    const seen = [];
    const fetchImpl = async (url, opts) => { seen.push({ url, opts }); return { ok: true, status: 200 }; };
    const res = await sendVisit({ enabled: true, language: 'de-DE', screen: '2560x1440', userAgent: 'UA', fetchImpl });
    assert.equal(res.sent, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, UMAMI_URL);
    const body = JSON.parse(seen[0].opts.body);
    assert.equal(body.payload.url, '/desktop-app');
    assert.equal(body.payload.language, 'de-DE');
    assert.equal(body.payload.screen, '2560x1440');
    assert.equal(seen[0].opts.headers['user-agent'], 'UA');
  });

  await check('the visit carries nothing about the user beyond language and screen', async () => {
    const keys = Object.keys(visitPayload({ language: 'en', screen: '1x1' }).payload).sort();
    assert.deepEqual(keys, ['hostname', 'language', 'referrer', 'screen', 'title', 'url', 'website']);
  });

  await check('a network error is swallowed, the app goes on', async () => {
    const res = await sendVisit({ enabled: true, fetchImpl: async () => { throw new Error('offline'); } });
    assert.equal(res.sent, false);
    assert.equal(res.reason, 'offline');
  });
})().catch(e => { console.error(e); process.exit(1); });
