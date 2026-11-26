const { contextBridge, ipcRenderer } = require('electron');


let linuxBleDevice = null;
let linuxBleCharacteristic = null;
let linuxBleAutoReconnect = false;
let linuxBleManualDisconnect = false;
let linuxBleReconnectTimer = null;
let linuxBleRequestPending = false;

function linuxBleStatus(state, extra = {}) {
  ipcRenderer.send('ble-web-status', { state, ...extra });
}

function linuxBleParseHeartRate(event) {
  const data = event.target.value;
  if (!data || data.byteLength < 2) return;
  const flags = data.getUint8(0);
  const bpm = (flags & 0x01)
    ? data.getUint16(1, true)
    : data.getUint8(1);
  if (bpm > 0 && bpm < 300) ipcRenderer.send('ble-web-bpm', bpm);
}

async function linuxBleConnectDevice(device) {
  linuxBleManualDisconnect = false;
  linuxBleStatus('connecting');

  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    const characteristic = await service.getCharacteristic('heart_rate_measurement');

    linuxBleCharacteristic = characteristic;
    await characteristic.startNotifications();
    characteristic.addEventListener('characteristicvaluechanged', linuxBleParseHeartRate);

    linuxBleDevice = device;
    linuxBleStatus('connected', { name: device.name || 'HR Monitor' });
  } catch (err) {
    linuxBleStatus('connect-error', { reason: err?.message || String(err) });
  }
}

function linuxBleScheduleReconnect() {
  if (!linuxBleAutoReconnect || linuxBleManualDisconnect || !linuxBleDevice || linuxBleReconnectTimer) return;

  linuxBleStatus('reconnecting', { name: linuxBleDevice.name || 'HR Monitor' });

  linuxBleReconnectTimer = setTimeout(async () => {
    linuxBleReconnectTimer = null;
    if (linuxBleManualDisconnect || !linuxBleAutoReconnect || !linuxBleDevice) return;

    try {
      await linuxBleConnectDevice(linuxBleDevice);
    } catch {
      linuxBleScheduleReconnect();
    }
  }, 3000);
}

async function linuxBleStartScan() {
  if (linuxBleRequestPending) return;

  if (!navigator.bluetooth) {
    linuxBleStatus('ble-unavailable', { reason: 'Web Bluetooth is unavailable.' });
    return;
  }

  linuxBleRequestPending = true;
  linuxBleStatus('scanning');

  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['heart_rate'] }],
      optionalServices: ['heart_rate'],
    });

    linuxBleRequestPending = false;

    device.addEventListener('gattserverdisconnected', () => {
      if (linuxBleManualDisconnect) {
        linuxBleStatus('disconnected');
        return;
      }
      linuxBleStatus('disconnected');
      linuxBleScheduleReconnect();
    });

    await linuxBleConnectDevice(device);
  } catch (err) {
    linuxBleRequestPending = false;

    if (err?.name === 'NotFoundError') {
      linuxBleStatus('idle');
      return;
    }

    linuxBleStatus('scan-error', { reason: err?.message || String(err) });
  }
}

async function linuxBleDisconnect() {
  linuxBleManualDisconnect = true;
  clearTimeout(linuxBleReconnectTimer);
  linuxBleReconnectTimer = null;

  if (linuxBleCharacteristic) {
    try {
      linuxBleCharacteristic.removeEventListener('characteristicvaluechanged', linuxBleParseHeartRate);
      await linuxBleCharacteristic.stopNotifications();
    } catch {}
    linuxBleCharacteristic = null;
  }

  if (linuxBleDevice?.gatt?.connected) {
    try { linuxBleDevice.gatt.disconnect(); } catch {}
  }

  linuxBleStatus('disconnected');
}

