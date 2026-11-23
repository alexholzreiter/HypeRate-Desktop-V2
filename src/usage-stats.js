// Anonymous usage count through HypeRate's own Umami instance. Only when the user switched it
// on (off by default). One visit per start, the same one the previous settings window sent from
// a script tag: page /desktop-app, the app language and the screen size. Umami works out the
// country from the connection and keeps neither the IP address nor a cookie.

const UMAMI_URL = 'https://analytics.hyperate.io/api/send';
const WEBSITE_ID = '162f0736-6b4b-43e9-8123-3842c76deb37';

function visitPayload({ language, screen }) {
  return {
    type: 'event',
    payload: {
      website: WEBSITE_ID,
      hostname: 'desktop-app',
      url: '/desktop-app',
      title: 'HypeRate Desktop',
      referrer: '',
      language: String(language || 'en'),
      screen: String(screen || ''),
    },
  };
}

// fetchImpl and userAgent come from the caller so this stays testable without Electron
async function sendVisit({ enabled, language, screen, userAgent, fetchImpl = fetch }) {
  if (enabled !== true) return { sent: false, reason: 'off' };
  try {
    const res = await fetchImpl(UMAMI_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': userAgent || 'HypeRate Desktop' },
      body: JSON.stringify(visitPayload({ language, screen })),
    });
    return { sent: res.ok, status: res.status };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

module.exports = { sendVisit, visitPayload, UMAMI_URL };
