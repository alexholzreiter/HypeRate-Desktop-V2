// Steam, for the Steam build only (edition.isSteam). The GitHub build never loads steamworks.js
// and does not even ship it (electron-builder.steam.js is the only config that packs it).
//
// Until Valve gives us our own App ID, everything runs against Spacewar (480), the test app
// every Steam account has: the Steam client must be running and logged in, and HypeRate shows up
// as "Spacewar" while it runs. Achievements then go to Spacewar's test achievements.
// Once the App ID is known: put it in APP_ID, name the achievements in the Steamworks portal the
// way ACHIEVEMENTS says, and a packaged build will only run when started through Steam.

const edition = require('./edition');

/** Our App ID from Valve; null until the partner review is done. */
const APP_ID = null;
const TEST_APP_ID = 480;

// Our name for an achievement → its API name in the Steamworks portal, and the Spacewar one that
// stands in for it while we test with 480.
const ACHIEVEMENTS = {
  first_heartbeat: { api: 'FIRST_HEARTBEAT', test: 'ACH_WIN_ONE_GAME' },
  first_overlay: { api: 'FIRST_OVERLAY', test: 'ACH_WIN_100_GAMES' },
};

let client = null;
let state = { state: 'off' };
const unlocked = new Set();

const appId = () => APP_ID || TEST_APP_ID;

/**
 * Called first thing in main.js, before the app is ready. Returns 'quit' when Steam is going to
 * start the app itself (a packaged build started without Steam), otherwise 'go'.
 */
function start({ packaged }) {
  if (!edition.isSteam) return 'go';
  let steamworks;
  try {
    steamworks = require('steamworks.js');
  } catch (error) {
    state = { state: 'missing', error: String(error?.message || error) };
    console.error('[steam] steamworks.js not available:', state.error);
    return 'go';
  }
  // Started by double click instead of through Steam: Steam starts it again, the right way
  if (packaged && APP_ID) {
    try {
      if (steamworks.restartAppIfNecessary(APP_ID)) return 'quit';
    } catch (error) {
      console.error('[steam] restart check failed:', error?.message || error);
    }
  }
  try {
    client = steamworks.init(appId());
    const id = client.localplayer.getSteamId();
    state = {
      state: 'ready',
      appId: appId(),
      testApp: !APP_ID,
      name: client.localplayer.getName(),
      steamId: String(id.steamId64),
      language: client.apps.currentGameLanguage(),
      beta: client.apps.currentBetaName() || null,
      buildId: client.apps.appBuildId(),
    };
    console.log(`[steam] ready, app ${state.appId}${state.testApp ? ' (Spacewar test app)' : ''}`);
  } catch (error) {
    client = null;
    state = { state: 'unavailable', appId: appId(), error: String(error?.message || error) };
    console.error('[steam] init failed:', state.error);
  }
  return 'go';
}

/** A packaged build with our own App ID must not run without Steam (it is a paid app). */
function mustQuit({ packaged }) {
  return edition.isSteam && packaged && !!APP_ID && state.state !== 'ready';
}

/** What the settings page shows. */
function info() {
  return edition.isSteam ? state : null;
}

/** Unlocks an achievement once; does nothing outside Steam or when it is already unlocked. */
function unlock(name) {
  if (!client || unlocked.has(name)) return false;
  const entry = ACHIEVEMENTS[name];
  if (!entry) return false;
  const api = APP_ID ? entry.api : entry.test;
  unlocked.add(name);
  try {
    if (client.achievement.isActivated(api)) return false;
    const ok = client.achievement.activate(api);
    client.stats.store();
    console.log(`[steam] achievement ${name} (${api}) ${ok ? 'unlocked' : 'not unlocked'}`);
    return ok;
  } catch (error) {
    console.error(`[steam] achievement ${name} failed:`, error?.message || error);
    return false;
  }
}

/** For trying it out with Spacewar only: takes our test achievements back. */
function resetTestAchievements() {
  if (!client || APP_ID) return false;
  for (const entry of Object.values(ACHIEVEMENTS)) {
    try { client.achievement.clear(entry.test); } catch {}
  }
  unlocked.clear();
  try { return client.stats.store(); } catch { return false; }
}

module.exports = { start, mustQuit, info, unlock, resetTestAchievements, ACHIEVEMENTS };
