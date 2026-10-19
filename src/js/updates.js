// One bridge subscription shared by the shell and any open Settings view.
import { h } from './dom.js';
import { button, toast } from './ui.js';

const listeners = new Set();
const shown = new Set();
const dismissed = new Set();
const DISMISSED_KEY = 'quantm.updateDismissed';
let initialized = false;
let latest = null;
let banner = null;
let bannerKey = null;

export function updateStatusText(state) {
  if (state.mode === 'off') return 'Updates are off when running from source';
  switch (state.status) {
    case 'checking': return 'Checking…';
    case 'current': return "You're up to date";
    case 'available': return `Version ${state.version} available`;
    case 'downloading': return `Downloading ${state.version} — ${Math.round(state.percent || 0)}%`;
    case 'ready': return `Version ${state.version} ready — Restart to update`;
    case 'error': return state.error || 'Unable to check for updates';
    default: return 'Check for a new version of Quantm';
  }
}

export function subscribeUpdates(listener) {
  listeners.add(listener);
  if (latest) listener(latest);
  return () => listeners.delete(listener);
}

// Bridge rejections are distinct from updater error states; surface both safely.
export async function performUpdate(action, value) {
  try {
    const result = await window.native.updates[action](value);
    if (result && typeof result === 'object') receive(result);
    if (action === 'install' && result === false) toast('The update is not ready to install', 'error');
    return result;
  } catch (error) {
    toast(error.message || 'Unable to update Quantm', 'error');
  }
}

function removeBanner() {
  banner?.remove();
  banner = null;
  bannerKey = null;
}

function receive(state) {
  latest = state;
  listeners.forEach(listener => listener(state));
  const eligible = state.mode !== 'off' && state.version &&
    (state.status === 'ready' || (state.status === 'available' && state.mode === 'notify'));
  const key = state.status + ':' + state.version;
  if (!eligible || dismissed.has(state.version)) { removeBanner(); return; }
  if (bannerKey === key) return;
  removeBanner();
  if (shown.has(key)) return;
  shown.add(key);
  bannerKey = key;
  const ready = state.status === 'ready';
  const action = button(ready ? 'Restart now' : 'Download', async () => {
    action.disabled = true;
    await performUpdate(ready ? 'install' : 'download');
    action.disabled = false;
  }, 'btn-primary');
  const later = () => {
    dismissed.add(state.version);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed])); } catch (e) { /* storage may be unavailable */ }
    removeBanner();
  };
  banner = h('aside.update-banner', { 'aria-label': 'Quantm update' },
    h('p.update-banner-title', { role: 'status' }, `Quantm ${state.version} is ${ready ? 'ready' : 'available'}`),
    ready ? h('p.muted.small', 'It will install when you close Quantm') : null,
    h('div.update-banner-actions', action, button('Later', later, 'btn-ghost'))
  );
  document.body.append(banner);
}

export function initUpdates() {
  if (initialized || !window.native?.updates) return;
  initialized = true;
  try {
    const saved = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]');
    if (Array.isArray(saved)) saved.filter(v => typeof v === 'string').forEach(v => dismissed.add(v));
  } catch (e) { /* ignore invalid or unavailable storage */ }
  window.native.updates.onStatus(receive);
  // A pushed status wins over an older initial snapshot.
  window.native.updates.status().then(state => { if (!latest) receive(state); }).catch(() => {
    if (!latest) receive({ status: 'error', mode: 'auto', error: 'Unable to read update status' });
  });
}
