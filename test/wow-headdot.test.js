// Das Lämpchen im Kopf der WoW-Karte fasst zwei getrennte Funktionen zusammen: den Puls an
// HypeRaid und die Kampfergebnisse. Bis 1.0.13 kannte es nur die Kampfergebnisse, ein Puls
// allein ließ den Kopf dunkel. Die Funktion steckt in der Oberfläche, also wird sie hier
// herausgeschnitten und in einer nachgebauten Umgebung ausgeführt.
const fs = require('fs');
const os = require('os');
const path = require('path');

const checks = []; const check = (n, ok, i='') => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : `→ ${i}`); };

const HTML = path.join(__dirname, '..', 'src', 'windows', 'settings', 'index.html');
const quelle = fs.readFileSync(HTML, 'utf8');
const stueck = quelle.match(/ {2}const HYPERAID_DOT[\s\S]*?\n {2}}\n/)?.[0];
if (!stueck || !stueck.includes('function syncWowHeadDot')) {
  console.log('FAIL konnte syncWowHeadDot nicht aus der Oberfläche lesen');
  process.exit(1);
}

// Als echte Datei laden statt auszuwerten, damit hier nichts aus einem String heraus läuft
const datei = path.join(os.tmpdir(), `hyperate-headdot-${process.pid}.js`);
fs.writeFileSync(datei, `module.exports = function (umgebung) {
  const { cb, $, syncHeadDot, hyperaidState } = umgebung;
${stueck}
  return syncWowHeadDot;
};
`);
const bauen = require(datei);
fs.unlinkSync(datei);

// Nachbau: zwei Schalter, der innere Punkt der Kampfergebnisse, ein mitgeschriebenes Ergebnis
function umgebung({ hyperaid = false, wow = false, hyperaidState = 'off', wowDot = '' } = {}) {
  const zustand = { state: hyperaidState };
  let ergebnis = null;
  const sync = bauen({
    cb: (id) => (id === 'hyperaidEnabled' ? hyperaid : wow),
    $: () => ({ classList: wowDot ? ['dot', wowDot] : ['dot'] }),
    syncHeadDot: (_id, klasse, sichtbar) => { ergebnis = { klasse: klasse || '', sichtbar }; },
    hyperaidState: zustand,
  });
  sync();
  return ergebnis;
}

{
  const r = umgebung({ hyperaid: true, hyperaidState: 'writing' });
  check('ein Puls an HypeRaid lässt den Kopf grün blinken, auch ohne Kampfergebnisse',
    r.sichtbar && r.klasse === 'connected', JSON.stringify(r));
}
{
  const r = umgebung({ hyperaid: true, hyperaidState: 'waiting' });
  check('HypeRaid an, aber noch kein Puls: das Lämpchen ist sichtbar und wartet',
    r.sichtbar && r.klasse === 'connecting', JSON.stringify(r));
}
{
  const r = umgebung({ hyperaid: true, hyperaidState: 'error' });
  check('ein Fehler beim Schreiben wird oben rot gezeigt',
    r.sichtbar && r.klasse === 'error', JSON.stringify(r));
}
{
  const r = umgebung();
  check('beides aus: kein Lämpchen', !r.sichtbar, JSON.stringify(r));
}
{
  const r = umgebung({ wow: true, wowDot: 'connected' });
  check('ohne HypeRaid zeigt der Kopf weiter die Kampfergebnisse',
    r.sichtbar && r.klasse === 'connected', JSON.stringify(r));
}
{
  const r = umgebung({ hyperaid: true, hyperaidState: 'writing', wow: true, wowDot: 'connecting' });
  check('laufender Puls schlägt wartende Kampfergebnisse',
    r.klasse === 'connected', JSON.stringify(r));
}
{
  const r = umgebung({ hyperaid: true, hyperaidState: 'folder', wow: true, wowDot: 'connected' });
  check('ein unfertiges HypeRaid dunkelt die laufenden Kampfergebnisse nicht ab',
    r.klasse === 'connected', JSON.stringify(r));
}
{
  const r = umgebung({ hyperaid: true, hyperaidState: 'off', wow: false });
  check('HypeRaid gerade erst eingeschaltet: Lämpchen da, noch ohne Farbe',
    r.sichtbar && r.klasse === '', JSON.stringify(r));
}

process.exit(checks.includes(false) ? 1 : 0);
