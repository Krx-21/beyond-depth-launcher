// Beyond Depth Launcher — Main Process
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const os = require('os');

const Store = require('electron-store');
const CORRECT_MANIFEST_URL = 'https://github.com/Krx-21/beyond-depth-launcher/releases/latest/download/manifest.json';
const store = new Store({
  defaults: {
    profiles: [],          // [{name, skinPath}]
    activeProfile: null,
    ramMaxGB: 6,
    ramMinGB: 2,
    serverAddress: 'biogji.serveminecraft.net:25565',
    manifestUrl: CORRECT_MANIFEST_URL,
    javaPath: null,
    gameDir: null
  }
});

// Migration: fix any previously saved bad manifest URL (e.g. typos like Kr.x.21)
{
  const cur = store.get('manifestUrl') || '';
  if (!/github\.com\/Krx-21\/beyond-depth-launcher\//.test(cur)) {
    store.set('manifestUrl', CORRECT_MANIFEST_URL);
  }
}

// Migration: replace old hardcoded IP with dynamic DNS
{
  const addr = store.get('serverAddress') || '';
  if (addr === '58.136.198.119:25565' || addr === '58.136.198.119') {
    store.set('serverAddress', 'biogji.serveminecraft.net:25565');
  }
}

const isDev = process.argv.includes('--dev');
let mainWindow;

const APP_DATA = app.getPath('appData');
const LAUNCHER_ROOT = path.join(APP_DATA, 'BeyondDepthLauncher');
const GAME_DIR_DEFAULT = path.join(LAUNCHER_ROOT, 'game');
const JAVA_DIR = path.join(LAUNCHER_ROOT, 'java');
const FORGE_DIR = path.join(LAUNCHER_ROOT, 'forge');

