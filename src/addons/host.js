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
// - Discord, VRChat and Home Assistant only through the app's own connections (`bridge`), with
//   their permission, only while the user has that integration on, and only so often
// - with the "overlay" permission, overlay.html shows in a window of its own next to the
//   overlay: same session and rules, shown only while the overlay is. Like the heart rate
//   widget it lets the mouse through, except while the pointer is over it: then it can be
//   dragged, and where it is put is remembered
//
// Settings (settings.json): addonsEnabled (master switch, off by default) and
// addons: { <id>: { enabled, granted: { fingerprint, permissions, network }, values,
//   overlay: { on, scale, x, y } } }.

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session, ipcMain, Notification, shell, screen } = require('electron');
const { scan, needsApproval, settingValues, settingValue } = require('./manifest');

const LOG_LINES = 200;
const STORAGE_BYTES = 1024 * 1024;
const NOTIFY_EVERY_MS = 10 * 1000;
const EVENT_PERMISSION = { heartRate: 'heartRate', zone: 'zones', gameMoment: 'gameMoments' };
const FREE_EVENTS = ['settings', 'message'];   // its own settings and its own messages: no permission needed
const MESSAGE_BYTES = 64 * 1024;
// What an addon may send through the app's integrations, and how often (per addon)
const BRIDGE = {
  discordStatus:      { permission: 'discord',       max: 1,  per: 5000 },   // Discord itself takes one update per 15 s
  vrchatChatbox:      { permission: 'vrchat',        max: 1,  per: 2000 },   // VRChat's own chatbox limit
  vrchatParameter:    { permission: 'vrchat',        max: 20, per: 1000 },
  homeAssistantEvent: { permission: 'homeAssistant', max: 5,  per: 1000 },
};
const LINUX = process.platform === 'linux';
const WINDOW_SHARE = 1 / 3;          // an overlay window covers at most this much of its screen
const CPU_LIMIT = 40;                // percent of one core, for all windows of one addon together
const CPU_SAMPLES = 6;               // … this many checks in a row (5 s apart) and it is stopped
const OVERLAY_SCALES = [50, 75, 100, 125, 150, 200];

