// Runs user addons, each in its own hidden, sandboxed window.
//
// What keeps an addon in its box:
// - a sandboxed renderer with context isolation and no Node: it sees window.hyperate only
//   (src/addons/preload.js) and nothing of the app or the computer
// - its own session (persist:addon-<id>): own storage and cookies, no access to the app's
// - its code is served from hr-addon://<id>/ out of its own folder only
// - network: a content security policy in its page, plus every request of its session checked
//   here; only https to the hosts listed in its addon.json passes, all else is cancelled
// - no permissions (camera, microphone, location, web notifications …), no downloads, no new
//   windows, no navigation away
// - what it gets through window.hyperate is checked here against what the user approved
//
// Settings (settings.json): addonsEnabled (master switch, off by default) and
// addons: { <id>: { enabled, granted: { fingerprint, permissions, network } } }.

const fs = require('fs');
const path = require('path');
const { BrowserWindow, session, ipcMain, Notification, shell } = require('electron');
const { scan, needsApproval, settingValues, settingValue } = require('./manifest');

const LOG_LINES = 200;
const STORAGE_BYTES = 1024 * 1024;
const NOTIFY_EVERY_MS = 10 * 1000;
const EVENT_PERMISSION = { heartRate: 'heartRate', zone: 'zones', gameMoment: 'gameMoments' };
const FREE_EVENTS = ['settings'];   // its own settings: no permission needed

