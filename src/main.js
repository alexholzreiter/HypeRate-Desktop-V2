const { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeTheme, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const { WebSocket } = require('ws');

const STORE_PATH = path.join(app.getPath('userData'), 'settings.json');
function loadStore()     { try { return JSON.parse(fs.readFileSync(STORE_PATH,'utf8')); } catch { return {}; } }
function saveStore(data) { try { fs.writeFileSync(STORE_PATH, JSON.stringify(data,null,2),'utf8'); } catch(e) { console.error('store save:',e); } }

const HYPERATE_API_KEY = '7XnPqR2m9LdHsV4tYk8ZuEf1WaJ5GcB3rTsQ6v';
const VERSION = app.getVersion();            // reads from package.json
const IS_FIRST_RUN = !loadStore().onboarded; // FTUE flag

let settingsWindow     = null;
let overlayWindow      = null;
let ftueWindow         = null;
let tray               = null;
let overlayMoveAllowed = false; // guards will-move: only our setPosition calls are allowed
let showBpmInTray      = loadStore().showBpmInTray !== false; // default true

// ── DPI helper ──
function scaleFactor() {
  return screen.getPrimaryDisplay().scaleFactor || 1;
}

function workArea() {
  return screen.getPrimaryDisplay().workArea; // {x, y, width, height}
}

// ── Settings window ──
function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width:820, height:870, minWidth:760, minHeight:780,
    frame:false, transparent:false, backgroundColor:'#080810',
    skipTaskbar: process.platform === 'win32', // Windows: only live in tray
    webPreferences:{ nodeIntegration:false, contextIsolation:true, preload:path.join(__dirname,'preload.js') },
    icon: path.join(__dirname,'../assets/icon.png'),
    title:'HypeRate Overlay',
  });
  settingsWindow.loadFile(path.join(__dirname,'windows/settings/index.html'));

  // Hide to tray instead of quitting when the window is closed
  settingsWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      settingsWindow.hide();
    }
  });
}

// ── Tray / Menu-bar icon ──
const TRAY_LABELS = {
  en: { settings:'Open Settings', overlayHide:'Hide Overlay', overlayShow:'Show Overlay', bpmHide:'Hide BPM in menu bar', bpmShow:'Show BPM in menu bar', quit:'Quit' },
  de: { settings:'Einstellungen öffnen', overlayHide:'Overlay verstecken', overlayShow:'Overlay anzeigen', bpmHide:'BPM in Menüleiste ausblenden', bpmShow:'BPM in Menüleiste anzeigen', quit:'Beenden' },
};
function tl(key) { const lang = loadStore().lang || 'en'; return (TRAY_LABELS[lang] || TRAY_LABELS.en)[key]; }

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: tl('settings'),
      click: () => { settingsWindow?.show(); settingsWindow?.focus(); },
    },
    {
      label: overlayWindow?.isVisible() ? tl('overlayHide') : tl('overlayShow'),
      enabled: !!overlayWindow,
      click: () => {
        if (!overlayWindow) return;
        overlayWindow.isVisible() ? overlayWindow.hide() : overlayWindow.show();
        tray.setContextMenu(buildMenu());
      },
    },
    {
      label: showBpmInTray ? tl('bpmHide') : tl('bpmShow'),
      click: () => {
        showBpmInTray = !showBpmInTray;
        const store = loadStore(); store.showBpmInTray = showBpmInTray; saveStore(store);
        if (!showBpmInTray) tray.setTitle('');
        tray.setContextMenu(buildMenu());
      },
    },
    { type: 'separator' },
    {
      label: tl('quit'),
      click: () => { app.isQuitting = true; app.quit(); },
    },
  ]);
}

function createTray() {
  const iconPath = process.platform === 'darwin'
    ? path.join(__dirname, '../assets/tray-icon.png')
    : path.join(__dirname, '../assets/icon.png');

  let img = nativeImage.createFromPath(iconPath);
  if (process.platform === 'darwin') {
    img = img.resize({ width: 18, height: 18 });
    img.setTemplateImage(true);
  } else {
    img = img.resize({ width: 32, height: 32 });
  }

  tray = new Tray(img);
  tray.setToolTip('HypeRate Overlay');

  tray.setContextMenu(buildMenu());

  // Rebuild menu when overlay state changes so label stays accurate
  ipcMain.on('launch-overlay',  () => setTimeout(() => tray.setContextMenu(buildMenu()), 500));
  ipcMain.on('close-overlay',   () => setTimeout(() => tray.setContextMenu(buildMenu()), 100));

  // On macOS, show the context menu on left-click instead of opening settings directly
  if (process.platform === 'darwin') {
    tray.on('click', () => tray.popUpContextMenu());
  }
}

