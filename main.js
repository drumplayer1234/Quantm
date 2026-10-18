'use strict';

const { app, BrowserWindow, ipcMain, net, session, shell, clipboard, safeStorage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const API = 'https://api-v2.soundcloud.com/';
const LOGIN_PARTITION = 'persist:soundcloud-login';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TITLEBAR_HEIGHT = 56;

// SoundCloud rejects requests whose user agent mentions Electron
app.userAgentFallback = CHROME_UA;

// Windows shows the app id as the notification header when it has no cached name for it,
// so the Windows id is just "Quantm". Must match build.win.appId (the installer shortcut).
const APP_ID = process.platform === 'win32' ? 'Quantm' : 'app.quantm.desktop';
app.setAppUserModelId(APP_ID);

// Windows looks up the name and icon for notification headers in the registry under the
// app id. Without this entry it shows the raw id ("app.quantm.desktop").
function registerNotificationIdentity() {
  if (process.platform !== 'win32') return;
  try {
    const iconPath = path.join(app.getPath('userData'), 'notification-icon.png');
    fs.mkdirSync(path.dirname(iconPath), { recursive: true });
    fs.copyFileSync(path.join(__dirname, 'build', 'icon.png'), iconPath);
    const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
    const { execFile } = require('child_process');
    execFile('reg', ['add', key, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Quantm', '/f'], () => {});
    execFile('reg', ['add', key, '/v', 'IconUri', '/t', 'REG_SZ', '/d', iconPath, '/f'], () => {});
  } catch (e) { /* cosmetic only */ }
}

let mainWindow = null;
let loginWindow = null;
let auth = null; // { token, clientId }

// ---------------------------------------------------------------------------
// Auth storage
// ---------------------------------------------------------------------------

const authFile = () => path.join(app.getPath('userData'), 'auth.json');

function loadAuth() {
  try {
    const saved = JSON.parse(fs.readFileSync(authFile(), 'utf8'));
    const token = saved.encrypted && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(saved.token, 'base64'))
      : saved.token;
    if (token && saved.clientId) {
      return { token, clientId: saved.clientId };
    }
  } catch (e) { /* no saved login */ }
  return importLegacyConfig();
}

// Soundnode 7 kept the token in ~/.config/Soundnode/userConfig.json
function importLegacyConfig() {
  try {
    const legacy = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'Soundnode', 'userConfig.json'), 'utf8'));
    if (legacy.accessToken && legacy.clientId && !/^PASTE_/.test(legacy.accessToken) && !/^PASTE_/.test(legacy.clientId)) {
      const imported = { token: legacy.accessToken, clientId: legacy.clientId };
      saveAuth(imported);
      return imported;
    }
  } catch (e) { /* nothing to import */ }
  return null;
}

function saveAuth(value) {
  auth = value;
  if (!value) {
    try { fs.unlinkSync(authFile()); } catch (e) { /* already gone */ }
    return;
  }
  const encrypted = safeStorage.isEncryptionAvailable();
  fs.mkdirSync(path.dirname(authFile()), { recursive: true });
  fs.writeFileSync(authFile(), JSON.stringify({
    encrypted,
    token: encrypted ? safeStorage.encryptString(value.token).toString('base64') : value.token,
    clientId: value.clientId
  }));
}

// ---------------------------------------------------------------------------
// client_id discovery: soundcloud.com embeds it in its JS bundles and rotates it
// ---------------------------------------------------------------------------

async function scrapeClientId() {
  const html = await (await net.fetch('https://soundcloud.com/', { headers: { 'User-Agent': CHROME_UA } })).text();
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  for (const src of scripts.reverse()) {
    const js = await (await net.fetch(src)).text();
    const match = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (match) return match[1];
  }
  throw new Error('Could not find a SoundCloud client_id');
}

// ---------------------------------------------------------------------------
// API proxy: requests go through the main process so the token never reaches
// the renderer and api-v2's CORS rules (soundcloud.com only) don't apply
// ---------------------------------------------------------------------------

