// Playback engine: queue, HLS streaming, shuffle/repeat, media keys (navigator.mediaSession)
import * as api from './api.js';
import { Emitter, artwork } from './dom.js';
import { settings, saveSettings } from './store.js';
import { toast } from './ui.js';

class Player extends Emitter {
  constructor() {
    super();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.volume = settings.volume;
    this.audio.muted = settings.muted;
    this.hls = null;

    this.queue = [];        // tracks in play order
    this.index = -1;        // position in queue
    this.original = null;   // un-shuffled queue, when shuffle is on
    this.context = null;    // { label, href } where the queue came from
    this.shuffle = settings.shuffle;
    this.repeat = settings.repeat;
    this.loadId = 0;
    this.loading = false;

    this.audio.addEventListener('timeupdate', () => this.emit('time', this.audio.currentTime, this.duration));
    this.audio.addEventListener('durationchange', () => this.emit('time', this.audio.currentTime, this.duration));
    this.audio.addEventListener('play', () => { this.emit('state'); this.updateMediaSession(); });
    this.audio.addEventListener('pause', () => { this.emit('state'); this.updateMediaSession(); });
    this.audio.addEventListener('waiting', () => this.emit('buffering', true));
    this.audio.addEventListener('playing', () => this.emit('buffering', false));
    this.audio.addEventListener('volumechange', () => this.emit('volume', this.audio.volume, this.audio.muted));
    this.audio.addEventListener('ended', () => this.onEnded());

    this.setupMediaSession();
  }

  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused; }
  get duration() {
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : (this.current ? this.current.duration / 1000 : 0);
  }

  /**
   * Play a list of tracks starting at index.
   * context: { label: 'Likes', href: '#/library/likes' } shown in the queue panel
   */
  playList(tracks, index = 0, context = null) {
    const playable = tracks.filter(t => t && t.kind !== 'playlist');
    const start = playable.indexOf(tracks[index]);
    this.queue = playable.slice();
    this.index = Math.max(0, start);
    this.context = context;
    this.original = null;
    if (this.shuffle) this.applyShuffle();
    this.emit('queue');
    return this.load();
  }

  /** Play a single track (keeps it as a one-item queue unless it's already queued) */
  playTrack(track, context) {
    const existing = this.queue.findIndex(t => t.id === track.id);
    if (existing > -1) return this.jump(existing);
    return this.playList([track], 0, context);
  }

  /** Same track: toggle pause. Otherwise play list from index */
  toggleOrPlay(tracks, index, context) {
    const track = tracks[index];
    if (this.current && track && this.current.id === track.id) return this.toggle();
    return this.playList(tracks, index, context);
  }

  playNext(track) {
    this.queue.splice(this.index + 1, 0, track);
    if (this.original) this.original.push(track);
    this.emit('queue');
    if (this.index === -1) { this.index = 0; this.load(); }
    toast(`"${track.title}" will play next`);
  }

  addToQueue(tracks) {
    tracks = [].concat(tracks);
    this.queue.push(...tracks);
    if (this.original) this.original.push(...tracks);
    this.emit('queue');
    if (this.index === -1) { this.index = 0; this.load(); }
    toast(tracks.length === 1 ? `Added "${tracks[0].title}" to the queue` : `Added ${tracks.length} tracks to the queue`);
  }

  removeFromQueue(position) {
    if (position === this.index) return;
    this.queue.splice(position, 1);
    if (position < this.index) this.index--;
    this.emit('queue');
  }

  moveInQueue(from, to) {
    const [track] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, track);
    if (from === this.index) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this.emit('queue');
  }

  clearQueue() {
    this.queue = this.current ? [this.current] : [];
    this.index = this.current ? 0 : -1;
    this.original = null;
    this.emit('queue');
  }

  jump(position) {
    this.index = position;
    this.emit('queue');
    return this.load();
  }

  async load() {
    const track = this.current;
    if (!track) return;
    const loadId = ++this.loadId;
    this.loading = true;
    this.emit('track', track);
    this.emit('buffering', true);

    let stream;
    try {
      stream = await api.streamFor(track);
    } catch (error) {
      if (loadId !== this.loadId) return;
      this.loading = false;
      this.emit('buffering', false);
      toast(`Can't play "${track.title}"`, 'error');
      // skip unplayable tracks, but stop if the whole queue is unplayable
      if (this.index < this.queue.length - 1) setTimeout(() => loadId === this.loadId && this.next(true), 800);
      return;
    }
    if (loadId !== this.loadId) return;

    Object.assign(track, stream.track);
    if (stream.snipped) toast('Only a 30 second preview is available for this track');
    this.attach(stream);
    this.loading = false;
    this.updateMediaSession();
    this.emit('track', track);
    this.notify(track);
  }

  attach(stream) {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    const audio = this.audio;

    if (stream.protocol === 'hls' && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ maxBufferLength: 30, enableWorker: true });
      this.hls = hls;
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => audio.play().catch(() => {}));
      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          // signed urls expire: re-resolve and resume where we were
          const position = audio.currentTime;
          api.streamFor(this.current).then((fresh) => {
            this.attach(fresh);
            audio.addEventListener('loadedmetadata', () => { audio.currentTime = position; }, { once: true });
          }).catch(() => toast('Playback stopped: network error', 'error'));
        }
      });
      hls.loadSource(stream.url);
      hls.attachMedia(audio);
    } else {
      audio.src = stream.url;
      audio.play().catch(() => {});
    }
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.audio.play().catch(() => {});
    else this.audio.pause();
  }

  play() { if (this.current) this.audio.play().catch(() => {}); }
  pause() { this.audio.pause(); }

  async next(auto = false) {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) {
      this.index++;
    } else if (this.repeat === 'all') {
      this.index = 0;
    } else if (settings.autoplayRelated && this.current) {
      // like soundcloud.com: keep playing related tracks
      const added = await this.appendRelated();
      if (!added) return;
      this.index++;
    } else {
      return;
    }
    this.emit('queue');
    return this.load();
  }

  async appendRelated() {
    try {
      const pager = api.relatedTracks(this.current.id);
      const related = (await pager.next()).filter(t => !this.queue.some(q => q.id === t.id));
      if (!related.length) return false;
      this.queue.push(...related.slice(0, 10));
      if (this.original) this.original.push(...related.slice(0, 10));
      return true;
    } catch (e) {
      return false;
    }
  }

  prev() {
    if (this.audio.currentTime > 3 || this.index <= 0) {
      this.audio.currentTime = 0;
      return;
    }
    this.index--;
    this.emit('queue');
    return this.load();
  }

  onEnded() {
    if (this.repeat === 'one') {
      this.audio.currentTime = 0;
      this.audio.play().catch(() => {});
      return;
    }
    this.next(true);
  }

  seek(seconds) {
    if (!this.current) return;
    this.audio.currentTime = Math.max(0, Math.min(seconds, this.duration - 0.25));
  }

  seekBy(delta) { this.seek(this.audio.currentTime + delta); }

  setVolume(value) {
    this.audio.volume = Math.max(0, Math.min(1, value));
    if (this.audio.muted && value > 0) this.audio.muted = false;
    saveSettings({ volume: this.audio.volume, muted: this.audio.muted });
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    saveSettings({ muted: this.audio.muted });
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.shuffle) this.applyShuffle();
    else if (this.original) {
      const current = this.current;
      this.queue = this.original;
      this.index = Math.max(0, this.queue.indexOf(current));
      this.original = null;
    }
    saveSettings({ shuffle: this.shuffle });
    this.emit('queue');
    this.emit('modes');
  }

  applyShuffle() {
    const current = this.current;
    this.original = this.queue.slice();
    const rest = this.queue.filter((t, i) => i !== this.index);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.queue = current ? [current, ...rest] : rest;
    this.index = current ? 0 : -1;
  }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    saveSettings({ repeat: this.repeat });
    this.emit('modes');
  }

  // ---- OS integration -------------------------------------------------------

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => this.play());
    ms.setActionHandler('pause', () => this.pause());
    ms.setActionHandler('previoustrack', () => this.prev());
    ms.setActionHandler('nexttrack', () => this.next());
    ms.setActionHandler('seekto', (details) => this.seek(details.seekTime));
    ms.setActionHandler('seekbackward', () => this.seekBy(-10));
    ms.setActionHandler('seekforward', () => this.seekBy(10));
  }

  updateMediaSession() {
    if (!('mediaSession' in navigator) || !this.current) return;
    const track = this.current;
    const cover = artwork(track.artwork_url || (track.user && track.user.avatar_url), 't500x500');
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.user ? track.user.username : '',
      album: this.context ? this.context.label : 'SoundCloud',
      artwork: cover ? [{ src: cover, sizes: '500x500', type: 'image/jpeg' }] : []
    });
    navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
  }

  notify(track) {
    if (!settings.notifications || document.hasFocus()) return;
    try {
      new Notification(track.title, {
        body: track.user ? track.user.username : '',
        icon: artwork(track.artwork_url || (track.user && track.user.avatar_url), 't300x300') || undefined,
        silent: true
      });
    } catch (e) { /* notifications unavailable */ }
  }
}

export const player = new Player();
