// A throwaway certificate for the fake Live Client Data server. Riot's API is HTTPS with a
// self-signed certificate, so the test server needs one too. It is generated on demand and
// cached in the system temp folder, so no private key has to live in this repository.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function selfSigned() {
  const dir  = path.join(os.tmpdir(), 'hyperate-test-cert');
  const key  = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-keyout', key, '-out', cert, '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

module.exports = { selfSigned };