function buildUrl(resource, params, clientId) {
  const url = new URL(/^https?:/.test(resource) ? resource : API + resource.replace(/^\//, ''));
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  url.searchParams.set('client_id', clientId);
  return url;
}

async function apiRequest({ method = 'GET', resource, params, body }, retried = false) {
  if (!auth) return { ok: false, status: 401, data: { error: 'not_logged_in' } };

  const url = buildUrl(resource, params, auth.clientId);
  if (url.hostname !== 'api-v2.soundcloud.com') {
    return { ok: false, status: 400, data: { error: 'blocked_host' } };
  }

  let response;
  try {
    response = await net.fetch(url.toString(), {
      method,
      headers: Object.assign({
        Authorization: 'OAuth ' + auth.token,
        Accept: 'application/json',
        Origin: 'https://soundcloud.com',
        Referer: 'https://soundcloud.com/'
      }, body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    // transient connection resets happen; retry once before giving up
    if (!retried) return apiRequest({ method, resource, params, body }, true);
    return { ok: false, status: 0, data: { error: 'network', message: error.message } };
  }

  // a stale client_id gives 401/403 even with a valid token: refresh it once
  if ((response.status === 401 || response.status === 403) && !retried) {
    try {
      const clientId = await scrapeClientId();
      if (clientId !== auth.clientId) {
        saveAuth({ token: auth.token, clientId });
        return apiRequest({ method, resource, params, body }, true);
      }
    } catch (e) { /* fall through with the original error */ }
  }

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { ok: response.ok, status: response.status, data };
}

// ---------------------------------------------------------------------------
// In-app SoundCloud sign in: capture the oauth_token cookie and a client_id
// ---------------------------------------------------------------------------

function openLogin() {
  if (loginWindow) {
    loginWindow.focus();
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const loginSession = session.fromPartition(LOGIN_PARTITION);
    let token = null;
    let clientId = null;
    let done = false;

    loginWindow = new BrowserWindow({
      width: 480,
      height: 720,
      parent: mainWindow || undefined,
      modal: !!mainWindow,
      title: 'Sign in to SoundCloud',
      autoHideMenuBar: true,
      webPreferences: { partition: LOGIN_PARTITION, contextIsolation: true, nodeIntegration: false }
    });
    loginWindow.webContents.setUserAgent(CHROME_UA);

    // popups (Google / Apple / Facebook sign in) stay in the same session
    loginWindow.webContents.setWindowOpenHandler(() => ({
      action: 'allow',
      overrideBrowserWindowOptions: { webPreferences: { partition: LOGIN_PARTITION }, autoHideMenuBar: true }
    }));

    const finish = async () => {
      if (done || !token) return;
      if (!clientId) {
        try { clientId = await scrapeClientId(); } catch (e) { return; }
      }
      done = true;
      saveAuth({ token, clientId });
      cleanup();
      if (loginWindow) loginWindow.close();
      resolve(true);
    };

    const onCookie = (event, cookie, cause, removed) => {
      if (!removed && cookie.name === 'oauth_token' && /soundcloud\.com$/.test(cookie.domain) && cookie.value) {
        token = cookie.value;
        finish();
      }
    };

    const onRequest = (details, callback) => {
      const match = details.url.match(/[?&]client_id=([a-zA-Z0-9]{32})/);
      if (match) clientId = match[1];
      callback({});
    };

    const cleanup = () => {
      loginSession.cookies.removeListener('changed', onCookie);
      loginSession.webRequest.onBeforeRequest(null);
    };

    loginSession.cookies.on('changed', onCookie);
    loginSession.webRequest.onBeforeRequest({ urls: ['https://api-v2.soundcloud.com/*'] }, onRequest);

    // already signed in from an earlier session?
    loginSession.cookies.get({ url: 'https://soundcloud.com', name: 'oauth_token' }).then((cookies) => {
      if (cookies[0] && cookies[0].value) {
        token = cookies[0].value;
        finish();
      }
    });

    loginWindow.on('closed', () => {
      loginWindow = null;
      cleanup();
      if (!done) resolve(false);
    });

    loginWindow.loadURL('https://soundcloud.com/signin');
  });
}

// ---------------------------------------------------------------------------
// See-through window (Liquid Glass). The window is created transparent and Windows
// blurs whatever is behind it. Changing it needs a restart, so it's stored in a file.
// ---------------------------------------------------------------------------

const windowPrefsFile = () => path.join(app.getPath('userData'), 'window-prefs.json');

function loadWindowPrefs() {
  try { return JSON.parse(fs.readFileSync(windowPrefsFile(), 'utf8')); } catch (e) { return {}; }
}

function seeThroughSupported() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/** Windows 10/11: ask the compositor to blur behind the window (SetWindowCompositionAttribute) */
function applyBlurBehind(win) {
  if (process.platform !== 'win32') return false;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const AccentPolicy = koffi.struct('ACCENT_POLICY', { AccentState: 'int', AccentFlags: 'int', GradientColor: 'uint32', AnimationId: 'int' });
    const AttribData = koffi.struct('WINDOWCOMPOSITIONATTRIBDATA', { Attrib: 'int', pvData: 'void *', cbData: 'size_t' });
    const setAttribute = user32.func('bool __stdcall SetWindowCompositionAttribute(void *hwnd, WINDOWCOMPOSITIONATTRIBDATA *data)');
    const hwnd = koffi.decode(win.getNativeWindowHandle(), 'void *');
    const policy = Buffer.alloc(koffi.sizeof(AccentPolicy));
    // 3 = ACCENT_ENABLE_BLURBEHIND (smooth when dragging, unlike acrylic on Windows 10)
    koffi.encode(policy, AccentPolicy, { AccentState: 3, AccentFlags: 2, GradientColor: 0x10000000, AnimationId: 0 });
    return setAttribute(hwnd, { Attrib: 19, pvData: policy, cbData: policy.length });
  } catch (error) {
    console.error('Blur-behind unavailable', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function createMainWindow() {
  let state = { width: 1280, height: 820 };
  try { state = Object.assign(state, JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'))); } catch (e) { /* defaults */ }

  const seeThrough = seeThroughSupported() && !!loadWindowPrefs().seeThrough;
  const chrome = seeThrough
    // transparent windows can't use the native title bar buttons: the page draws its own
    ? (process.platform === 'darwin'
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 20 }, vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
      : { frame: false, transparent: true, backgroundColor: '#00000000' })
    : {
      backgroundColor: '#121212',
      titleBarStyle: 'hidden',
      titleBarOverlay: process.platform === 'darwin' ? true : { color: '#00000000', symbolColor: '#ffffff', height: TITLEBAR_HEIGHT },
      trafficLightPosition: { x: 16, y: 20 }
    };

  mainWindow = new BrowserWindow(Object.assign({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Quantm',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  }, chrome));
  mainWindow.seeThrough = seeThrough;

  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => {
    if (seeThrough) applyBlurBehind(mainWindow);
    mainWindow.show();
  });
  const sendMaximized = () => mainWindow && mainWindow.webContents.send('window:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', sendMaximized);
  mainWindow.on('unmaximize', sendMaximized);

  const saveState = () => {
    if (!mainWindow || mainWindow.isMinimized()) return;
    const bounds = mainWindow.getNormalBounds();
    fs.writeFileSync(windowStateFile(), JSON.stringify(Object.assign(bounds, { maximized: mainWindow.isMaximized() })));
  };
  mainWindow.on('close', saveState);

  // links open in the user's browser, never inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle('auth:status', () => ({ loggedIn: !!auth }));
ipcMain.handle('auth:login', () => openLogin());
ipcMain.handle('auth:logout', async () => {
  saveAuth(null);
  await session.fromPartition(LOGIN_PARTITION).clearStorageData();
  return true;
});
ipcMain.handle('auth:setManual', (event, { token, clientId }) => {
  if (!token || !/^[a-zA-Z0-9]{32}$/.test(clientId || '')) return false;
  saveAuth({ token: token.trim(), clientId: clientId.trim() });
  return true;
});

ipcMain.handle('api:request', (event, request) => apiRequest(request));

// waveform data lives on wave.sndcdn.com, which has no CORS headers
ipcMain.handle('net:json', async (event, url) => {
  const parsed = new URL(url);
  if (!/(^|\.)sndcdn\.com$/.test(parsed.hostname)) return null;
  try {
    const response = await net.fetch(url);
    return response.ok ? response.json() : null;
  } catch (e) {
    return null;
  }
});

// artwork as a data URL, so the page can read its pixels (sndcdn images have no CORS headers)
ipcMain.handle('net:image', async (event, url) => {
  const parsed = new URL(url);
  if (!/(^|\.)sndcdn\.com$/.test(parsed.hostname)) return null;
  try {
    const response = await net.fetch(url);
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
  } catch (e) {
    return null;
  }
});

ipcMain.handle('window:zoom', (event, factor) => {
  const value = Number(factor);
  if (mainWindow && value >= 0.5 && value <= 2) mainWindow.webContents.setZoomFactor(value);
});

ipcMain.handle('window:mode', () => ({
  seeThrough: !!(mainWindow && mainWindow.seeThrough),
  supported: seeThroughSupported(),
  customControls: !!(mainWindow && mainWindow.seeThrough && process.platform !== 'darwin'),
  maximized: !!(mainWindow && mainWindow.isMaximized()),
  platform: process.platform
}));

// saving the choice restarts the app, since a window can't become transparent later
ipcMain.handle('window:setSeeThrough', (event, on) => {
  const prefs = loadWindowPrefs();
  prefs.seeThrough = !!on;
  fs.writeFileSync(windowPrefsFile(), JSON.stringify(prefs));
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('window:control', (event, action) => {
  if (!mainWindow) return;
  if (action === 'minimize') mainWindow.minimize();
  if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  if (action === 'close') mainWindow.close();
});

ipcMain.handle('window:titlebar', (event, { color, symbolColor }) => {
  if (mainWindow && !mainWindow.seeThrough && process.platform !== 'darwin' && mainWindow.setTitleBarOverlay) {
    mainWindow.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
  }
});

ipcMain.handle('shell:open', (event, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.handle('clipboard:write', (event, text) => clipboard.writeText(String(text)));

ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    registerNotificationIdentity();
    auth = loadAuth();
    createMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
  });
}
