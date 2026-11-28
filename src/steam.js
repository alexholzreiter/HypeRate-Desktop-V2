// Steam, for the Steam build only (edition.isSteam). The GitHub build never loads steamworks.js
// and does not even ship it (electron-builder.steam.js is the only config that packs it).
//
// Until Valve gives us our own App ID, everything runs against Spacewar (480), the test app
// every Steam account has: the Steam client must be running and logged in, and HypeRate shows up
// as "Spacewar" while it runs. Four achievements and two stats then go to Spacewar's test ones.
// Once the App ID is known: put it in APP_ID, name the achievements in the Steamworks portal the
// way src/achievements.js and steam/achievements/achievements.json say, and a packaged build will only run when started through Steam.

const edition = require('./edition');
const { createAchievements } = require('./achievements');

/** Our App ID from Valve; null until the partner review is done. */
const APP_ID = null;
const TEST_APP_ID = 480;

// While we test with Spacewar (480) a few of ours go to its four test achievements and two of
// its stats, so unlocking and counting can be tried for real; the others are only logged.
const TEST_ACHIEVEMENTS = {
  FIRST_HEARTBEAT: 'ACH_WIN_ONE_GAME', FIRST_OVERLAY: 'ACH_WIN_100_GAMES',
  BLE_DIRECT: 'ACH_TRAVEL_FAR_ACCUM', FIRST_MOMENT: 'ACH_TRAVEL_FAR_SINGLE',
};
const TEST_STATS = { stat_sessions: 'NumGames', stat_minutes: 'NumWins' };

let client = null;
let state = { state: 'off' };
let tracker = null;   // src/achievements.js, once Steam is there

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
    tracker = createAchievements(steamStore());
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

// What src/achievements.js needs from Steam
function steamStore() {
  const name = (api) => (APP_ID ? api : TEST_ACHIEVEMENTS[api] || null);
  const stat = (api) => (APP_ID ? api : TEST_STATS[api] || null);
  return {
    unlock(api) {
      const real = name(api);
      if (!real) { console.log(`[steam] achievement ${api} (no Spacewar stand-in)`); return false; }
      try {
        if (client.achievement.isActivated(real)) return false;
        const ok = client.achievement.activate(real);
        client.stats.store();
        console.log(`[steam] achievement ${api}${real !== api ? ` (${real})` : ''} ${ok ? 'unlocked' : 'not unlocked'}`);
        return ok;
      } catch (error) {
        console.error(`[steam] achievement ${api} failed:`, error?.message || error);
        return false;
      }
    },
    getStat(api) {
      const real = stat(api);
      try { return real ? client.stats.getInt(real) : null; } catch { return null; }
    },
    setStat(api, value) {
      const real = stat(api);
      try { if (real) client.stats.setInt(real, value); } catch (error) { console.error(`[steam] stat ${api} failed:`, error?.message || error); }
    },
    save() {
      try { client.stats.store(); } catch {}
    },
  };
}

// What main.js reports; nothing happens outside the Steam build or without Steam
const heartbeat = (bpm, source) => tracker?.heartbeat(bpm, source);
const moment = (m) => tracker?.moment(m);
const event = (name) => tracker?.event(name);
const flush = () => tracker?.flush();

/** For trying it out with Spacewar only: takes the test achievements and stats back. */
function resetTestAchievements() {
  if (!client || APP_ID) return false;
  try { return client.stats.resetAll(true); } catch { return false; }
}

module.exports = { start, mustQuit, info, heartbeat, moment, event, flush, resetTestAchievements };