// overlayInfo(): { allSpaces, anchor } – how the overlay is set up and where it is (its bounds),
// so a new addon window can start next to it
// cpu: { limit, samples, every } overrides the processor check (for tests)
// bridge: { discordStatus(text), vrchatChatbox(text), vrchatParameter(name, value),
//   homeAssistantEvent(addonId, name, data) }, each returning { ok, reason }: the app's integrations
function createAddonHost({ root, dataDir, loadStore, saveStore, onChange = () => {}, appIcon, overlayInfo = () => ({}), cpu: cpuCheck = {}, bridge = {}, zoneFor = () => null, tampered = () => false, onTampered = () => {} }) {
  const CPU = { limit: CPU_LIMIT, samples: CPU_SAMPLES, every: 5000, ...cpuCheck };
  const running = new Map();   // id → { win, overlay, manifest, dir, subs: Map(webContents id → Set), lastNotify }
  const logs = new Map();      // id → [{ t, level, text }]
  const errors = new Map();    // id → text of the last crash or load failure
  const byContents = new Map();// webContents id → addon id
  const halted = new Set();    // ids stopped for crashing, hanging or using too much CPU: wait for the user
  const limits = new Map();    // id → Map(kind:detail → { kind, detail, count, at }): what it tried that is not possible

  // Something the addon wanted but may not or cannot do: logged, and kept for its page, where
  // the user sees it in plain words with a way to hand it to the AI or wish for it
  function limit(id, kind, detail = '') {
    if (!limits.has(id)) limits.set(id, new Map());
    const key = kind + ':' + detail;
    const seen = limits.get(id).get(key);
    if (seen) { seen.count++; seen.at = Date.now(); return; }
    if (limits.get(id).size >= 20) return;
    limits.get(id).set(key, { kind, detail: String(detail).slice(0, 200), count: 1, at: Date.now() });
    onChange();
  }
  // What a blocked request or a Content Security Policy message means
  function cspLimit(id, message) {
    if (!/Content Security Policy/i.test(message)) return;
    if (/inline/i.test(message)) return limit(id, 'inline');
    // the address comes quoted ('https://…') or plain ("cannot load https://….")
    const url = (message.match(/(?:'|\s)((?:https?|wss?|file|data|blob):[^'\s]*?)\.?(?:'|\s|$)/) || [])[1];
    if (!url) return limit(id, 'source');
    try {
      const u = new URL(url);
      limit(id, u.protocol === 'https:' ? 'network' : 'protocol', u.protocol === 'https:' ? u.hostname : u.protocol.replace(':', ''));
    } catch { limit(id, 'source'); }
  }

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
      `font-src ${own}`,
      `media-src ${manifest.permissions.includes('sound') ? own + ' data: blob:' : "'none'"}`,
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
      const type = { '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(file)] || 'application/octet-stream';
      return new Response(fs.readFileSync(file), { headers: { 'content-type': type, 'content-security-policy': csp } });
    });
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, done) => {
      let ok = false;
      try {
        const u = new URL(details.url);
        ok = details.url.startsWith(own) || u.protocol === 'devtools:'
          || (u.protocol === 'https:' && manifest.network.includes(u.hostname));
      } catch {}
      if (!ok) {
        log(id, 'warn', `blocked: ${details.url.slice(0, 200)} (not in "network" of addon.json)`);
        try { const u = new URL(details.url); limit(id, u.protocol === 'https:' ? 'network' : 'protocol', u.protocol === 'https:' ? u.hostname : u.protocol.replace(':', '')); } catch {}
      }
      done({ cancel: !ok });
    });
    ses.setPermissionRequestHandler((_, __, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault());
    return ses;
  }

  const webPreferences = (ses) => ({
    session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(__dirname, 'preload.js'), webviewTag: false, spellcheck: false,
    backgroundThrottling: false,
    autoplayPolicy: 'no-user-gesture-required',   // nobody clicks a hidden window; sound needs the "sound" permission
  });

  // The same rules for the hidden window and the overlay window of an addon
  function guard(wc, id, tag) {
    byContents.set(wc.id, id);
    // Web Audio needs no file, so the CSP alone would not keep an addon quiet: mute it
    const r = running.get(id);
    wc.setAudioMuted(!r?.manifest.permissions.includes('sound'));
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    // Electron 35+ passes one event object; older versions (event, level, message, …)
    wc.on('console-message', (event, oldLevel, oldMessage) => {
      const raw = event.level ?? oldLevel, message = event.message ?? oldMessage;
      const level = typeof raw === 'string' ? raw : ['debug', 'info', 'warning', 'error'][raw] || 'info';
      log(id, level === 'warning' ? 'warn' : level, tag + message);
      cspLimit(id, String(message));
    });
    wc.on('did-fail-load', (_, code, desc) => { errors.set(id, tag + desc); log(id, 'error', `${tag}could not load: ${desc}`); });
  }

  function start(entry) {
    const { manifest, dir } = entry;
    const id = manifest.id;
    stop(id);
    errors.delete(id);
    limits.delete(id);   // a new start: what it ran into before may be fixed
    const ses = prepareSession(id, dir, manifest);
    const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: webPreferences(ses) });
    const wc = win.webContents;
    const r = { win, overlay: null, manifest, dir, ses, subs: new Map(), lastNotify: 0 };
    running.set(id, r);
    guard(wc, id, '');
    wc.on('render-process-gone', (_, details) => { log(id, 'error', `stopped: ${details.reason}`); stop(id); halt(id, `stopped: ${details.reason}`); });
    wc.on('unresponsive', () => { log(id, 'error', 'not responding, stopped'); stop(id); halt(id, 'not responding'); });
    log(id, 'info', `started ${manifest.name} ${manifest.version}`);
    win.loadURL(`hr-addon://${id}/`);
    openOverlay(r);
    watchCpu();
    onChange();
  }

  // An addon that keeps using a lot of processor time is stopped, so games stay smooth
  let cpuTimer = null;
  function watchCpu() {
    if (cpuTimer) return;
    cpuTimer = setInterval(() => {
      if (!running.size) { clearInterval(cpuTimer); cpuTimer = null; return; }
      // percentCPUUsage is spread over all cores; processor seconds per second are not
      const used = new Map(app.getAppMetrics().map(m => [m.pid, m.cpu?.cumulativeCPUUsage || 0]));
      const now = Date.now();
      for (const [id, r] of [...running]) {
        const total = contentsOf(r).reduce((sum, wc) => sum + (used.get(wc.getOSProcessId()) || 0), 0);
        const before = r.cpuLast;
        r.cpuLast = { total, at: now };
        if (!before || total < before.total) continue;   // first look, or a window came or went
        const cpu = (total - before.total) / ((now - before.at) / 1000) * 100;   // percent of one core
        r.cpuHigh = cpu > CPU.limit ? (r.cpuHigh || 0) + 1 : 0;
        if (r.cpuHigh < CPU.samples) continue;
        log(id, 'error', `stopped: used ${Math.round(cpu)} % of a processor core for ${Math.round(CPU.samples * CPU.every / 1000)} s`);
        stop(id);
        halt(id, 'used too much processor time');
        limit(id, 'cpu');
      }
    }, CPU.every);
  }

  // ── The addon's window in the overlay ──
  let overlayShown = false;
  const overlayPrefs = (id) => ({ on: true, scale: 100, ...((settings().addons[id] || {}).overlay || {}) });

  // Where the window goes: where the user put it, kept on a screen; else below the overlay
  // "mode": "screen": the whole screen the overlay is on (the main screen while it is closed)
  const isScreen = (r) => r.manifest.overlay?.mode === 'screen';
  function screenBounds() {
    const anchor = overlayInfo().anchor;
    const b = (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).bounds;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  function overlayBounds(r, index) {
    if (isScreen(r)) return { ...screenBounds(), scale: 1 };
    const p = overlayPrefs(r.manifest.id);
    const scale = OVERLAY_SCALES.includes(p.scale) ? p.scale / 100 : 1;
    let width = Math.round(r.manifest.overlay.width * scale), height = Math.round(r.manifest.overlay.height * scale);
    let x = p.x, y = p.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      const anchor = overlayInfo().anchor;
      const area = (anchor ? screen.getDisplayMatching(anchor) : screen.getPrimaryDisplay()).workArea;
      x = anchor ? anchor.x : area.x + 40;
      y = (anchor ? anchor.y + anchor.height : area.y + 40) + index * 24;
    }
    const area = screen.getDisplayNearestPoint({ x: Math.round(x + width / 2), y: Math.round(y + height / 2) }).workArea;
    // A window takes the mouse while the pointer is over it; a huge one would block the screen
    const most = area.width * area.height * WINDOW_SHARE;
    if (width * height > most) {
      const f = Math.sqrt(most / (width * height));
      width = Math.round(width * f); height = Math.round(height * f);
      limit(r.manifest.id, 'window-size');
      log(r.manifest.id, 'warn', '[overlay] window too big for the screen, made smaller; use "mode": "screen" for full-screen effects');
      return place(x, y, width, height, scale * f, area);
    }
    return place(x, y, width, height, scale, area);
  }
  function place(x, y, width, height, scale, area) {
    x = Math.min(Math.max(x, area.x), area.x + area.width - Math.min(width, area.width));
    y = Math.min(Math.max(y, area.y), area.y + area.height - Math.min(height, area.height));
    return { x: Math.round(x), y: Math.round(y), width, height, scale };
  }

  function openOverlay(r) {
    const id = r.manifest.id;
    closeOverlay(r);
    if (!r.manifest.overlay || !overlayPrefs(id).on) return;
    const { scale, ...bounds } = overlayBounds(r, [...running.values()].filter(x => x.overlay).length);
    const win = new BrowserWindow({
      ...bounds, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      alwaysOnTop: true, skipTaskbar: true, resizable: false, maximizable: false, minimizable: false,
      fullscreenable: false, hasShadow: false, title: r.manifest.name,
      // a screen addon covers the menu bar too; macOS would otherwise push it below it
      enableLargerThanScreen: isScreen(r),
      webPreferences: webPreferences(r.ses),
    });
    r.overlay = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    // A screen addon never takes the mouse. A window one does while the pointer is over it
    // (see watchCursor); Linux has no click-through forwarding, there it is always grabbable.
    win.setIgnoreMouseEvents(isScreen(r) || !LINUX);
    if (process.platform === 'darwin' && overlayInfo().allSpaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    const wc = win.webContents;
    guard(wc, id, '[overlay] ');
    wc.on('render-process-gone', (_, details) => { log(id, 'error', `[overlay] stopped: ${details.reason}`); closeOverlay(r); onChange(); });
    wc.on('did-finish-load', () => { wc.setZoomFactor(scale); if (!isScreen(r)) wc.insertCSS(DRAG_CSS).catch(() => {}); r.hoverCss = null; });
    // A move comes from the user dragging it (the app never moves it after creating it)
    let moveTimer = null;
    win.on('move', () => {
      if (isScreen(r)) return;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        if (win.isDestroyed()) return;
        const [x, y] = win.getPosition();
        saveAddon(id, { overlay: { ...overlayPrefs(id), x, y } });
      }, 400);
    });
    win.loadURL(`hr-addon://${id}/overlay.html`);
    win.once('ready-to-show', () => {
      if (!overlayShown) return;
      win.showInactive();
      if (isScreen(r)) win.setBounds(screenBounds());
    });
    watchCursor();
  }

  function closeOverlay(r) {
    const win = r.overlay;
    r.overlay = null;
    r.hover = false; r.hoverCss = null;
    if (!win) return;
    byContents.delete(win.webContents?.id);
    r.subs.delete(win.webContents?.id);
    if (!win.isDestroyed()) win.destroy();
  }

  // Like the widget: the whole window is a drag area, and while the pointer is over it, it
  // catches the mouse and lights up its edge; elsewhere clicks go through to the game.
  // setIgnoreMouseEvents(…, { forward: true }) hears no mouse over other apps, so the cursor
  // is polled instead, as for the overlay itself.
  const DRAG_CSS = 'html { -webkit-app-region: drag !important; cursor: grab !important; }';
  const HOVER_CSS = 'html { box-shadow: inset 0 0 0 1.5px rgba(127, 176, 255, .55) !important; border-radius: 14px; }';
  let cursorTimer = null;
  function watchCursor() {
    if (LINUX || cursorTimer) return;
    cursorTimer = setInterval(() => {
      const wins = [...running.values()].filter(r => r.overlay && !r.overlay.isDestroyed() && !isScreen(r));
      if (!wins.length) { clearInterval(cursorTimer); cursorTimer = null; return; }
      const p = screen.getCursorScreenPoint();
      for (const r of wins) {
        const win = r.overlay;
        const b = win.getBounds();
        const inWindow = win.isVisible() && p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
        if (!inWindow) { setHover(r, win, false); continue; }
        // Over the window, but is something there? An addon that hides its content (a notice
        // that is gone again) must not lie over the desktop as an invisible pane that takes
        // the clicks: only a visible element under the pointer takes the mouse.
        if (r.probing) continue;
        r.probing = true;
        const zoom = win.webContents.getZoomFactor() || 1;
        win.webContents.executeJavaScript(seenAt((p.x - b.x) / zoom, (p.y - b.y) / zoom), true)
          .then(seen => { if (r.overlay === win && !win.isDestroyed()) setHover(r, win, seen === true); })
          .catch(() => {})
          .finally(() => { r.probing = false; });
      }
    }, 100);
  }
  function setHover(r, win, on) {
    if (on === !!r.hover) return;
    r.hover = on;
    win.setIgnoreMouseEvents(!on);
    const wc = win.webContents;
    if (on) wc.insertCSS(HOVER_CSS).then(key => { if (r.hover && r.overlay === win) r.hoverCss = key; else wc.removeInsertedCSS(key).catch(() => {}); }).catch(() => {});
    else if (r.hoverCss) { wc.removeInsertedCSS(r.hoverCss).catch(() => {}); r.hoverCss = null; }
  }
  // Whether the addon shows anything at this point of its page: an element other than the page
  // itself, not hidden and not fully transparent, it or any of its parents
  const seenAt = (x, y) => `(() => {
    const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
    if (!el || el === document.documentElement || el === document.body) return false;
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    }
    return true;
  })()`;

  // Stays off until the user restarts it (or changes, switches on, approves it again)
  function halt(id, why) { halted.add(id); errors.set(id, why); onChange(); }
  function stop(id) {
    const r = running.get(id);
    if (!r) return;
    // its text in the Discord status goes with it
    if (discordOwner === id) { discordOwner = null; try { bridge.discordStatus?.(null); } catch {} }
    for (const timer of r.sim?.timers || []) clearTimeout(timer);
    closeOverlay(r);
    byContents.delete(r.win.webContents?.id);
    running.delete(id);
    if (!r.win.isDestroyed()) r.win.destroy();
    onChange();
  }

  // ── What an addon may ask for ──
  const caller = (event) => {
    const id = byContents.get(event.sender.id);
    return id && running.has(id) ? running.get(id) : null;
  };
  const subscribe = (r, wc, type) => { if (!r.subs.has(wc.id)) r.subs.set(wc.id, new Set()); r.subs.get(wc.id).add(type); };
  ipcMain.on('addon-subscribe', (event, type) => {
    const r = caller(event);
    if (!r) return;
    if (FREE_EVENTS.includes(type)) { subscribe(r, event.sender, type); return; }
    if (!EVENT_PERMISSION[type]) return;
    if (!r.manifest.permissions.includes(EVENT_PERMISSION[type])) { log(r.manifest.id, 'warn', `"${type}" needs the permission "${EVENT_PERMISSION[type]}" in addon.json`); limit(r.manifest.id, 'permission', EVENT_PERMISSION[type]); return; }
    subscribe(r, event.sender, type);
  });
  // The two parts of one addon (main.js and overlay.html) talk with hyperate.send / on('message')
  ipcMain.on('addon-message', (event, data) => {
    const r = caller(event);
    if (!r) return;
    let text;
    try { text = JSON.stringify(data); } catch { return; }
    if (text === undefined) return;
    if (Buffer.byteLength(text) > MESSAGE_BYTES) { log(r.manifest.id, 'warn', 'message too big (64 KB)'); limit(r.manifest.id, 'message-size'); return; }
    for (const wc of contentsOf(r)) if (wc.id !== event.sender.id) send(r, wc, 'message', JSON.parse(text));
  });
  const storeFile = (id) => path.join(dataDir, id + '.json');
  const readStorage = (id) => { try { return JSON.parse(fs.readFileSync(storeFile(id), 'utf8')); } catch { return {}; } };
  ipcMain.handle('addon-storage-get', (event, key) => {
    const r = caller(event);
    if (!r) return undefined;
    if (!r.manifest.permissions.includes('storage')) { limit(r.manifest.id, 'permission', 'storage'); return undefined; }
    return readStorage(r.manifest.id)[key];
  });
  ipcMain.handle('addon-storage-set', (event, key, value) => {
    const r = caller(event);
    if (!r) return false;
    if (!r.manifest.permissions.includes('storage')) { limit(r.manifest.id, 'permission', 'storage'); return false; }
    const data = { ...readStorage(r.manifest.id), [key]: value };
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > STORAGE_BYTES) { log(r.manifest.id, 'warn', 'storage is full (1 MB)'); limit(r.manifest.id, 'storage-size'); return false; }
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
  // Discord, VRChat and Home Assistant through the app's own connections
  let discordOwner = null;    // the addon whose text is in the Discord status
  const PARAM_RE = /^(?!\/)(?!.*\/\/)(?!.*\/$)[^\s\x00-\x1f#*,?\[\]{}]{1,128}$/;
  const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
  ipcMain.handle('addon-bridge', (event, kind, a, b) => {
    const r = caller(event);
    if (!r || !BRIDGE[kind]) return { ok: false, reason: 'unknown' };
    const id = r.manifest.id, rule = BRIDGE[kind];
    if (!r.manifest.permissions.includes(rule.permission)) { log(id, 'warn', `this needs the permission "${rule.permission}" in addon.json`); limit(id, 'permission', rule.permission); return { ok: false, reason: 'permission' }; }
    r.bridgeAt ||= {};
    const now = Date.now();
    const recent = (r.bridgeAt[kind] || []).filter(at => now - at < rule.per);
    r.bridgeAt[kind] = recent;
    if (recent.length >= rule.max) return { ok: false, reason: 'too-fast' };
    let args;
    if (kind === 'discordStatus') {
      if (a != null && typeof a !== 'string') return { ok: false, reason: 'invalid' };
      const text = a == null ? null : a.replace(/\s+/g, ' ').trim().slice(0, 100);
      args = [text && text.length >= 2 ? text : null];
    } else if (kind === 'vrchatChatbox') {
      if (typeof a !== 'string' || !a.trim()) return { ok: false, reason: 'invalid' };
      args = [a.slice(0, 144)];
    } else if (kind === 'vrchatParameter') {
      const valid = typeof b === 'boolean' || (typeof b === 'number' && Number.isFinite(b));
      if (typeof a !== 'string' || !PARAM_RE.test(a) || !valid) { log(id, 'warn', 'vrchat.parameter(name, value): a parameter name without spaces or wildcards, and true/false or a number'); return { ok: false, reason: 'invalid' }; }
      args = [a, b];
    } else {
      let text;
      try { text = JSON.stringify(b ?? null); } catch { text = undefined; }
      if (typeof a !== 'string' || !NAME_RE.test(a) || text === undefined || text.length > 8192) { log(id, 'warn', 'homeAssistant.event(name, data): a name of letters, digits, _ . -, and JSON data up to 8 KB'); return { ok: false, reason: 'invalid' }; }
      args = [id, a, JSON.parse(text)];
    }
    recent.push(now);
    let result;
    try { result = bridge[kind]?.(...args) || { ok: false, reason: 'off' }; } catch (error) { result = { ok: false, reason: 'error' }; log(id, 'error', error.message); }
    if (kind === 'discordStatus' && result.ok) discordOwner = args[0] ? id : (discordOwner === id ? null : discordOwner);
    if (!result.ok && result.reason === 'off') limit(id, 'integration-off', rule.permission);
    return result;
  });

  ipcMain.handle('addon-notify', (event, title, body) => {
    const r = caller(event);
    if (!r) return false;
    if (!r.manifest.permissions.includes('notifications')) { limit(r.manifest.id, 'permission', 'notifications'); return false; }
    if (!Notification.isSupported()) return false;
    if (Date.now() - r.lastNotify < NOTIFY_EVERY_MS) return false;   // one every 10 s at most
    r.lastNotify = Date.now();
    const id = r.manifest.id;
    const n = new Notification({ title: `${r.manifest.name}: ${title}`.slice(0, 120), body: body.slice(0, 400), icon: appIcon });
    // The system may refuse it (macOS: notifications not allowed for the app; Windows: off in
    // its settings): say so on the addon's page, where the user can switch them on
    return new Promise(done => {
      const timer = setTimeout(() => done(true), 3000);
      n.once('show', () => { clearTimeout(timer); done(true); });
      n.once('failed', (_, error) => {
        clearTimeout(timer);
        log(id, 'warn', `notification not shown: the system blocks notifications from HypeRate Desktop (${error})`);
        limit(id, 'notify-blocked');
        done(false);
      });
      n.show();
    });
  });

  // ── What the app tells the addons ──
  const contentsOf = (r) => [r.win, r.overlay].filter(w => w && !w.isDestroyed()).map(w => w.webContents);
  const send = (r, wc, type, data) => { if (r.subs.get(wc.id)?.has(type)) wc.send('addon-event', { type, data }); };
  let lastBpm = null;
  function emit(type, data) {
    if (type === 'heartRate' && Number.isFinite(data?.bpm)) lastBpm = data.bpm;
    for (const r of running.values()) {
      // while it is being tried out, made-up values only: real ones would mix in
      if (r.sim && (type === 'heartRate' || type === 'zone')) continue;
      for (const wc of contentsOf(r)) send(r, wc, type, data);
    }
  }

  // ── Trying an addon out: made-up events for this one addon only ──
  // A heart rate run comes at the pace of a real source: a value every 1 to 5 seconds, so an
  // addon that only works with one value a second shows it here and not later at a stream.
  // Each event carries simulated: true.
  const SIM_MOMENTS = {
    boss: { game: 'wow', type: 'boss_defeated', title: 'Boss Defeated', detail: 'Test boss', lift: 38 },
    close: { game: 'wow', type: 'close_call', title: 'Close Call', detail: 'Test', lift: 30 },
    death: { game: 'wow', type: 'death', title: 'You Died', detail: 'Test', lift: 22 },
    penta: { game: 'lol', type: 'pentakill', title: 'PENTAKILL', detail: 'Test', lift: 45 },
  };
  const SIM_RUNS = { rise: 1, fall: 1, zones: 1 };
  const SIM_KINDS = [...Object.keys(SIM_RUNS), ...Object.keys(SIM_MOMENTS)];
  // [ms after start, bpm]: 20 s steady (a baseline for addons that compare), then the change
  function simPlan(kind, base) {
    const at = (ms) => {
      if (kind === 'zones') return ms < 40000 ? 60 + (ms / 40000) * 125 : base;
      const target = kind === 'rise' ? base * 1.4 : base * 0.72;
      if (ms < 20000) return base;
      if (ms < 28000) return base + (target - base) * (ms - 20000) / 8000;
      if (ms < 40000) return target;
      if (ms < 48000) return target + (base - target) * (ms - 40000) / 8000;
      return base;
    };
    const plan = [];
    for (let ms = 0; ms <= 50000; ms += 1000 + Math.round(Math.random() * 4000)) plan.push([ms, Math.round(at(ms) + (Math.random() * 2 - 1))]);
    return plan;
  }
  function stopSim(r, why) {
    if (!r?.sim) return;
    for (const timer of r.sim.timers) clearTimeout(timer);
    r.sim = null;
    if (why) log(r.manifest.id, 'info', '[test] ' + why);
    onChange();
  }
  // Each try starts the addon afresh first: a pause between alerts, a count or old values
  // from before would otherwise swallow the test
  function simulate(id, kind) {
    const old = running.get(id);
    if (!old) return;
    stopSim(old);
    if (!kind) { log(id, 'info', '[test] stopped'); return; }
    if (!SIM_KINDS.includes(kind)) return;
    const entry = scan(root).find(e => e.manifest?.id === id);
    if (!entry?.manifest) return;
    start(entry);
    const r = running.get(id);
    if (!r) return;
    log(id, 'info', '[test] started afresh, so earlier pauses and counts do not get in the way');
    // a mark so a test clicked again before this one begins replaces it
    r.sim = { kind, endsAt: Date.now() + (SIM_MOMENTS[kind] ? 2000 : 52000), timers: [] };
    onChange();
    const begin = () => { if (running.get(id) === r && r.sim?.kind === kind) { r.sim = null; play(r, kind); } };
    r.win.webContents.once('did-finish-load', () => r.sim?.timers.push(setTimeout(begin, 700)));
  }
  function play(r, kind) {
    const id = r.manifest.id;
    const has = (p) => r.manifest.permissions.includes(p);
    const toAll = (type, data) => { for (const wc of contentsOf(r)) send(r, wc, type, { ...data, simulated: true }); };
    const base = Math.round(Math.min(110, Math.max(60, lastBpm || 75)));
    if (SIM_MOMENTS[kind]) {
      if (!has('gameMoments')) { log(id, 'warn', '[test] game moments need the permission "gameMoments" in addon.json'); return; }
      const { lift, ...m } = SIM_MOMENTS[kind];
      log(id, 'info', `[test] game moment ${m.type} (${m.game})`);
      for (const wc of contentsOf(r)) send(r, wc, 'gameMoment', { ...m, bpm: base + lift, simulated: true });
      return;
    }
    if (!has('heartRate') && !has('zones')) { log(id, 'warn', '[test] this needs the permission "heartRate" or "zones" in addon.json'); return; }
    const plan = simPlan(kind, base);
    const end = plan[plan.length - 1][0] + 1000;
    r.sim = { kind, endsAt: Date.now() + end, timers: [] };
    let zone;
    r.sim.timers = plan.map(([ms, bpm]) => setTimeout(() => {
      toAll('heartRate', { bpm });
      const z = zoneFor(bpm);
      if ((z?.name || null) !== (zone?.name || null)) {
        zone = z;
        if (z) toAll('zone', { name: z.name, color: z.color, min: z.min, max: z.max });
        else for (const wc of contentsOf(r)) send(r, wc, 'zone', null);
      }
    }, ms));
    r.sim.timers.push(setTimeout(() => stopSim(r, 'done, real values again'), end));
    log(id, 'info', `[test] heart rate ${kind === 'zones' ? 'through the zones' : kind === 'rise' ? 'rises' : 'falls'}: from ${base} BPM, ${Math.round(end / 1000)} s, a value every 1 to 5 s`);
    onChange();
  }

  // WISHES.md: what the AI could not build because the app does not offer it (yet), one
  // "## " heading per wish; shown on the addon's page so the user can pass it on
  function readWishes(dir) {
    try {
      const file = path.join(dir, 'WISHES.md');
      if (fs.lstatSync(file).isSymbolicLink()) return [];
      const text = fs.readFileSync(file, 'utf8').slice(0, 8000);
      return text.split(/^## +/m).slice(1).map(part => {
        const [title, ...rest] = part.split('\n');
        return { title: title.trim().slice(0, 120), text: rest.join('\n').trim().slice(0, 1000) };
      }).filter(w => w.title).slice(0, 10);
    } catch { return []; }
  }

  // ── For the settings window ──
  function list() {
    const { master, addons } = settings();
    return {
      master,
      root,
      overlayScales: OVERLAY_SCALES,
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
          // shown in the overlay: on, size in percent; inOverlay: its window is up right now
          overlay: entry.manifest?.overlay ? (({ on, scale }) => ({ on, scale }))(overlayPrefs(id)) : null,
          inOverlay: !!(id && running.get(id)?.overlay),
          // a test run going on: which, and until when
          simulating: id && running.get(id)?.sim ? { kind: running.get(id).sim.kind, endsAt: running.get(id).sim.endsAt } : null,
          limits: id ? [...(limits.get(id)?.values() || [])] : [],
          wishes: readWishes(entry.dir),
          restoring: !!entry.manifest && tampered(entry),
          // installed from the gallery (used, not edited, in the app)
          fromGallery: !!(id && loadStore().addonGallery?.[id]),
        };
      }),
    };
  }

  // The guide for AI assistants in each addon folder follows the app: an addon made with an
  // older version gets the current one, and its task (under "## Your task") stays as it is.
  // Only guides the app wrote itself are touched (they start with the template's title), and
  // AGENTS.md is not part of the fingerprint, so this never asks the user again.
  const GUIDE = path.join(__dirname, 'template', 'AGENTS.md');
  function refreshGuides() {
    let guide;
    try { guide = fs.readFileSync(GUIDE, 'utf8').replace(/\s*$/, '\n'); } catch { return; }
    const title = guide.split('\n')[0];
    if (!fs.existsSync(root)) return;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const file = path.join(root, e.name, 'AGENTS.md');
      try {
        if (fs.lstatSync(file).isSymbolicLink()) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (!text.startsWith(title)) continue;
        const at = text.indexOf('\n## Your task');
        const next = guide + (at >= 0 ? text.slice(at) : '');
        if (next !== text) fs.writeFileSync(file, next);
      } catch {}
    }
  }

  // Start what is switched on and approved; stop what is not (or everything, master off)
  function sync() {
    refreshGuides();
    const { master, addons } = settings();
    const wanted = new Set();
    if (master) {
      for (const entry of scan(root)) {
        const id = entry.manifest?.id;
        if (!id || entry.error) continue;
        const saved = addons[id] || {};
        // installed from the gallery, but not the reviewed files any more: not run, restored
        if (tampered(entry)) { onTampered(entry); continue; }
        if (!saved.enabled || halted.has(id) || needsApproval(entry.manifest, entry.fingerprint, saved.granted)) continue;
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

  // A screen changed (added, removed, resolution): screen addons follow it
  let screensWatched = false;
  function watchScreens() {
    if (screensWatched) return;
    screensWatched = true;
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, () => setTimeout(() => {
        for (const r of running.values()) if (isScreen(r) && r.overlay && !r.overlay.isDestroyed()) r.overlay.setBounds(screenBounds());
      }, 300));
    }
  }

  return {
    list,
    sync() { watch(); watchScreens(); sync(); },
    emit,
    logs: (id) => logs.get(id) || [],
    setMaster(on) { const s = loadStore(); s.addonsEnabled = on === true; saveStore(s); sync(); return list(); },
    setEnabled(id, on) { halted.delete(id); errors.delete(id); saveAddon(id, { enabled: on === true }); sync(); return list(); },
    // The user saw exactly this version (fingerprint) with these permissions and said yes
    approve(id, print) {
      const entry = scan(root).find(e => e.manifest?.id === id);
      if (!entry || entry.fingerprint !== print) return list();   // it changed meanwhile: show again
      halted.delete(id); errors.delete(id);
      saveAddon(id, { enabled: true, granted: { fingerprint: print, permissions: entry.manifest.permissions, network: entry.manifest.network } });
      sync();
      return list();
    },
    simulate(id, kind) { simulate(id, kind); return list(); },
    reload(id) { if (id) { stop(id); halted.delete(id); errors.delete(id); } sync(); return list(); },
    // One setting changed in the app: kept within what it allows, saved, told to the addon
    setValue(id, key, value) {
      const entry = scan(root).find(e => e.manifest?.id === id);
      const setting = entry?.manifest.settings.find(st => st.key === key);
      if (!setting) return list();
      const saved = (settings().addons[id] || {}).values || {};
      saveAddon(id, { values: { ...saved, [key]: settingValue(setting, value) } });
      const r = running.get(id);
      if (r) for (const wc of contentsOf(r)) send(r, wc, 'settings', valuesOf(entry.manifest));
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
        logs.delete(id); errors.delete(id); limits.delete(id);
        try { fs.unlinkSync(storeFile(id)); } catch {}
        const s = loadStore();
        if (s.addons?.[id]) { delete s.addons[id]; saveStore(s); }
      }
      try { await shell.trashItem(entry.dir); }
      catch { fs.rmSync(entry.dir, { recursive: true, force: true }); }   // no trash (some Linux desktops)
      sync();
      return list();
    },
    // The overlay is up or not: the addons' windows follow it
    setOverlayVisible(on) {
      overlayShown = on === true;
      for (const r of running.values()) {
        const win = r.overlay;
        if (!win || win.isDestroyed()) continue;
        if (!overlayShown) { win.hide(); continue; }
        win.showInactive();
        if (isScreen(r)) win.setBounds(screenBounds());   // the overlay may be on another screen now
      }
    },
    setAllSpaces(on) {
      if (process.platform !== 'darwin') return;
      for (const r of running.values()) if (r.overlay && !r.overlay.isDestroyed()) r.overlay.setVisibleOnAllWorkspaces(on === true, { visibleOnFullScreen: on === true, skipTransformProcessType: true });
    },
    // In the overlay or not, and how big
    setOverlay(id, patch) {
      const p = overlayPrefs(id);
      const next = { ...p };
      if (typeof patch.on === 'boolean') next.on = patch.on;
      if (OVERLAY_SCALES.includes(patch.scale)) next.scale = patch.scale;
      if (patch.resetPosition) { delete next.x; delete next.y; }
      saveAddon(id, { overlay: next });
      const r = running.get(id);
      if (r) openOverlay(r);
      onChange();
      return list();
    },
    stopAll() { watcher?.close(); watcher = null; for (const id of [...running.keys()]) stop(id); },
  };
}

// hr-addon://<id>/: registered before the app is ready (protocol.registerSchemesAsPrivileged),
// so an addon's page is a normal secure origin whose own scripts and styles load
const ADDON_SCHEME = { scheme: 'hr-addon', privileges: { standard: true, secure: true, supportFetchAPI: true } };

module.exports = { createAddonHost, ADDON_SCHEME };
