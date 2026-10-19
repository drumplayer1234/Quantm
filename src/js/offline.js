// Downloaded tracks (the main process's offline.js does the downloading and storage).
// Keeps a live copy of the list for the UI and lets the player play files instead of streams.
//   offline.on('change', () => ...)          the list changed
//   offline.on('progress', (id, p) => ...)   a download moved: p = { received, total } | { done } | { error }
import { Emitter } from './dom.js';

const SCHEME = 'quantm-offline://';

class Offline extends Emitter {
  constructor() {
    super();
    this.entries = new Map();   // "<id>" -> entry from the main process
    this.progress = new Map();  // "<id>" -> { received, total } while downloading
    this.totalBytes = 0;
    this.ready = null;
  }

  get available() { return typeof window !== 'undefined' && !!(window.native && window.native.offline); }

  /** Load the list once; later calls return the same promise */
  init() {
    if (!this.ready) {
      if (!this.available) return (this.ready = Promise.resolve());
      window.native.offline.onProgress((p) => this.onProgress(p));
      this.ready = this.refresh().catch(() => {});
    }
    return this.ready;
  }

  async refresh() {
    const result = await window.native.offline.list();
    this.entries = new Map(result.entries.map(e => [String(e.id), e]));
    this.totalBytes = result.totalBytes || 0;
    (result.downloading || []).forEach(id => { if (!this.progress.has(String(id))) this.progress.set(String(id), { received: 0, total: 0 }); });
    this.emit('change');
    return result;
  }

  has(id) { return this.entries.has(String(id)); }
  get(id) { return this.entries.get(String(id)) || null; }
  isDownloading(id) { return this.progress.has(String(id)); }
  progressOf(id) { return this.progress.get(String(id)) || null; }

  /** Downloaded tracks, newest first, shaped like normal track objects (covers work offline) */
  tracks() {
    return [...this.entries.values()].map(e => Object.assign({}, e.track, {
      artwork_url: e.artFile ? `${SCHEME}art/${e.id}` : e.track.artwork_url,
      offline: true
    }));
  }

  /** A stream description the player can attach, like api.streamFor() returns */
  streamFor(id) {
    const entry = this.get(id);
    return entry ? { url: `${SCHEME}track/${entry.id}`, protocol: 'progressive', snipped: false, track: {}, offline: true } : null;
  }

  /** Returns { ok, error? } */
  async download(track) {
    const key = String(track.id);
    if (this.has(key)) return { ok: true };
    if (this.isDownloading(key)) return { ok: false, error: 'Already downloading' };
    this.progress.set(key, { received: 0, total: 0 });
    this.emit('progress', track.id, this.progress.get(key));
    const result = await window.native.offline.download(track.id);
    this.progress.delete(key);
    if (result && result.ok) await this.refresh();
    this.emit('progress', track.id, result && result.ok ? { done: true } : { error: result && result.error });
    return result || { ok: false, error: 'Download failed' };
  }

  cancel(id) { return window.native.offline.cancel(id); }

  async remove(id) {
    await window.native.offline.remove(id);
    await this.refresh();
  }

  async removeAll() {
    await window.native.offline.removeAll();
    await this.refresh();
  }

  openFolder() { return window.native.offline.openFolder(); }

  onProgress(p) {
    const key = String(p.id);
    if (p.done || p.error) this.progress.delete(key);
    else this.progress.set(key, { received: p.received, total: p.total });
    this.emit('progress', p.id, p);
  }
}

export const offline = new Offline();

/** "12.4 MB" */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return Math.max(0, Math.round(n / 1024)) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