// ── Overlay window ──
function createOverlayWindow() {
  const { width, height } = workArea();
  const sf    = scaleFactor();
  const store = loadStore();
  const ox = store.overlayX ?? (width - 300);
  const oy = store.overlayY ?? 20;

  overlayWindow = new BrowserWindow({
    width:300, height:160, x:ox, y:oy,
    frame:false, transparent:true, alwaysOnTop:true,
    skipTaskbar:true, resizable:false, hasShadow:false,
    webPreferences:{ nodeIntegration:false, contextIsolation:true, preload:path.join(__dirname,'preload.js') },
    icon: path.join(__dirname,'../assets/icon.png'),
  });
  overlayWindow.loadFile(path.join(__dirname,'windows/overlay/index.html'));
  overlayWindow.setAlwaysOnTop(true,'screen-saver');

  // Block Aero Snap from resizing or moving the transparent window.
  // Our own setPosition calls set overlayMoveAllowed=true before calling,
  // so they are not affected.
  overlayWindow.on('will-resize', (e) => e.preventDefault());
  overlayWindow.on('will-move',   (e) => { if (!overlayMoveAllowed) e.preventDefault(); });

  // Pass mouse events through transparent areas by default;
  // the renderer toggles this off when the mouse enters the widget.
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.on('closed', () => { overlayWindow = null; });

  // Send scale factor so overlay can adjust sizes
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('scale-factor', sf);
  });
}

// ── FTUE window ──
function createFtueWindow() {
  ftueWindow = new BrowserWindow({
    width:480, height:680, frame:false, transparent:false,
    backgroundColor:'#080810', resizable:true, minHeight:600,
    webPreferences:{ nodeIntegration:false, contextIsolation:true, preload:path.join(__dirname,'preload.js') },
    icon: path.join(__dirname,'../assets/icon.png'),
    title:'Welcome to HypeRate Overlay',
    parent: settingsWindow, modal:false,
  });
  ftueWindow.loadFile(path.join(__dirname,'windows/ftue/index.html'));
  ftueWindow.on('closed', () => { ftueWindow = null; });
}

// ── WebSocket ──
let ws = null, heartbeatInt = null, wsSessionId = null;

function wsConnect(sessionId) {
  wsDisconnect();
  wsSessionId = sessionId;
  console.log('[WS] Connecting, session:', sessionId);
  const url = `wss://app.hyperate.io/socket/websocket?token=${HYPERATE_API_KEY}`;
  ws = new WebSocket(url);

  ws.on('open', () => {
    ws.send(JSON.stringify({ topic:`hr:${sessionId}`, event:'phx_join', payload:{}, ref:'join' }));
    heartbeatInt = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:'hb' }));
    }, 25000);
  });

  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
    console.log('[WS]', JSON.stringify(msg));
    if (msg.event === 'phx_reply') {
      sendToSettings('ws-status', { status: msg.payload?.status === 'ok' ? 'connected' : 'error', sessionId });
      return;
    }
    if (msg.event === 'hr_update' || msg.event === 'hr_feed') {
      const bpm = msg.payload?.hr ?? msg.payload?.bpm ?? msg.payload?.heart_rate;
      if (bpm != null) {
        const val = Number(bpm);
        sendToSettings('bpm-update', { bpm: val });
        sendToOverlay('heart-rate-update', { bpm: val });
        if (process.platform === 'darwin' && tray && showBpmInTray) tray.setTitle(` ${val}`);
      }
    }
  });

  ws.on('error', (err) => sendToSettings('ws-status', { status:'error', message: err.message }));
  ws.on('close', (code) => {
    clearInterval(heartbeatInt); heartbeatInt = null;
    sendToSettings('ws-status', { status:'closed', code });
  });
}

function wsDisconnect() {
  clearInterval(heartbeatInt); heartbeatInt = null;
  if (ws) { try { ws.terminate(); } catch {} ws = null; }
  if (process.platform === 'darwin' && tray) tray.setTitle('');
}

function sendToSettings(ch, d) { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send(ch, d); }
function sendToOverlay(ch, d)  { if (overlayWindow  && !overlayWindow.isDestroyed())  overlayWindow.webContents.send(ch, d); }

// ── Hotkey: Ctrl+Shift+H toggles overlay visibility ──
function registerHotkey() {
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (!overlayWindow) return;
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
    }
  });
}

