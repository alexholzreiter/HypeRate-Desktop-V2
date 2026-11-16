const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { fetchLatestRelease } = require('../src/desktop-update');

const api = 'https://api.github.com/repos/alexholzreiter/HypeRate-Desktop-V2/releases/latest';
const newReleasePage = 'https://github.com/HypeRate/HypeRate-Desktop-V2/releases/tag/v1.0.14';

async function check(name, responses, version, expected, urls) {
  const originalGet = https.get;
  const requests = [];
  https.get = (url, options, onResponse) => {
    assert.equal(options.headers['User-Agent'], 'HypeRate-Overlay/' + version);
    const fixture = responses[requests.length];
    assert.ok(fixture, 'Unexpected request: ' + url);
    requests.push(url.href);
    const request = new EventEmitter();
    request.setTimeout = () => {};
    process.nextTick(() => {
      const response = Readable.from([fixture.body || '']);
      response.statusCode = fixture.code;
      response.headers = { location: fixture.location };
      onResponse(response);
    });
    return request;
  };
  try {
    assert.deepEqual(await fetchLatestRelease(version), expected);
    assert.deepEqual(requests, urls);
    console.log('PASS ' + name);
  } finally {
    https.get = originalGet;
  }
}

async function run() {
  const release = { code: 200, body: JSON.stringify({ tag_name: 'v1.0.14', html_url: newReleasePage }) };
  const update = { hasUpdate: true, latestVersion: '1.0.14', downloadUrl: newReleasePage };
  await check('reports a newer release before the transfer', [release], '1.0.13', update, [api]);
  await check('follows absolute and relative GitHub redirects after a transfer', [
    { code: 301, location: 'https://api.github.com/repositories/42/releases/latest' },
    { code: 307, location: '/repos/HypeRate/HypeRate-Desktop-V2/releases/latest' },
    release,
  ], '1.0.13', update, [
    api,
    'https://api.github.com/repositories/42/releases/latest',
    'https://api.github.com/repos/HypeRate/HypeRate-Desktop-V2/releases/latest',
  ]);
  await check('does not report an update at the installed version', [release], '1.0.14',
    { ...update, hasUpdate: false }, [api]);
  await check('does not follow a redirect outside the GitHub API',
    [{ code: 301, location: 'https://example.com/releases/latest' }], '1.0.13', { hasUpdate: false }, [api]);
  await check('stops following a redirect loop',
    Array(6).fill({ code: 301, location: api }), '1.0.13', { hasUpdate: false }, Array(6).fill(api));
  await check('handles an unsuccessful GitHub response', [{ ...release, code: 404 }],
    '1.0.13', { hasUpdate: false }, [api]);
}

run().catch(error => {
  console.error('FAIL', error);
  process.exitCode = 1;
});
