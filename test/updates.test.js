import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

installBrowser();
const { updateStatusText, initUpdates, subscribeUpdates } = await import('../src/js/updates.js');

test('update status text covers all updater states and source mode', () => {
  const base = { mode: 'auto', version: '1.1.0', percent: 42.3 };
  const expected = {
    idle: 'Check for a new version of Quantm',
    checking: 'Checking…',
    current: "You're up to date",
    available: 'Version 1.1.0 available',
    downloading: 'Downloading 1.1.0 — 42%',
    ready: 'Version 1.1.0 ready — Restart to update',
    error: 'Unable to check for updates'
  };
  for (const [status, text] of Object.entries(expected)) {
    assert.equal(updateStatusText({ ...base, status }), text);
  }
  assert.equal(updateStatusText({ ...base, status: 'error', error: 'Network unavailable' }), 'Network unavailable');
  assert.equal(updateStatusText({ mode: 'off', status: 'idle' }), 'Updates are off when running from source');
  assert.equal(updateStatusText({ ...base, mode: 'notify', status: 'available' }), expected.available);
});

test('one bridge listener shares live state, ignores a stale snapshot and releases view listeners', async () => {
  let push;
  let resolveStatus;
  let subscriptions = 0;
  window.native.updates = {
    onStatus(fn) { push = fn; subscriptions++; },
    status() { return new Promise(resolve => { resolveStatus = resolve; }); }
  };
  initUpdates();
  initUpdates();
  assert.equal(subscriptions, 1);
  const received = [];
  const stop = subscribeUpdates(state => received.push(state.status));
  push({ mode: 'auto', status: 'checking' });
  resolveStatus({ mode: 'auto', status: 'idle' });
  await Promise.resolve();
  assert.deepEqual(received, ['checking']);
  const cached = [];
  const stopCached = subscribeUpdates(state => cached.push(state.status));
  assert.deepEqual(cached, ['checking']);
  stop();
  stopCached();
  push({ mode: 'auto', status: 'current' });
  assert.deepEqual(received, ['checking']);
  assert.deepEqual(cached, ['checking']);

  // A ready notification survives duplicate events, calls install, and persists Later.
  const ready = { mode: 'auto', status: 'ready', version: '1.1.0' };
  let installs = 0;
  window.native.updates.install = async () => { installs++; return true; };
  push(ready);
  const banner = document.body.childNodes.find(node => node.className === 'update-banner');
  assert.ok(banner);
  push(ready);
  assert.equal(document.body.childNodes.filter(node => node.className === 'update-banner').length, 1);
  const [restart, later] = banner.childNodes.at(-1).childNodes;
  restart.dispatchEvent({ type: 'click', stopPropagation() {} });
  await Promise.resolve();
  assert.equal(installs, 1);
  later.dispatchEvent({ type: 'click', stopPropagation() {} });
  assert.deepEqual(JSON.parse(localStorage.getItem('quantm.updateDismissed')), ['1.1.0']);
  push({ mode: 'auto', status: 'checking' });
  push(ready);
  assert.equal(document.body.childNodes.some(node => node.className === 'update-banner'), false);

  // Portable builds offer Download; a later release still gets a notification.
  let downloads = 0;
  window.native.updates.download = async () => { downloads++; };
  push({ mode: 'notify', status: 'available', version: '1.2.0' });
  const available = document.body.childNodes.find(node => node.className === 'update-banner');
  assert.ok(available);
  const download = available.childNodes.at(-1).firstChild;
  assert.equal(download.childNodes.at(-1).firstChild.textContent, 'Download');
  download.dispatchEvent({ type: 'click', stopPropagation() {} });
  await Promise.resolve();
  assert.equal(downloads, 1);
  push({ mode: 'off', status: 'idle' });
  assert.equal(document.body.childNodes.some(node => node.className === 'update-banner'), false);
});