// ── App ready ──
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();

  createSettingsWindow();
  createTray();
  registerHotkey();

  // Show FTUE on first launch, after settings window is ready
  if (IS_FIRST_RUN) {
    settingsWindow.webContents.on('did-finish-load', () => {
      setTimeout(createFtueWindow, 400);
    });
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
// App lives in tray — never auto-quit when windows are closed
app.on('window-all-closed', () => {});

// ── IPC ──
ipcMain.on('ws-connect',    (_, id)  => wsConnect(id));
ipcMain.on('ws-disconnect', ()       => wsDisconnect());

ipcMain.on('launch-overlay', (_, config) => {
  if (!overlayWindow) createOverlayWindow();
  setTimeout(() => { if (overlayWindow) overlayWindow.webContents.send('config-update', config); }, 400);
});
ipcMain.on('close-overlay',     ()       => { if (overlayWindow) { overlayWindow.close(); overlayWindow=null; } });
ipcMain.on('update-config',     (_, cfg) => { if (overlayWindow) overlayWindow.webContents.send('config-update', cfg); });
ipcMain.on('minimize-settings', () => { if (settingsWindow) settingsWindow.minimize(); });
ipcMain.on('close-settings',    () => { if (settingsWindow) settingsWindow.hide(); });
ipcMain.on('close-ftue',        ()       => { if (ftueWindow) ftueWindow.close(); });

ipcMain.on('ftue-complete', () => {
  const store = loadStore();
  store.onboarded = true;
  saveStore(store);
  if (ftueWindow) ftueWindow.close();
});

ipcMain.on('set-ignore-mouse-events', (_, ignore) => {
  if (overlayWindow) overlayWindow.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.handle('get-overlay-position', () => {
  if (!overlayWindow) return { x: 0, y: 0 };
  const [x, y] = overlayWindow.getPosition();
  return { x, y };
});

ipcMain.on('overlay-move', (_, { x, y }) => {
  if (!overlayWindow) return;
  const wa = workArea();
  const [ww, wh] = overlayWindow.getSize();
  const nx = Math.max(wa.x, Math.min(x, wa.x + wa.width  - ww));
  const ny = Math.max(wa.y, Math.min(y, wa.y + wa.height - wh));
  overlayMoveAllowed = true;
  overlayWindow.setPosition(nx, ny);
  overlayMoveAllowed = false;
  const store = loadStore(); store.overlayX = nx; store.overlayY = ny; saveStore(store);
});

ipcMain.handle('load-settings', () => ({ ...loadStore(), version: VERSION, scaleFactor: scaleFactor() }));
ipcMain.on('save-settings', (_, data) => {
  const store = loadStore(); Object.assign(store, data); saveStore(store);
  if (data.lang && tray) tray.setContextMenu(buildMenu());
});

ipcMain.handle('get-autostart', () => app.getLoginItemSettings().openAtLogin);
ipcMain.on('set-autostart', (_, enable) => app.setLoginItemSettings({ openAtLogin: !!enable }));

ipcMain.handle('get-system-fonts', () => app.getSystemFonts());

ipcMain.handle('check-update', () => new Promise((resolve) => {
  const https = require('https');
  const req = https.get(
    'https://api.github.com/repos/alexholzreiter/HypeRate-Desktop-V2/releases/latest',
    { headers: { 'User-Agent': 'HypeRate-Overlay/' + VERSION } },
    (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latest = (release.tag_name || '').replace(/^v/, '');
          const current = VERSION;
          const hasUpdate = latest && latest !== current && isNewer(latest, current);
          resolve({ hasUpdate, latestVersion: latest, downloadUrl: release.html_url || '' });
        } catch { resolve({ hasUpdate: false }); }
      });
    }
  );
  req.on('error', () => resolve({ hasUpdate: false }));
  req.setTimeout(6000, () => { req.destroy(); resolve({ hasUpdate: false }); });
}));

function isNewer(latest, current) {
  const l = latest.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i]||0) > (c[i]||0)) return true;
    if ((l[i]||0) < (c[i]||0)) return false;
  }
  return false;
}

ipcMain.on('open-external', (_, url) => shell.openExternal(url));

ipcMain.handle('fetch-news', () => new Promise((resolve) => {
  const https = require('https');
  const req = https.get('https://blog.hyperate.io/feed.xml',
    { headers: { 'User-Agent': 'HypeRate-Overlay/1.0' } },
    (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }
  );
  req.on('error', () => resolve(null));
  req.setTimeout(8000, () => { req.destroy(); resolve(null); });
}));
