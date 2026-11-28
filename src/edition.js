// Which build of the app this is. The v2 line ships as a beta next to the current release,
// so it needs its own name and Windows app ID: that gives it its own settings folder,
// its own taskbar entry and its own login item, and an installed v1 stays untouched.
// A prerelease version ("2.0.0-beta.1") is what marks the beta; the stable release drops it.

const pkg = require('../package.json');

const isBeta = /-beta\b/.test(pkg.version);

// Where this build is handed out. The Steam build is made with
//   npm run build:steam   (electron-builder.steam.js sets hyperateDistribution=steam)
// and gets its updates from Steam alone; everything else is the free GitHub build, which looks
// for new releases on GitHub. HYPERATE_DISTRIBUTION=steam tries the Steam behaviour in a dev run.
const distribution = pkg.hyperateDistribution === 'steam' || process.env.HYPERATE_DISTRIBUTION === 'steam' ? 'steam' : 'github';

module.exports = {
  isBeta,
  distribution,
  isSteam: distribution === 'steam',
  version: pkg.version,
  name: isBeta ? 'HypeRate Desktop Beta' : 'HypeRate Desktop',
  appId: isBeta ? 'io.hyperate.desktop.beta' : 'io.hyperate.desktop',
};
