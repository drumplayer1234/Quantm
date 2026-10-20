'use strict';

// Automatic updates from GitHub releases.
// The Windows installer and the Linux AppImage update themselves: the new version downloads
// in the background and installs on restart. The portable exe, the .deb and the unsigned macOS
// build can't replace themselves, so they announce the new version and link to the download.

const { app, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const RELEASES_PAGE = 'https://github.com/quantm-app/Quantm/releases/latest';
const LATEST_API = 'https://api.github.com/repos/quantm-app/Quantm/releases/latest';
const FIRST_CHECK = 15 * 1000;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

let notify = () => {};
let setPref = () => {};
let updater = null;
// status: idle | checking | current | available | downloading | ready | error
const state = { status: 'idle', mode: 'off', auto: true, current: app.getVersion(), version: null, percent: 0, notes: '', error: null };

function set(partial) {
  Object.assign(state, partial);
  notify(Object.assign({}, state));
}

/** 'auto' installs updates itself, 'notify' only tells you, 'off' in development */
function detectMode() {
  const testing = !app.isPackaged && process.env.QUANTM_UPDATE_TEST;
  if (!app.isPackaged && !testing) return 'off';
  // package managers (Scoop removes this file) update Quantm themselves: only announce new versions
  if (app.isPackaged && !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return 'notify';
  if (process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR) return 'auto';
  if (process.platform === 'linux' && process.env.APPIMAGE) return 'auto';
  return 'notify';
}

function friendly(error) {
  const message = String((error && error.message) || error || 'Unknown error');
  if (/net::|ENOTFOUND|ECONN|ETIMEDOUT|timed? ?out|aborted/i.test(message)) return "Couldn't reach GitHub. Check your connection.";
  return message.split('\n')[0].slice(0, 200);
}

function notesText(notes) {
  const text = Array.isArray(notes) ? notes.map(n => n.note || '').join('\n') : String(notes || '');
  return text.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

/** true when version a is newer than b (x.y.z) */
function newer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function setupAutoUpdater() {
  const { autoUpdater } = require('electron-updater');
  updater = autoUpdater;
  autoUpdater.logger = null;
  autoUpdater.autoDownload = state.auto;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  // development test: QUANTM_UPDATE_TEST=1.0.0 pretends to be that version (dev-app-update.yml)
  if (!app.isPackaged) {
    autoUpdater.forceDevUpdateConfig = true;
    if (/^\d+\.\d+\.\d+$/.test(process.env.QUANTM_UPDATE_TEST)) {
      // use electron-updater's own copy of semver, or its version checks reject the object
      const semver = require(require.resolve('semver', { paths: [require.resolve('electron-updater')] }));
      autoUpdater.currentVersion = semver.parse(process.env.QUANTM_UPDATE_TEST);
      state.current = process.env.QUANTM_UPDATE_TEST;
    }
  }

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({
    status: state.auto ? 'downloading' : 'available', version: info.version, notes: notesText(info.releaseNotes), percent: 0
  }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', version: null }));
  autoUpdater.on('download-progress', (progress) => set({ status: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', (error) => set({ status: 'error', error: friendly(error) }));
}

async function checkGitHub() {
  set({ status: 'checking', error: null });
  try {
    const response = await net.fetch(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Quantm' },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('GitHub answered ' + response.status);
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    if (latest && newer(latest, state.current)) set({ status: 'available', version: latest, notes: notesText(release.body) });
    else set({ status: 'current', version: null });
  } catch (error) {
    set({ status: 'error', error: friendly(error) });
  }
}

async function check() {
  if (state.mode === 'off' || ['checking', 'downloading', 'ready'].includes(state.status)) return getState();
  if (state.mode === 'notify') {
    await checkGitHub();
  } else {
    try {
      await updater.checkForUpdates();
    } catch (error) {
      set({ status: 'error', error: friendly(error) });
    }
  }
  return getState();
}

/** Get the update: download it (auto mode) or open the download page */
async function download() {
  if (state.mode === 'notify' || state.mode === 'off') {
    shell.openExternal(RELEASES_PAGE);
  } else if (state.status === 'available') {
    set({ status: 'downloading', percent: 0 });
    updater.downloadUpdate().catch(error => set({ status: 'error', error: friendly(error) }));
  }
  return getState();
}

/** Restart into the downloaded version; the session (song, queue, position) resumes after */
function install() {
  if (state.status !== 'ready' || !updater) return false;
  setImmediate(() => updater.quitAndInstall(true, true));
  return true;
}

function setAuto(on) {
  state.auto = !!on;
  setPref('autoUpdate', state.auto);
  if (updater) updater.autoDownload = state.auto;
  if (state.auto && state.status === 'available' && state.mode === 'auto') download();
  else set({});
  return getState();
}

function getState() {
  return Object.assign({}, state);
}

function init(options) {
  notify = options.notify;
  setPref = options.setPref;
  state.auto = options.getPref('autoUpdate') !== false;
  state.mode = detectMode();
  if (state.mode === 'off') return;
  if (state.mode === 'auto') setupAutoUpdater();
  setTimeout(check, FIRST_CHECK);
  setInterval(check, CHECK_EVERY);
}

module.exports = { init, check, download, install, setAuto, getState, newer };
