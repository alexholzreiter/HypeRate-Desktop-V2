// Installed font family names for the "System font" autocomplete.
// Electron has no API for this, so each platform asks the OS directly.

const { execFile } = require('child_process');

const COMMANDS = {
  darwin: ['osascript', ['-l', 'JavaScript', '-e',
    "ObjC.import('AppKit'); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))"]],
  win32: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; ' +
    '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }']],
  linux: ['fc-list', [':', 'family']],
};

function parse(platform, stdout) {
  if (platform === 'darwin') return JSON.parse(stdout);
  return stdout.split(/\r?\n/)
    // fc-list prints "Family,Localized Family" and escapes some characters ("\-")
    .map(line => (platform === 'linux' ? line.split(',')[0].replace(/\\(.)/g, '$1') : line).trim());
}

let cached = null;

function list() {
  if (cached) return cached;
  const cmd = COMMANDS[process.platform];
  if (!cmd) return Promise.resolve([]);
  cached = new Promise((resolve) => {
    execFile(cmd[0], cmd[1], { timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (err) {
        console.error('[Fonts] listing failed:', err.message);
        cached = null; // try again next time
        return resolve([]);
      }
      try {
        const names = parse(process.platform, stdout)
          .filter(name => name && !name.startsWith('.')); // hidden macOS UI fonts
        resolve([...new Set(names)].sort((a, b) => a.localeCompare(b)));
      } catch (e) {
        console.error('[Fonts] parsing failed:', e.message);
        resolve([]);
      }
    });
  });
  return cached;
}

module.exports = { list };