contextBridge.exposeInMainWorld('electronAPI', {
  wsConnect:      (id)   => ipcRenderer.send('ws-connect', id),
  wsDisconnect:   ()     => ipcRenderer.send('ws-disconnect'),
  launchOverlay:  (cfg)  => ipcRenderer.send('launch-overlay', cfg),
  closeOverlay:   ()     => ipcRenderer.send('close-overlay'),
  updateConfig:   (cfg)  => ipcRenderer.send('update-config', cfg),
  minimizeSettings: ()   => ipcRenderer.send('minimize-settings'),
  closeSettings:  ()     => ipcRenderer.send('close-settings'),
  overlayIsOpen:  ()     => ipcRenderer.invoke('overlay-is-open'),
  assetsPick:     (kind) => ipcRenderer.invoke('assets-pick', kind),
  analyticsSet:   (on)   => ipcRenderer.invoke('analytics-set', !!on),
  dockSet:        (on)   => ipcRenderer.invoke('dock-set', !!on),
  inAppGet:       ()     => ipcRenderer.invoke('inapp-get'),
  addonsList:     ()     => ipcRenderer.invoke('addons-list'),
  addonsSetMaster:(on)   => ipcRenderer.invoke('addons-set-master', !!on),
  addonsEnable:   (id, on) => ipcRenderer.invoke('addons-enable', id, !!on),
  addonsApprove:  (id, fingerprint) => ipcRenderer.invoke('addons-approve', id, fingerprint),
  addonsReload:   (id)   => ipcRenderer.invoke('addons-reload', id),
  addonsSimulate: (id, kind) => ipcRenderer.invoke('addons-simulate', id, kind ?? null),
  wishesSend:     (wish) => ipcRenderer.invoke('wishes-send', wish),
  wishesList:     ()     => ipcRenderer.invoke('wishes-list'),
  addonsLogs:     (id)   => ipcRenderer.invoke('addons-logs', id),
  addonsRemove:   (folder) => ipcRenderer.invoke('addons-remove', folder),
  addonsOpenFolder: ()   => ipcRenderer.invoke('addons-open-folder'),
  addonsCreate:   (name, task) => ipcRenderer.invoke('addons-create', { name, task }),
  addonsSetValue: (id, key, value) => ipcRenderer.invoke('addons-set-value', id, key, value),
  addonsSetOverlay: (id, patch) => ipcRenderer.invoke('addons-set-overlay', id, patch),
  addonsOpenEditor: (folder) => ipcRenderer.invoke('addons-open-editor', folder),
  addonsShowFolder: (folder) => ipcRenderer.invoke('addons-show-folder', folder),
  onAddonsChanged:(cb)   => ipcRenderer.on('addons-changed', () => cb()),
  inAppEvent:     (id, event) => ipcRenderer.invoke('inapp-event', id, event),
  inAppVote:      (id, optionId) => ipcRenderer.invoke('inapp-vote', id, optionId),
  onInAppMessage: (cb)   => ipcRenderer.on('inapp-message', (_, d) => cb(d)),
  platform:       process.platform,
  assetsRemove:   (kind, file) => ipcRenderer.invoke('assets-remove', kind, file),
  getOverlayPosition:   ()       => ipcRenderer.invoke('get-overlay-position'),
  getOverlayDisplays:   ()       => ipcRenderer.invoke('get-overlay-displays'),
  setOverlayDisplay:    (id)     => ipcRenderer.invoke('set-overlay-display', id),
  setOverlayAllSpaces:  (on)     => ipcRenderer.invoke('set-overlay-all-spaces', on),
  overlayMove:          (pos)    => ipcRenderer.send('overlay-move', pos),
  resizeOverlay:        (size)   => ipcRenderer.send('resize-overlay', size),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  loadSettings:   ()     => ipcRenderer.invoke('load-settings'),
  saveSettings:   (data) => ipcRenderer.send('save-settings', data),
  testOsc:        (cfg)  => ipcRenderer.invoke('test-osc', cfg),
  saveOscSettings: (cfg) => ipcRenderer.invoke('save-osc-settings', cfg),
  ftueComplete:   ()     => ipcRenderer.send('ftue-complete'),
  getAutostart:   ()     => ipcRenderer.invoke('get-autostart'),
  setAutostart:   (on)   => ipcRenderer.send('set-autostart', on),
  getSystemFonts: ()     => ipcRenderer.invoke('get-system-fonts'),
  openExternal:   (url)  => ipcRenderer.send('open-external', url),
  fetchNews:      ()     => ipcRenderer.invoke('fetch-news'),
  checkUpdate:    ()     => ipcRenderer.invoke('check-update'),

  onWsStatus:        (cb) => ipcRenderer.on('ws-status',        (_, d) => cb(d)),
  onBpmUpdate:       (cb) => ipcRenderer.on('bpm-update',       (_, d) => cb(d)),
  onConfigUpdate:    (cb) => ipcRenderer.on('config-update',    (_, d) => cb(d)),
  onHeartRateUpdate: (cb) => ipcRenderer.on('heart-rate-update',(_, d) => cb(d)),
  onHeartRateLost:   (cb) => ipcRenderer.on('heart-rate-lost',  () => cb()),
  onScaleFactor:     (cb) => ipcRenderer.on('scale-factor',     (_, d) => cb(d)),
  onOverlayDragging: (cb) => ipcRenderer.on('overlay-dragging', (_, d) => cb(d)),
  onOverlayCursor:   (cb) => ipcRenderer.on('overlay-cursor',   (_, d) => cb(d)),
  onOverlayResized:  (cb) => ipcRenderer.on('overlay-resized',  (_, d) => cb(d)),
  onOverlayState:    (cb) => ipcRenderer.on('overlay-state',    (_, d) => cb(d)),
  onOverlayDisplays: (cb) => ipcRenderer.on('overlay-displays', (_, d) => cb(d)),

  discordEnable:      ()     => ipcRenderer.send('discord-enable'),
  discordDisable:     ()     => ipcRenderer.send('discord-disable'),
  onDiscordStatus:    (cb)   => ipcRenderer.on('discord-status', (_, d) => cb(d)),

  bleScanStart:       ()              => process.platform === 'linux' ? linuxBleStartScan() : ipcRenderer.send('ble-scan-start'),
  bleScanStop:        ()              => process.platform === 'linux' ? ipcRenderer.send('ble-web-cancel-scan') : ipcRenderer.send('ble-scan-stop'),
  bleConnect:         (id, name)      => process.platform === 'linux' ? ipcRenderer.send('ble-web-select-device', id) : ipcRenderer.send('ble-connect', { id, name }),
  bleDisconnect:      ()              => process.platform === 'linux' ? linuxBleDisconnect() : ipcRenderer.send('ble-disconnect'),
  bleSetAutoReconnect:(enabled)       => {
    if (process.platform === 'linux') {
      linuxBleAutoReconnect = !!enabled;
      if (!linuxBleAutoReconnect) {
        clearTimeout(linuxBleReconnectTimer);
        linuxBleReconnectTimer = null;
      }
    } else {
      ipcRenderer.send('ble-set-auto-reconnect', enabled);
    }
  },
  onBleDeviceFound:   (cb)            => ipcRenderer.on('ble-device-found', (_, d) => cb(d)),
  onBleStatus:        (cb)            => ipcRenderer.on('ble-status',       (_, d) => cb(d)),
  onBleVitals:        (cb)            => ipcRenderer.on('ble-vitals',       (_, d) => cb(d)),
  bleGetState:        ()              => ipcRenderer.invoke('ble-get-state'),
  bleGetLog:          (count)         => ipcRenderer.invoke('ble-get-log', count),
  bleCopyDiagnostics: ()              => ipcRenderer.invoke('ble-copy-diagnostics'),

  wowEnable:          (opts)    => ipcRenderer.send('wow-enable', opts),
  wowDisable:         ()        => ipcRenderer.send('wow-disable'),
  wowSetOptions:      (opts)    => ipcRenderer.send('wow-set-options', opts),
  wowDefaultPath:     ()        => ipcRenderer.invoke('wow-default-path'),
  wowPickFolder:      (current) => ipcRenderer.invoke('wow-pick-folder', current),
  wowShowDiagnostics: ()        => ipcRenderer.send('wow-show-diagnostics'),
  wowTest:            (type)    => ipcRenderer.send('wow-test', type),
  onWowStatus:        (cb)      => ipcRenderer.on('wow-status',  (_, d) => cb(d)),
  hyperaidStatus:     ()        => ipcRenderer.invoke('hyperaid-status'),
  hyperaidConfigure:  (opts)    => ipcRenderer.invoke('hyperaid-configure', opts),
  hyperaidInstall:    ()        => ipcRenderer.invoke('hyperaid-install'),
  onHyperaidStatus:   (cb)      => ipcRenderer.on('hyperaid-status', (_, d) => cb(d)),

  sessionsList:       ()        => ipcRenderer.invoke('sessions-list'),
  sessionsDelete:     ()        => ipcRenderer.invoke('sessions-delete'),
  sessionsRead:       (startedAt) => ipcRenderer.invoke('sessions-read', startedAt),
  sessionsZoneSuggestion: () => ipcRenderer.invoke('sessions-zone-suggestion'),
  sessionsCard:       (startedAt) => ipcRenderer.invoke('sessions-card', startedAt),
  sessionsCardPreview:(startedAt) => ipcRenderer.invoke('sessions-card-preview', startedAt),
  sessionsCardSave:   (startedAt) => ipcRenderer.invoke('sessions-card-save', startedAt),
  sessionsCardCopy:   (startedAt) => ipcRenderer.invoke('sessions-card-copy', startedAt),
  sessionsSetOptions: (opts)    => ipcRenderer.send('sessions-set-options', opts),
  onSessionsChanged:  (cb)      => ipcRenderer.on('sessions-changed', (_, d) => cb(d)),
  onUpdateAvailable:  (cb)      => ipcRenderer.on('update-available', (_, d) => cb(d)),

  mqttEnable:         (opts)    => ipcRenderer.send('mqtt-enable', opts),
  mqttDisable:        ()        => ipcRenderer.send('mqtt-disable'),
  mqttSetOptions:     (opts)    => ipcRenderer.send('mqtt-set-options', opts),
  mqttTest:           ()        => ipcRenderer.invoke('mqtt-test'),
  mqttHasPassword:    ()        => ipcRenderer.invoke('mqtt-has-password'),
  onMqttStatus:       (cb)      => ipcRenderer.on('mqtt-status', (_, d) => cb(d)),
  onMqttPasswordLost: (cb)      => ipcRenderer.on('mqtt-password-lost', (_, d) => cb(d)),

  lolEnable:          (opts)    => ipcRenderer.send('lol-enable', opts),
  lolDisable:         ()        => ipcRenderer.send('lol-disable'),
  lolSetOptions:      (opts)    => ipcRenderer.send('lol-set-options', opts),
  lolTest:            (style)   => ipcRenderer.send('lol-test', style),
  onLolStatus:        (cb)      => ipcRenderer.on('lol-status',  (_, d) => cb(d)),
  onGameMoment:       (cb)      => ipcRenderer.on('game-moment', (_, d) => cb(d)),
});
