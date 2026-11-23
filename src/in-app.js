// In-app messages from HypeRate's push service (hyperate-push): announcements and polls shown
// inside the app window, as on the phone apps. The server picks the one message for this
// installation (audience, start/end, how often) and keeps count of what it was told: shown,
// clicked, dismissed, voted.
//
//   GET  /api/in-app/messages?installationId=…&features=poll  → { success, message | null }
//   POST /api/in-app/messages/<id>/event  { installationId, event: impression|click|dismiss }
//   POST /api/in-app/messages/<id>/vote   { installationId, optionId } → { success, results }
//
// Images are fetched here and handed to the window as data URLs, so the window needs no
// exception for outside servers in its content security policy.

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp)$/i;   // no SVG: it could carry script

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Only what the window needs, in safe sizes; anything else from the server is dropped
function cleanMessage(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const type = raw.type === 'poll' ? 'poll' : 'message';
  const options = type === 'poll' && Array.isArray(raw.options)
    ? raw.options.filter(o => o && typeof o.id === 'string' && typeof o.label === 'string')
      .slice(0, 6).map(o => ({ id: o.id.slice(0, 20), label: text(o.label, 80) }))
    : [];
  if (type === 'poll' && options.length < 2) return null;
  const link = text(raw.deepLink, 2000);
  return {
    id: raw.id.slice(0, 64),
    type,
    title: text(raw.title, 200),
    body: text(raw.body, 2000),
    ctaText: text(raw.ctaText, 60),
    // https links open in the browser; app screens of the phone apps mean nothing here
    link: /^https:\/\//i.test(link) ? link : '',
    imageUrl: /^https:\/\//i.test(raw.imageUrl || '') ? raw.imageUrl : '',
    options,
  };
}

function createInApp({ baseUrl, credentials, fetchImpl = fetch }) {
  async function getJson(url, opts) {
    const res = await fetchImpl(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function image(url) {
    if (!url) return null;
    try {
      const res = await fetchImpl(url);
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!res.ok || !IMAGE_TYPES.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch { return null; }
  }

  return {
    async fetchMessage() {
      const { installationId } = await credentials();
      const url = `${baseUrl}/api/in-app/messages?installationId=${encodeURIComponent(installationId)}&features=poll`;
      const result = await getJson(url);
      const message = cleanMessage(result?.message);
      if (!message) return null;
      // https, or the push service's own assets (a local stand-in in development runs)
      const raw = String(result.message.imageUrl || '');
      message.image = await image(message.imageUrl || (raw.startsWith(baseUrl + '/') ? raw : ''));
      delete message.imageUrl;
      return message;
    },
    async report(id, event) {
      if (!['impression', 'click', 'dismiss'].includes(event)) return false;
      const { installationId } = await credentials();
      const res = await fetchImpl(`${baseUrl}/api/in-app/messages/${encodeURIComponent(id)}/event`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId, event }),
      });
      return res.ok;
    },
    async vote(id, optionId) {
      const { installationId } = await credentials();
      const result = await getJson(`${baseUrl}/api/in-app/messages/${encodeURIComponent(id)}/vote`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installationId, optionId }),
      });
      const r = result?.results;
      if (!r || !Array.isArray(r.options)) return null;
      return {
        totalVotes: Number(r.totalVotes) || 0,
        options: r.options.map(o => ({ id: String(o.id), label: text(o.label, 80), percent: Math.max(0, Math.min(100, Number(o.percent) || 0)) })),
      };
    },
  };
}

module.exports = { createInApp, cleanMessage };
