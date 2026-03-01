const { app, BrowserWindow, ipcMain, screen, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs   = require('fs');
const { WebSocket } = require('ws');

const STORE_PATH = path.join(app.getPath('userData'), 'settings.json');
function loadStore()     { try { return JSON.parse(fs.readFileSync(STORE_PATH,'utf8')); } catch { return {}; } }
function saveStore(data) { try { fs.writeFileSync(STORE_PATH, JSON.stringify(data,null,2),'utf8'); } catch(e) { console.error('store save:',e); } }

const HYPERATE_API_KEY = '7XnPqR2m9LdHsV4tYk8ZuEf1WaJ5GcB3rTsQ6v';
const VERSION = app.getVersion();            // reads from package.json
const IS_FIRST_RUN = !loadStore().onboarded; // FTUE flag

let settingsWindow = null;
let overlayWindow  = null;
let ftueWindow     = null;

// ── DPI helper ──
function scaleFactor() {
  return screen.getPrimaryDisplay().scaleFactor || 1;
}

// ── Logical → physical size for window creation ──
// Electron on Windows already uses logical pixels for window size,
// but we keep a helper for overlay bounds clamping.
function workArea() {
  return screen.getPrimaryDisplay().workAreaSize;
}

// ── Settings window ──
function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width:520, height:760, minWidth:480, minHeight:640,
    frame:false, transparent:false, backgroundColor:'#080810',
    webPreferences:{ nodeIntegration:false, contextIsolation:true, preload:path.join(__dirname,'preload.js') },
    icon: path.join(__dirname,'../assets/icon.png'),
    title:'HypeRate Overlay',
  });
  settingsWindow.loadFile(path.join(__dirname,'windows/settings/index.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (overlayWindow) overlayWindow.close();
    app.quit();
  });
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
  createSettingsWindow();
  registerHotkey();

  // Show FTUE on first launch, after settings window is ready
  if (IS_FIRST_RUN) {
    settingsWindow.webContents.on('did-finish-load', () => {
      setTimeout(createFtueWindow, 400);
    });
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ── IPC ──
ipcMain.on('ws-connect',    (_, id)  => wsConnect(id));
ipcMain.on('ws-disconnect', ()       => wsDisconnect());

ipcMain.on('launch-overlay', (_, config) => {
  if (!overlayWindow) createOverlayWindow();
  setTimeout(() => { if (overlayWindow) overlayWindow.webContents.send('config-update', config); }, 400);
});
ipcMain.on('close-overlay',     ()       => { if (overlayWindow) { overlayWindow.close(); overlayWindow=null; } });
ipcMain.on('update-config',     (_, cfg) => { if (overlayWindow) overlayWindow.webContents.send('config-update', cfg); });
ipcMain.on('minimize-settings', ()       => { if (settingsWindow) settingsWindow.minimize(); });
ipcMain.on('close-settings',    ()       => { if (settingsWindow) settingsWindow.close(); });
ipcMain.on('close-ftue',        ()       => { if (ftueWindow) ftueWindow.close(); });

ipcMain.on('ftue-complete', () => {
  const store = loadStore();
  store.onboarded = true;
  saveStore(store);
  if (ftueWindow) ftueWindow.close();
});

ipcMain.on('overlay-drag', (_, {dx,dy}) => {
  if (!overlayWindow) return;
  const [x,y] = overlayWindow.getPosition();
  const { width:sw, height:sh } = workArea();
  const [ww,wh] = overlayWindow.getSize();
  const nx = Math.max(0, Math.min(x+dx, sw-ww));
  const ny = Math.max(0, Math.min(y+dy, sh-wh));
  overlayWindow.setPosition(nx, ny);
  const store = loadStore(); store.overlayX=nx; store.overlayY=ny; saveStore(store);
});

ipcMain.handle('load-settings', () => ({ ...loadStore(), version: VERSION, scaleFactor: scaleFactor() }));
ipcMain.on('save-settings', (_, data) => {
  const store = loadStore(); Object.assign(store, data); saveStore(store);
});
