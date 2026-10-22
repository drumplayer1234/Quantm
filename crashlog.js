'use strict';

// Crash logs, kept on this computer only (nothing is uploaded):
//   userData/Crashpad   minidumps Electron writes when a Quantm process crashes
//   userData/logs/crash.log   one line per problem: uncaught errors, crashed or killed processes,
//                             a window that stopped responding, and sessions that ended without
//                             closing normally (e.g. Windows ended Quantm)
// Settings → About → Open crash logs shows the folder.

const { app, crashReporter } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 256 * 1024; // then crash.log moves to crash.old.log and starts over

const logsDir = () => path.join(app.getPath('userData'), 'logs');
const logFile = () => path.join(logsDir(), 'crash.log');
// exists while Quantm runs; still there at the next start means the last session never closed
const runningFile = () => path.join(logsDir(), 'running');

function write(message) {
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    try {
      if (fs.statSync(logFile()).size > MAX_BYTES) fs.renameSync(logFile(), path.join(logsDir(), 'crash.old.log'));
    } catch (e) { /* no log yet */ }
    fs.appendFileSync(logFile(), `${new Date().toISOString()} [${app.getVersion()}] ${message}\n`);
  } catch (e) { /* logging must never take Quantm down */ }
}

const describe = (error) => (error && error.stack) || String(error);

/** Call before app is ready, after the userData folder is final */
function start() {
  try {
    crashReporter.start({ uploadToServer: false, compress: true });
  } catch (e) {
    write('crash reporter unavailable: ' + describe(e));
  }

  // logged without changing how Electron handles the error
  process.on('uncaughtExceptionMonitor', (error) => write('main process error: ' + describe(error)));
  process.on('unhandledRejection', (reason) => write('unhandled promise rejection: ' + describe(reason)));

  app.on('render-process-gone', (event, contents, details) => {
    write(`window crashed (${details.reason}, exit code ${details.exitCode})`);
  });
  app.on('child-process-gone', (event, details) => {
    if (details.reason === 'clean-exit') return;
    const name = details.name || details.serviceName || details.type;
    write(`${name} process ended (${details.reason}, exit code ${details.exitCode})`);
  });

}

/** Call once this copy owns the single-instance lock and is ready */
function sessionStarted() {
  if (fs.existsSync(runningFile())) write('the last session ended without closing normally');
  try {
    fs.mkdirSync(logsDir(), { recursive: true });
    fs.writeFileSync(runningFile(), String(process.pid));
  } catch (e) { return; /* only used for the line above */ }
  app.on('will-quit', () => {
    try { fs.unlinkSync(runningFile()); } catch (e) { /* already gone */ }
  });
}

/** A window stopped responding (the page is stuck, the app didn't crash) */
function watchWindow(win) {
  win.on('unresponsive', () => write('window stopped responding'));
  win.on('responsive', () => write('window responding again'));
}

/** The folder with crash.log; the minidumps live next to it in Crashpad */
function folder() {
  fs.mkdirSync(logsDir(), { recursive: true });
  return logsDir();
}

module.exports = { start, sessionStarted, watchWindow, folder, write };
