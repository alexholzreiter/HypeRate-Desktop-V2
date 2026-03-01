const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  wsConnect:      (id)   => ipcRenderer.send('ws-connect', id),
  wsDisconnect:   ()     => ipcRenderer.send('ws-disconnect'),
  launchOverlay:  (cfg)  => ipcRenderer.send('launch-overlay', cfg),
  closeOverlay:   ()     => ipcRenderer.send('close-overlay'),
  updateConfig:   (cfg)  => ipcRenderer.send('update-config', cfg),
  minimizeSettings: ()   => ipcRenderer.send('minimize-settings'),
  closeSettings:  ()     => ipcRenderer.send('close-settings'),
  overlayDrag:    (d)    => ipcRenderer.send('overlay-drag', d),
  loadSettings:   ()     => ipcRenderer.invoke('load-settings'),
  saveSettings:   (data) => ipcRenderer.send('save-settings', data),
  closeFtue:      ()     => ipcRenderer.send('close-ftue'),
  ftueComplete:   ()     => ipcRenderer.send('ftue-complete'),

  onWsStatus:        (cb) => ipcRenderer.on('ws-status',        (_, d) => cb(d)),
  onBpmUpdate:       (cb) => ipcRenderer.on('bpm-update',       (_, d) => cb(d)),
  onConfigUpdate:    (cb) => ipcRenderer.on('config-update',    (_, d) => cb(d)),
  onHeartRateUpdate: (cb) => ipcRenderer.on('heart-rate-update',(_, d) => cb(d)),
  onScaleFactor:     (cb) => ipcRenderer.on('scale-factor',     (_, d) => cb(d)),
});
