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

async function fetchLatestRelease(version) {
  const release = await requestRelease(RELEASE_API, version, MAX_REDIRECTS);
  const latest = typeof release?.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
  if (!latest) return { hasUpdate: false };
  return {
    hasUpdate: isNewer(latest, version),
    latestVersion: latest,
    downloadUrl: release.html_url || '',
  };
}

function isNewer(latest, current) {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (latestParts[i] || 0) - (currentParts[i] || 0);
    if (difference) return difference > 0;
  }
  return false;
}

module.exports = { fetchLatestRelease };