function createAddonHost({ root, dataDir, loadStore, saveStore, onChange = () => {}, appIcon }) {
  const running = new Map();   // id → { win, manifest, dir, subscribed:Set, lastNotify }
  const logs = new Map();      // id → [{ t, level, text }]
  const errors = new Map();    // id → text of the last crash or load failure
  const byContents = new Map();// webContents id → addon id

  const settings = () => { const s = loadStore(); return { master: s.addonsEnabled === true, addons: s.addons || {} }; };
  const saveAddon = (id, patch) => {
    const s = loadStore();
    s.addons = { ...(s.addons || {}), [id]: { ...((s.addons || {})[id] || {}), ...patch } };
    saveStore(s);
  };

  function log(id, level, text) {
    const list = logs.get(id) || [];
    const line = String(text).slice(0, 2000);
    const last = list[list.length - 1];
    // Chromium reports one blocked request two or three times; keep it as one line
    if (last && last.text === line && last.level === level && Date.now() - last.t < 2000) { last.repeat = (last.repeat || 1) + 1; onChange(); return; }
    list.push({ t: Date.now(), level, text: line });
    if (list.length > LOG_LINES) list.splice(0, list.length - LOG_LINES);
    logs.set(id, list);
    onChange();
  }

  // ── Serving the addon's own files, and nothing else ──
  function prepareSession(id, dir, manifest) {
    const ses = session.fromPartition('persist:addon-' + id);
    const own = `hr-addon://${id}/`;
    const hosts = manifest.network.map(h => 'https://' + h);
    const csp = [
      "default-src 'none'",
      `script-src ${own}`,
      `style-src ${own} 'unsafe-inline'`,
      `img-src ${own} data: ${hosts.join(' ')}`,
      `connect-src ${hosts.join(' ') || "'none'"}`,
    ].join('; ');
    if (ses.protocol.isProtocolHandled('hr-addon')) ses.protocol.unhandle('hr-addon');
    ses.protocol.handle('hr-addon', (request) => {
      const url = new URL(request.url);
      if (url.hostname !== id) return new Response('Not found', { status: 404 });
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${id}</title><script src="${own}main.js"></script>`,
          { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp } });
      }
      const file = path.resolve(dir, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
      const type = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
      return new Response(fs.readFileSync(file), { headers: { 'content-type': type, 'content-security-policy': csp } });
    });
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, done) => {
      let ok = false;
      try {
        const u = new URL(details.url);
        ok = details.url.startsWith(own) || u.protocol === 'devtools:'
          || (u.protocol === 'https:' && manifest.network.includes(u.hostname));
      } catch {}
      if (!ok) log(id, 'warn', `blocked: ${details.url.slice(0, 200)} (not in "network" of addon.json)`);
      done({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_, __, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
    return ses;
  }

  function start(entry) {
    const { manifest, dir } = entry;
    const id = manifest.id;
    stop(id);
    errors.delete(id);
    const ses = prepareSession(id, dir, manifest);
    const win = new BrowserWindow({
      show: false, width: 400, height: 300,
      webPreferences: {
        session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'), webviewTag: false, spellcheck: false,
        backgroundThrottling: false,
      },
    });
    const wc = win.webContents;
    byContents.set(wc.id, id);
    running.set(id, { win, manifest, dir, subscribed: new Set(), lastNotify: 0 });
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    // Electron 35+ passes one event object; older versions (event, level, message, …)
    wc.on('console-message', (event, oldLevel, oldMessage) => {
      const raw = event.level ?? oldLevel, message = event.message ?? oldMessage;
      const level = typeof raw === 'string' ? raw : ['debug', 'info', 'warning', 'error'][raw] || 'info';
      log(id, level === 'warning' ? 'warn' : level, message);
    });
    wc.on('render-process-gone', (_, details) => { errors.set(id, `stopped: ${details.reason}`); log(id, 'error', `stopped: ${details.reason}`); cleanup(id); });
    wc.on('unresponsive', () => { log(id, 'error', 'not responding, stopped'); errors.set(id, 'not responding'); stop(id); });
    wc.on('did-fail-load', (_, code, desc) => { errors.set(id, desc); log(id, 'error', `could not load: ${desc}`); });
    log(id, 'info', `started ${manifest.name} ${manifest.version}`);
    win.loadURL(`hr-addon://${id}/`);
    onChange();
  }

  function cleanup(id) {
    const r = running.get(id);
    if (!r) return;
    byContents.delete(r.win.webContents?.id);
    running.delete(id);
    onChange();
  }
  function stop(id) {
    const r = running.get(id);
    if (!r) return;
    cleanup(id);
    if (!r.win.isDestroyed()) r.win.destroy();
  }

  // ── What an addon may ask for ──
  const caller = (event) => {
    const id = byContents.get(event.sender.id);
    return id && running.has(id) ? running.get(id) : null;
  };
  ipcMain.on('addon-subscribe', (event, type) => {
    const r = caller(event);
    if (!r) return;
    if (FREE_EVENTS.includes(type)) { r.subscribed.add(type); return; }
    if (!EVENT_PERMISSION[type]) return;
    if (!r.manifest.permissions.includes(EVENT_PERMISSION[type])) { log(r.manifest.id, 'warn', `"${type}" needs the permission "${EVENT_PERMISSION[type]}" in addon.json`); return; }
    r.subscribed.add(type);
  });
  const storeFile = (id) => path.join(dataDir, id + '.json');
  const readStorage = (id) => { try { return JSON.parse(fs.readFileSync(storeFile(id), 'utf8')); } catch { return {}; } };
  ipcMain.handle('addon-storage-get', (event, key) => {
    const r = caller(event);
    if (!r || !r.manifest.permissions.includes('storage')) return undefined;
    return readStorage(r.manifest.id)[key];
  });
  ipcMain.handle('addon-storage-set', (event, key, value) => {
    const r = caller(event);
    if (!r || !r.manifest.permissions.includes('storage')) return false;
    const data = { ...readStorage(r.manifest.id), [key]: value };
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > STORAGE_BYTES) { log(r.manifest.id, 'warn', 'storage is full (1 MB)'); return false; }
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(storeFile(r.manifest.id), text);
    return true;
  });
  // Its own settings (from "settings" in addon.json), as the user set them in the app
  const valuesOf = (manifest) => settingValues(manifest, (settings().addons[manifest.id] || {}).values || {});
  ipcMain.handle('addon-settings-get', (event) => {
    const r = caller(event);
    return r ? valuesOf(r.manifest) : {};
  });
  ipcMain.handle('addon-notify', (event, title, body) => {
    const r = caller(event);
    if (!r || !r.manifest.permissions.includes('notifications') || !Notification.isSupported()) return false;
    if (Date.now() - r.lastNotify < NOTIFY_EVERY_MS) return false;   // one every 10 s at most
    r.lastNotify = Date.now();
    new Notification({ title: `${r.manifest.name}: ${title}`.slice(0, 120), body: body.slice(0, 400), icon: appIcon }).show();
    return true;
  });

  // ── What the app tells the addons ──
  function emit(type, data) {
    for (const r of running.values()) {
      if (r.subscribed.has(type) && !r.win.isDestroyed()) r.win.webContents.send('addon-event', { type, data });
    }
  }

  // ── For the settings window ──
  function list() {
    const { master, addons } = settings();
    return {
      master,
      root,
      addons: scan(root).map(entry => {
        const id = entry.manifest?.id;
        const saved = (id && addons[id]) || {};
        const lastError = id ? [...(logs.get(id) || [])].reverse().find(l => l.level === 'error') : null;
        return {
          folder: entry.folder,
          dir: entry.dir,
          error: entry.error || (id && errors.get(id)) || null,
          lastError: lastError ? lastError.text : null,
          manifest: entry.manifest,
          enabled: !!saved.enabled,
          approved: entry.manifest ? !needsApproval(entry.manifest, entry.fingerprint, saved.granted) : false,
          // what was allowed before, so a change can show what is new
          granted: saved.granted ? { permissions: saved.granted.permissions || [], network: saved.granted.network || [] } : null,
          values: entry.manifest ? valuesOf(entry.manifest) : {},
          fingerprint: entry.fingerprint,
          running: !!(id && running.has(id)),
          logCount: (id && logs.get(id)?.length) || 0,
        };
      }),
    };
  }

  // Start what is switched on and approved; stop what is not (or everything, master off)
  function sync() {
    const { master, addons } = settings();
    const wanted = new Set();
    if (master) {
      for (const entry of scan(root)) {
        const id = entry.manifest?.id;
        if (!id || entry.error) continue;
        const saved = addons[id] || {};
        if (!saved.enabled || needsApproval(entry.manifest, entry.fingerprint, saved.granted)) continue;
        wanted.add(id);
        const r = running.get(id);
        if (!r || r.dir !== entry.dir) start(entry);
      }
    }
    for (const id of [...running.keys()]) if (!wanted.has(id)) stop(id);
    onChange();
  }

  // Notice changes in the addons folder: an edited addon stops at once and waits for a new OK,
  // a new one shows up without pressing anything
  let watcher = null, watchTimer = null;
  function watch() {
    if (watcher) return;
    try {
      fs.mkdirSync(root, { recursive: true });
      watcher = fs.watch(root, { recursive: true }, () => {
        clearTimeout(watchTimer);
        watchTimer = setTimeout(sync, 400);
      });
      watcher.on('error', () => { watcher = null; });
    } catch { watcher = null; }   // no recursive watching (older Linux): rescanning still works
  }

  return {
    list,
    sync() { watch(); sync(); },
    emit,
    logs: (id) => logs.get(id) || [],
    setMaster(on) { const s = loadStore(); s.addonsEnabled = on === true; saveStore(s); sync(); return list(); },
    setEnabled(id, on) { saveAddon(id, { enabled: on === true }); sync(); return list(); },
    // The user saw exactly this version (fingerprint) with these permissions and said yes
    approve(id, print) {
      const entry = scan(root).find(e => e.manifest?.id === id);
      if (!entry || entry.fingerprint !== print) return list();   // it changed meanwhile: show again
      saveAddon(id, { enabled: true, granted: { fingerprint: print, permissions: entry.manifest.permissions, network: entry.manifest.network } });
      sync();
      return list();
    },
    reload(id) { if (id) stop(id); sync(); return list(); },
    // One setting changed in the app: kept within what it allows, saved, told to the addon
    setValue(id, key, value) {
      const entry = scan(root).find(e => e.manifest?.id === id);
      const setting = entry?.manifest.settings.find(st => st.key === key);
      if (!setting) return list();
      const saved = (settings().addons[id] || {}).values || {};
      saveAddon(id, { values: { ...saved, [key]: settingValue(setting, value) } });
      const r = running.get(id);
      if (r?.subscribed.has('settings') && !r.win.isDestroyed()) r.win.webContents.send('addon-event', { type: 'settings', data: valuesOf(entry.manifest) });
      return list();
    },
    // Stops the addon, moves its folder to the trash (so a mistake can be undone there) and
    // forgets its storage and approval. Works for broken addons too, by folder name.
    async remove(folder) {
      const entry = scan(root).find(e => e.folder === folder);
      if (!entry) return list();
      const id = entry.manifest?.id;
      if (id) {
        stop(id);
        logs.delete(id); errors.delete(id);
        try { fs.unlinkSync(storeFile(id)); } catch {}
        const s = loadStore();
        if (s.addons?.[id]) { delete s.addons[id]; saveStore(s); }
      }
      try { await shell.trashItem(entry.dir); }
      catch { fs.rmSync(entry.dir, { recursive: true, force: true }); }   // no trash (some Linux desktops)
      sync();
      return list();
    },
    stopAll() { watcher?.close(); watcher = null; for (const id of [...running.keys()]) stop(id); },
  };
}

module.exports = { createAddonHost };
