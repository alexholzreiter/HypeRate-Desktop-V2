// The Steam build: the same app as package.json "build", plus steamworks.js and the Steam
// flavour (no own update check, src/steam.js switched on). The GitHub build leaves
// steamworks.js out (see "files" in package.json).
//
//   npm run build:steam            unpacked app for this computer in dist-steam/
//   npm run build:steam -- --win   the Windows app (dist-steam/win-unpacked)
//   npm run build:steam -- --mac --universal   one Mac app for Intel and Apple silicon
//
// The upload to Steam goes through the Steamworks SDK's ContentBuilder, see steam/README.md.
const base = require('./package.json').build;

const LEAVE_OUT_STEAM = '!node_modules/steamworks.js/**/*';

module.exports = {
  ...base,
  directories: { ...base.directories, output: 'dist-steam' },
  extraMetadata: { hyperateDistribution: 'steam' },
  files: base.files.filter((pattern) => pattern !== LEAVE_OUT_STEAM).concat('!dist-steam/**/*'),
  // the native module and Steam's library next to it must stay real files outside app.asar
  asarUnpack: [...(base.asarUnpack || []), 'node_modules/steamworks.js/dist/**/*'],
  // Steam installs and updates the app; no installer, no dmg
  win: { ...base.win, target: 'dir' },
  mac: { ...base.mac, target: 'dir' },
  linux: { ...base.linux, target: 'dir' },
};
