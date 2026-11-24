// The only thing an addon's page can reach: window.hyperate. It runs in a sandboxed renderer
// with context isolation, so the addon has no Node, no Electron and no other window. What it may
// actually get is decided in the main process (src/addons/host.js), which also knows which addon
// is calling: this file only passes messages along.

const { contextBridge, ipcRenderer } = require('electron');

const listeners = { heartRate: [], zone: [], gameMoment: [], settings: [] };
ipcRenderer.on('addon-event', (_, { type, data }) => {
  for (const fn of listeners[type] || []) {
    try { fn(data); } catch (error) { console.error(error); }
  }
});

contextBridge.exposeInMainWorld('hyperate', {
  // hyperate.on('heartRate', ({ bpm }) => …) · 'zone' · 'gameMoment' · 'settings' (its own, when the user changes them)
  on(type, fn) {
    if (!listeners[type] || typeof fn !== 'function') throw new Error(`unknown event "${type}"`);
    listeners[type].push(fn);
    ipcRenderer.send('addon-subscribe', type);
  },
  storage: {
    get: (key) => ipcRenderer.invoke('addon-storage-get', String(key)),
    set: (key, value) => ipcRenderer.invoke('addon-storage-set', String(key), value),
  },
  // The values of "settings" from addon.json, as the user set them in the app
  settings: { get: () => ipcRenderer.invoke('addon-settings-get') },
  notify: (title, body) => ipcRenderer.invoke('addon-notify', String(title ?? ''), String(body ?? '')),
  log: (...args) => console.log(...args),
});
