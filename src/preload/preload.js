const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window
  minimize: () => ipcRenderer.send('window:minimize'),
  close:    () => ipcRenderer.send('window:close'),
  openExternal: (url) => ipcRenderer.send('window:openExternal', url),

  // Store
  getStore: (key) => ipcRenderer.invoke('store:get', key),
  setStore: (key, value) => ipcRenderer.invoke('store:set', key, value),

  // Manifest
  checkManifest: () => ipcRenderer.invoke('manifest:check'),
  applyManifest: () => ipcRenderer.invoke('manifest:apply'),

  // Launch
  launch: (opts) => ipcRenderer.invoke('launch:start', opts),
  stopGame: () => ipcRenderer.invoke('launch:stop'),

  // Skin / News
  pickSkin: () => ipcRenderer.invoke('skin:pick'),
  fetchNews: () => ipcRenderer.invoke('news:fetch'),

  // App
  openGameDir: () => ipcRenderer.invoke('app:openGameDir'),
  openLauncherDir: () => ipcRenderer.invoke('app:openLauncherDir'),

  // Updater
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:version'),

  // Events
  on: (channel, cb) => {
    const allowed = ['sync:progress','sync:log','launch:log','launch:close','launch:crash','updater'];
    if (!allowed.includes(channel)) return;
    const listener = (_, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