if (!store.get('gameDir')) store.set('gameDir', GAME_DIR_DEFAULT);
for (const d of [LAUNCHER_ROOT, store.get('gameDir'), JAVA_DIR, FORGE_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1e1e2e',
    icon: path.join(__dirname, '../../assets/icon.png'),
    show: false,  // show after ready-to-show to prevent white flash
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: isDev,  // disable DevTools entirely in production
      backgroundThrottling: false  // prevent UI freezing when window is unfocused (during game)
    }
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show window only once content is ready — no white/blank flash on startup
  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow safe URL schemes — prevents javascript: / file: injection.
    try {
      const { protocol } = new URL(url);
      if (protocol === 'https:' || protocol === 'http:') shell.openExternal(url);
    } catch {}
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  // Auto-updater (skip in dev)
  if (!isDev) {
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', (info) => sendStatus('updater', { state: 'available', version: info.version }));
    autoUpdater.on('update-downloaded', (info) => sendStatus('updater', { state: 'downloaded', version: info.version }));
    autoUpdater.on('error', (e) => sendStatus('updater', { state: 'error', message: String(e) }));
    autoUpdater.on('download-progress', (p) => sendStatus('updater', { state: 'progress', percent: p.percent }));
    autoUpdater.checkForUpdates().catch(() => {});
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function sendStatus(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// ---- IPC ----
// Allowlist: only keys the renderer legitimately needs to read/write.
// Prevents a compromised renderer from changing manifestUrl or javaPath to a malicious value.
const STORE_READABLE = new Set(['profiles','activeProfile','ramMaxGB','ramMinGB','serverAddress','javaPath','gameDir']);
const STORE_WRITABLE = new Set(['profiles','activeProfile','ramMaxGB','ramMinGB','serverAddress']);
ipcMain.handle('store:get', (_, key) => {
  if (!STORE_READABLE.has(key)) return undefined;
  return store.get(key);
});
ipcMain.handle('store:set', (_, key, value) => {
  if (!STORE_WRITABLE.has(key)) return false;
  store.set(key, value);
  return true;
});
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:close',    () => mainWindow.close());
ipcMain.on('window:openExternal', (_, url) => {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') shell.openExternal(url);
  } catch {}
});

const { syncManifest } = require('./manifest');

// In-session manifest cache — avoids re-fetching + re-SHA1-checking on every launch
let _manifestCache = null;
let _manifestCacheTime = 0;
const MANIFEST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const { ensureJava } = require('./java');
const { ensureForge } = require('./forge');
const { launchGame, stopGame } = require('./launcher');
const { offlineUUID } = require('./offline-uuid');

// ---- Manifest sync ----
ipcMain.handle('manifest:check', async () => {
  const url = store.get('manifestUrl');
  return await syncManifest({
    manifestUrl: url,
    gameDir: store.get('gameDir'),
    forgeDir: FORGE_DIR,
    onProgress: (p) => sendStatus('sync:progress', p),
    onLog: (msg) => sendStatus('sync:log', msg),
    dryRun: true
  });
});

ipcMain.handle('manifest:apply', async () => {
  const url = store.get('manifestUrl');
  const result = await syncManifest({
    manifestUrl: url,
    gameDir: store.get('gameDir'),
    forgeDir: FORGE_DIR,
    onProgress: (p) => sendStatus('sync:progress', p),
    onLog: (msg) => sendStatus('sync:log', msg),
    dryRun: false
  });
  _manifestCache = result;
  _manifestCacheTime = Date.now();
  return result;
});

// ---- Launch ----
ipcMain.handle('launch:start', async (_, opts) => {
  try {
    sendStatus('launch:log', '[Launcher] Preparing launch...');
    const profile = (store.get('profiles') || []).find(p => p.name === opts.profileName);
    if (!profile) throw new Error('Profile not found');

    let manifest;
    if (_manifestCache && (Date.now() - _manifestCacheTime) < MANIFEST_CACHE_TTL) {
      manifest = _manifestCache;
      sendStatus('launch:log', `[Launcher] Manifest v${manifest.version} (cached, skipping re-sync)`);
    } else {
      manifest = await syncManifest({
        manifestUrl: store.get('manifestUrl'),
        gameDir: store.get('gameDir'),
        forgeDir: FORGE_DIR,
        onProgress: (p) => sendStatus('sync:progress', p),
        onLog: (msg) => sendStatus('sync:log', msg),
        dryRun: false
      });
      _manifestCache = manifest;
      _manifestCacheTime = Date.now();
    }

    sendStatus('launch:log', '[Launcher] Ensuring Java...');
    const javaPath = await ensureJava({
      javaDir: JAVA_DIR,
      requiredMajor: manifest.javaVersion || 21,
      cachedJavaPath: store.get('javaPath'),
      onLog: (msg) => sendStatus('launch:log', msg)
    });
    store.set('javaPath', javaPath);

    sendStatus('launch:log', '[Launcher] Ensuring Forge...');
    const forgeInstaller = await ensureForge({
      forgeDir: FORGE_DIR,
      manifest,
      javaPath,
      gameDir: store.get('gameDir'),
      onLog: (msg) => sendStatus('launch:log', msg)
    });

    // Copy skin if present (writes to gameDir/customskin/<name>.png for CustomSkinLoader)
    if (profile.skinPath && fs.existsSync(profile.skinPath)) {
      const skinDir = path.join(store.get('gameDir'), 'CustomSkinLoader', 'LocalSkin', 'skins');
      fs.mkdirSync(skinDir, { recursive: true });
      fs.copyFileSync(profile.skinPath, path.join(skinDir, `${profile.name}.png`));
      sendStatus('launch:log', `[Launcher] Skin installed for ${profile.name}`);
    }

    const auth = {
      access_token: '0',
      client_token: '0',
      uuid: offlineUUID(profile.name),
      name: profile.name,
      user_properties: '{}',
      meta: { type: 'mojang', demo: false }
    };

    // RAM sanity check: warn if requested RAM > 80% of physical RAM.
    const ramGB = store.get('ramMaxGB') || 6;
    const physicalGB = os.totalmem() / (1024 ** 3);
    if (ramGB > physicalGB * 0.8) {
      sendStatus('launch:log', `[Launcher] WARNING: Requested ${ramGB} GB RAM but system only has ${physicalGB.toFixed(1)} GB — this may cause crashes.`);
    }

    sendStatus('launch:log', '[Launcher] Launching Minecraft...');
    await launchGame({
      authorization: auth,
      gameDir: store.get('gameDir'),
      javaPath,
      forgeInstaller,
      manifest,
      // Force min == max (single RAM value)
      ramMin: ramGB,
      ramMax: ramGB,
      serverAddress: opts.directConnect ? store.get('serverAddress') : null,
      onLog: (msg) => sendStatus('launch:log', msg),
      onClose: (code) => {
        sendStatus('launch:close', code);
        // Auto-show console when game crashes (non-zero exit).
        if (code !== 0 && code !== null) {
          sendStatus('launch:crash', { code });
        }
      }
    });
    return { ok: true };
  } catch (e) {
    _manifestCache = null;
    _manifestCacheTime = 0;
    sendStatus('launch:log', `[Launcher] ERROR: ${e.message || e}`);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('launch:stop', () => { stopGame(); return true; });

// ---- Skin file picker ----
ipcMain.handle('skin:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose skin (.png 64x64)',
    filters: [{ name: 'Skin PNG', extensions: ['png'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});

// ---- News (markdown from GitHub raw) ----
ipcMain.handle('news:fetch', async () => {
  try {
    const url = (store.get('manifestUrl') || '').replace(/manifest\.json$/, 'news.md');
    const axios = require('axios');
    const r = await axios.get(url, { timeout: 8000, responseType: 'text' });
    return r.data;
  } catch { return null; }
});

ipcMain.handle('updater:install', () => { autoUpdater.quitAndInstall(); });

ipcMain.handle('app:openGameDir', () => shell.openPath(store.get('gameDir')));
ipcMain.handle('app:openLauncherDir', () => shell.openPath(LAUNCHER_ROOT));
