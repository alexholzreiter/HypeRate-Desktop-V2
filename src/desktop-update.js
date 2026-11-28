const https = require('https');

const RELEASE_API = new URL(
  'https://api.github.com/repos/HypeRate/HypeRate-Desktop/releases/latest',
);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function requestRelease(url, version, redirectsLeft) {
  return new Promise((resolve) => {
    const request = https.get(url, { headers: { 'User-Agent': 'HypeRate-Overlay/' + version } }, (response) => {
      response.on('error', () => resolve(null));
      if (REDIRECT_CODES.has(response.statusCode)) {
        response.resume();
        const location = response.headers.location;
        const next = location && URL.canParse(location, url) ? new URL(location, url) : null;
        // GitHub can redirect a transferred repository to a path that uses its numeric ID.
        if (redirectsLeft > 0 && next?.origin === RELEASE_API.origin) {
          resolve(requestRelease(next, version, redirectsLeft - 1));
        } else {
          resolve(null);
        }
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        resolve(null);
        return;
      }
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    request.on('error', () => resolve(null));
    request.setTimeout(6000, () => {
      request.destroy();
      resolve(null);
    });
  });
}

// The list of releases, prereleases included (newest first); only a beta asks for it.
const RELEASES_API = new URL(
  'https://api.github.com/repos/HypeRate/HypeRate-Desktop/releases?per_page=20',
);

// A stable install asks for /releases/latest, which skips prereleases, so v1 users are never
// offered a beta. A beta asks for the whole list and takes the newest release of any kind:
// a newer beta, or the stable release once it is out.
async function fetchLatestRelease(version, { prereleases = false } = {}) {
  let release;
  if (prereleases) {
    const list = await requestRelease(RELEASES_API, version, MAX_REDIRECTS);
    release = (Array.isArray(list) ? list : [])
      .filter(r => r && !r.draft && typeof r.tag_name === 'string' && parseVersion(tagVersion(r.tag_name)))
      .sort((a, b) => compareVersions(tagVersion(b.tag_name), tagVersion(a.tag_name)))[0];
  } else {
    release = await requestRelease(RELEASE_API, version, MAX_REDIRECTS);
  }
  const latest = typeof release?.tag_name === 'string' ? tagVersion(release.tag_name) : '';
  if (!latest || !parseVersion(latest)) return { hasUpdate: false };
  return {
    hasUpdate: isNewer(latest, version),
    latestVersion: latest,
    downloadUrl: release.html_url || '',
  };
}

const tagVersion = (tag) => tag.replace(/^v/, '');

// "2.0.0-beta.3" → { core: [2, 0, 0], pre: ['beta', 3] }; null when it is not a version
function parseVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(String(text).trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.').map(p => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

// Semantic versioning order: 1.9.9 < 2.0.0-beta.1 < 2.0.0-beta.2 < 2.0.0-rc.1 < 2.0.0
function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;   // the release beats its prereleases
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    if (typeof p === 'number') return -1;   // numbers sort before words
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const isNewer = (latest, current) => compareVersions(latest, current) > 0;

module.exports = { fetchLatestRelease, compareVersions };
