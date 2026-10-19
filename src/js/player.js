// Playback engine: queue, HLS streaming, shuffle/repeat, media keys (navigator.mediaSession)
import * as api from './api.js';
import * as cues from './cues.js';
import { offline } from './offline.js';
import { Emitter, artwork } from './dom.js';
import { store, settings, saveSettings } from './store.js';
import { toast } from './ui.js';
import { Normalizer } from './normalizer.js';

/** Uniformly random order (Fisher-Yates), returns a new array */
function randomOrder(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SESSION_KEY = 'quantm.session';
const PREPARE_LEAD = 8; // seconds before a crossfade starts that the next stream is looked up

const clampSpeed = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(2, Math.max(0.5, n)) : 1;
};

class Player extends Emitter {
  constructor() {
    super();
    // two audio elements ("decks"): one plays, the other takes over during a crossfade
    this.decks = [this.makeDeck(), this.makeDeck()];
    this.active = 0;
    this.fading = null;     // { outgoing, incoming, ... } while two songs overlap
    this.prepared = null;   // the next song's stream, looked up ahead of a crossfade
    this.noCrossfade = false;

    // volume is applied in the Web Audio graph (after loudness normalization)
    this.volume = settings.volume;
    this.muted = settings.muted;
    this.normalizer = new Normalizer(this.decks[0].audio);
    this.normalizer.enabled = settings.normalize !== false;
    this.normalizer.setEqualizer(settings.eq);
    this.normalizer.setVolume(this.volume, this.muted);

    this.queue = [];        // tracks in play order
    this.index = -1;        // position in queue
    this.original = null;   // un-shuffled queue, when shuffle is on
    this.context = null;    // { label, href } where the queue came from
    this.shuffle = settings.shuffle;
    this.repeat = settings.repeat;
    this.loadId = 0;
    this.loading = false;

    this.decks.forEach(deck => this.bindDeck(deck));
    this.speedKey = '';
    this.syncSpeed();
    store.on('settings', () => { this.syncSpeed(); this.normalizer.setEqualizer(settings.eq); });

    this.setupMediaSession();

    // remember the session: on song / queue / pause changes, every few seconds while playing, and on close
    this.on('queue', () => this.saveSession());
    setInterval(() => { if (this.playing) this.saveSession(); }, 5000);
    window.addEventListener('beforeunload', () => this.saveSession());
  }

  /** The deck playing the current song (during a crossfade, the incoming one) */
  get deck() { return this.decks[this.active]; }
  get audio() { return this.deck.audio; }
  get current() { return this.queue[this.index] || null; }
  get playing() { return !this.audio.paused; }
  get duration() {
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : (this.current ? this.current.duration / 1000 : 0);
  }

  makeDeck() {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous'; // needed to route progressive streams through Web Audio
    return { audio, hls: null, track: null };
  }

  /** Wire a deck's media events. Only the active deck drives the UI; the fading one stays quiet. */
  bindDeck(deck) {
    const a = deck.audio;
    const live = (fn) => (...args) => { if (this.deck === deck) fn(...args); };
    a.addEventListener('timeupdate', live(() => {
      this.emit('time', a.currentTime, this.duration);
      this.checkCrossfade();
    }));
    a.addEventListener('durationchange', live(() => { this.emit('time', a.currentTime, this.duration); this.emit('timeline'); }));
    a.addEventListener('play', live(() => { this.emit('state'); this.updateMediaSession(); }));
    a.addEventListener('pause', live(() => { this.emit('state'); this.updateMediaSession(); this.saveSession(); }));
    a.addEventListener('waiting', live(() => this.emit('buffering', true)));
    a.addEventListener('playing', live(() => this.emit('buffering', false)));
    a.addEventListener('ended', live(() => this.onEnded()));
    a.addEventListener('seeked', live(() => { this.saveSession(); this.emit('timeline'); }));
    // a new source can reset the rate, so put it back once the media is known
    a.addEventListener('loadedmetadata', () => this.applySpeed(a));
  }

  // ---- speed: Normal / Nightcore / Slowed / Custom ----------------------------

  /** Rate and pitch behavior for the current Speed settings */
  get speedInfo() {
    switch (settings.speedMode) {
      case 'nightcore': return { rate: 1.25, keepPitch: false };
      case 'slowed': return { rate: 0.8, keepPitch: false };
      case 'custom': return { rate: clampSpeed(settings.playbackSpeed), keepPitch: settings.keepPitch !== false };
      default: return { rate: 1, keepPitch: true };
    }
  }

  get rate() { return this.speedInfo.rate; }

  /** Short text for the player bar button: "1×", "1.25×", "NC", "SL" */
  get speedLabel() {
    if (settings.speedMode === 'nightcore') return 'NC';
    if (settings.speedMode === 'slowed') return 'SL';
    return `${+this.rate.toFixed(2)}×`;
  }

  applySpeed(audio) {
    const { rate, keepPitch } = this.speedInfo;
    audio.preservesPitch = keepPitch;
    audio.defaultPlaybackRate = rate; // survives loading a new source
    audio.playbackRate = rate;
  }

  /** Apply the speed settings to both decks when they change */
  syncSpeed() {
    const { rate, keepPitch } = this.speedInfo;
    const key = `${settings.speedMode}|${rate}|${keepPitch}`;
    if (key === this.speedKey) return;
    this.speedKey = key;
    this.decks.forEach(deck => this.applySpeed(deck.audio));
    this.emit('speed', rate);
  }

  setSpeedMode(mode) { saveSettings({ speedMode: mode }); }

  /** A numeric speed always means Custom mode */
  setSpeed(value) { saveSettings({ speedMode: 'custom', playbackSpeed: +clampSpeed(Math.round(value / 0.05) * 0.05).toFixed(2) }); }

  nudgeSpeed(delta) {
    this.setSpeed(this.rate + delta);
    toast(`Speed ${this.speedLabel}`);
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
    const started = this.load();
    if (this.shuffle) this.shuffleWholeCollection();
    return started;
  }

  /** Turn shuffle on and start a random track; the whole collection gets shuffled in */
  shufflePlay(tracks, context = null) {
    const playable = tracks.filter(t => t && t.kind !== 'playlist');
    if (!playable.length) return;
    if (!this.shuffle) {
      this.shuffle = true;
      saveSettings({ shuffle: true });
      this.emit('modes');
    }
    return this.playList(playable, Math.floor(Math.random() * playable.length), context);
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
    const [track] = this.queue.splice(position, 1);
    if (position < this.index) this.index--;
    // keep the un-shuffled copy in sync, or the track comes back when shuffle is turned off
    if (this.original) {
      const at = this.original.indexOf(track);
      if (at !== -1) this.original.splice(at, 1);
    }
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
    const current = this.current;
    this.queue = current ? [current] : [];
    this.index = current ? 0 : -1;
    this.original = null;
    this.emit('queue');
  }

  jump(position) {
    this.index = position;
    this.emit('queue');
    return this.load();
  }

  /** A downloaded file when there is one (works offline, artist's original quality), else the stream */
  async streamOf(track) {
    await offline.init();
    return offline.has(track.id) ? offline.streamFor(track.id) : api.streamFor(track);
  }

  /** Load the current queue entry. autoplay=false is used when restoring the last session */
  async load({ autoplay = true, startAt = 0 } = {}) {
    const track = this.current;
    if (!track) return;
    const loadId = ++this.loadId;
    this.cutFade();
    this.prepared = null;
    this.loading = true;
    this.normalizer.init();
    this.normalizer.setActive(this.audio);
    this.normalizer.startTrack(track.id);
    this.emit('track', track);
    this.emit('buffering', true);

    let stream;
    try {
      stream = await this.streamOf(track);
    } catch (error) {
      if (loadId !== this.loadId) return;
      this.loading = false;
      this.emit('buffering', false);
      toast(error && error.data === 'protected'
        ? `"${track.title}" is copy-protected and only plays in SoundCloud's own app. Use Open in SoundCloud on the track.`
        : `Can't play "${track.title}"`, 'error');
      // skip unplayable tracks, but stop if the whole queue is unplayable
      if (this.index < this.queue.length - 1) setTimeout(() => loadId === this.loadId && this.next(true), 800);
      return;
    }
    if (loadId !== this.loadId) return;

    Object.assign(track, stream.track);
    if (stream.snipped) toast('Only a 30 second preview is available for this track');
    this.attach(stream, autoplay, startAt);
    this.loading = false;
    if (!autoplay) this.emit('buffering', false);
    this.updateMediaSession();
    this.emit('track', track);
    if (autoplay) this.notify(track);
    this.saveSession();
  }

  attach(stream, autoplay = true, startAt = 0, deck = this.deck, track = this.current) {
    if (deck.hls) {
      deck.hls.destroy();
      deck.hls = null;
    }
    const audio = deck.audio;
    deck.track = track;
    this.applySpeed(audio);
    if (startAt > 0) {
      audio.addEventListener('loadedmetadata', () => { audio.currentTime = Math.min(startAt, Math.max(0, audio.duration - 1)); }, { once: true });
    }

    if (stream.protocol === 'hls' && window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ maxBufferLength: 30, enableWorker: true });
      deck.hls = hls;
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => { if (autoplay) audio.play().catch(() => {}); });
      hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (!data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          // signed urls expire: re-resolve and resume where we were
          const position = audio.currentTime;
          api.streamFor(track).then((fresh) => {
            if (deck.track !== track) return; // the deck moved on to another song meanwhile
            this.attach(fresh, true, 0, deck, track);
            audio.addEventListener('loadedmetadata', () => { audio.currentTime = position; }, { once: true });
          }).catch(() => toast('Playback stopped: network error', 'error'));
        }
      });
      hls.loadSource(stream.url);
      hls.attachMedia(audio);
    } else {
      audio.src = stream.url;
      if (autoplay) audio.play().catch(() => {});
    }
  }

  /** Stop a deck and let go of its stream */
  releaseDeck(deck) {
    if (deck.hls) {
      deck.hls.destroy();
      deck.hls = null;
    }
    deck.track = null;
    deck.audio.pause();
    deck.audio.removeAttribute('src');
    deck.audio.load();
  }

  // ---- crossfade -----------------------------------------------------------------

  crossfadeSeconds() {
    const n = Number(settings.crossfade);
    return Number.isFinite(n) ? Math.min(12, Math.max(0, n)) : 0;
  }

  /** How the current song hands over to the next: its mix points (cues.js), or plain crossfade */
  upcomingTransition() {
    const prep = this.prepared && this.prepared.loadId === this.loadId ? this.prepared : null;
    const next = (prep && prep.track) || this.queue[this.index + 1] || null;
    return cues.transitionFor(this.current.id, next ? next.id : null, this.crossfadeSeconds());
  }

  /** Runs as the song plays: look up the next stream a little early, then start the overlap */
  checkCrossfade() {
    const audio = this.audio;
    if (this.stopAtTrackEnd || this.fading || this.loading || this.noCrossfade || !this.current) return;
    if (this.repeat === 'one' || audio.paused || audio.seeking || !this.normalizer.ctx) return;
    const dur = audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    const t = this.upcomingTransition();
    const span = t.fade * (audio.playbackRate || 1); // media seconds the fade covers
    // a mix-out point wins, unless you've skipped well past it (then the song plays on)
    let mixAt = t.out != null && t.out < dur - 0.25 && audio.currentTime <= t.out + 3 ? t.out : null;
    if (mixAt === null) {
      if (!t.fade) {
        if (!t.custom) return; // crossfade off and no mix points
        mixAt = dur - 0.2; // a clean, gapless cut into the next song's mix-in point
      } else {
        if (!t.custom && dur < span * 2) return; // too short to crossfade
        mixAt = dur - span;
      }
    }
    const until = mixAt - audio.currentTime;
    if (until > PREPARE_LEAD) return;
    if (!this.prepared || this.prepared.loadId !== this.loadId) { this.prepareNext(); return; }
    if (until > 0 || !this.prepared.stream) return;
    this.startCrossfade();
  }

  /** Work out what next() would play, without moving there yet, and resolve its stream */
  async prepareNext() {
    const prep = { loadId: this.loadId, from: this.index, track: null, stream: null, failed: false, wrap: false, order: null };
    this.prepared = prep;
    try {
      if (this.index < this.queue.length - 1) {
        prep.track = this.queue[this.index + 1];
      } else if (this.repeat === 'all') {
        prep.wrap = true;
        prep.order = this.shuffle ? randomOrder(this.queue) : null;
        prep.track = (prep.order || this.queue)[0];
      } else if (settings.autoplayRelated && this.current) {
        const added = await this.appendRelated();
        if (prep.loadId !== this.loadId || this.index !== prep.from) return;
        prep.track = added ? this.queue[this.index + 1] : null;
      }
      if (!prep.track) { prep.failed = true; return; }
      const stream = await this.streamOf(prep.track);
      if (this.prepared !== prep) return;
      prep.stream = stream;
    } catch (e) {
      prep.failed = true; // the normal end-of-song path will deal with it
    }
  }

  /** Bring the next song in on the idle deck while the current one fades out */
  startCrossfade() {
    const prep = this.prepared;
    this.prepared = null;
    // the queue may have been edited since we looked ahead; if so, look again
    const valid = prep.wrap
      ? this.repeat === 'all' && this.index === this.queue.length - 1
      : this.queue[this.index + 1] === prep.track && this.index === prep.from;
    if (!valid) return;

    const norm = this.normalizer;
    const outgoing = this.deck;
    const incoming = this.decks[1 - this.active];
    if (!norm.addDeck(incoming.audio)) { this.noCrossfade = true; return; }
    const audio = outgoing.audio;
    const left = (audio.duration - audio.currentTime) / (audio.playbackRate || 1);
    // where the next song comes in and how long the overlap lasts (0 = a clean cut)
    const transition = cues.transitionFor(this.current.id, prep.track.id, this.crossfadeSeconds());
    const seconds = transition.fade ? Math.max(0.5, Math.min(transition.fade, left)) : 0.1;
    const startAt = Math.max(0, transition.in || 0);

    // move to the next song exactly like next() would
    if (prep.wrap) {
      if (prep.order) this.queue = prep.order;
      this.index = 0;
    } else {
      this.index++;
    }
    const track = this.current;
    this.loadId++;
    this.releaseDeck(incoming);
    const fading = this.fading = { outgoing, incoming, seconds, progress: 0, startedAt: null, timer: null, fallback: null };

    norm.setFade(incoming.audio, 0);
    norm.setFade(outgoing.audio, 1);
    norm.startTrack(track.id, seconds);
    Object.assign(track, prep.stream.track);
    if (prep.stream.snipped) toast('Only a 30 second preview is available for this track');
    this.active = 1 - this.active;
    norm.setActive(incoming.audio);
    this.attach(prep.stream, true, startAt, incoming, track);
    // the fade starts once the new song is really playing, so no silence in the middle of it
    incoming.audio.addEventListener('playing', () => this.beginFade(), { once: true });
    fading.fallback = setTimeout(() => this.beginFade(), 3000);

    this.emit('queue');
    this.emit('track', track);
    this.emit('time', startAt, this.duration);
    this.updateMediaSession();
    this.notify(track);
    this.saveSession();
  }

  beginFade() {
    const f = this.fading;
    if (!f || f.startedAt !== null || this.audio.paused) return;
    clearTimeout(f.fallback);
    const norm = this.normalizer;
    const left = f.seconds * (1 - f.progress);
    f.startedAt = norm.ctx.currentTime;
    norm.fadeDeck(f.incoming.audio, true, left, f.progress);
    norm.fadeDeck(f.outgoing.audio, false, left, f.progress);
    clearTimeout(f.timer);
    f.timer = setTimeout(() => this.finishFade(f), left * 1000 + 100);
  }

  /** Pausing mid-crossfade freezes the blend where it is */
  holdFade() {
    const f = this.fading;
    if (!f || f.startedAt === null) return;
    const norm = this.normalizer;
    f.progress = Math.min(1, f.progress + (norm.ctx.currentTime - f.startedAt) / f.seconds);
    f.startedAt = null;
    clearTimeout(f.timer);
    norm.holdFade(f.incoming.audio, true, f.progress);
    norm.holdFade(f.outgoing.audio, false, f.progress);
  }

  /** The fade is over: stop and detach the old deck */
  finishFade(f) {
    if (this.fading !== f) return;
    this.fading = null;
    clearTimeout(f.timer);
    clearTimeout(f.fallback);
    this.releaseDeck(f.outgoing);
    this.normalizer.setFade(f.outgoing.audio, 1);
    this.normalizer.setFade(f.incoming.audio, 1);
  }

  /** Manual skips cut cleanly: drop the fading deck now and bring the active one to full level */
  cutFade() {
    if (this.fading) this.finishFade(this.fading);
  }

  // ---- remember the session across restarts ----------------------------------

  /** Save what's playing, where, and the queue (slimmed down so it fits in storage) */
  saveSession() {
    if (!this.current) return;
    const slim = (t) => ({
      id: t.id, kind: 'track', title: t.title, duration: t.duration, full_duration: t.full_duration,
      artwork_url: t.artwork_url, permalink_url: t.permalink_url, waveform_url: t.waveform_url,
      station_urn: t.station_urn, genre: t.genre, playback_count: t.playback_count,
      likes_count: t.likes_count, reposts_count: t.reposts_count, comment_count: t.comment_count,
      user: t.user && { id: t.user.id, username: t.user.username, avatar_url: t.user.avatar_url, permalink_url: t.user.permalink_url }
    });
    // keep the queue around the current song, capped so storage never overflows
    const start = Math.max(0, this.index - 50);
    const queue = this.queue.slice(start, start + 500);
    const session = {
      queue: queue.map(slim),
      index: this.index - start,
      position: Math.floor(this.audio.currentTime || 0),
      context: this.context ? { label: this.context.label, href: this.context.href } : null,
      savedAt: Date.now()
    };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* storage full */ }
  }

  /** Put the last session back in the player bar, paused at the same spot */
  restoreSession() {
    if (settings.resumeSession === false || this.current) return false;
    let session;
    try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return false; }
    if (!session || !Array.isArray(session.queue) || !session.queue[session.index]) return false;
    this.queue = session.queue;
    this.index = session.index;
    this.context = session.context;
    this.original = null;
    this.emit('queue');
    this.load({ autoplay: false, startAt: session.position || 0 });
    return true;
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) this.play();
    else this.pause();
  }

  /** Both decks play / pause together while a crossfade is running */
  play() {
    if (!this.current) return;
    this.audio.play().catch(() => {});
    const f = this.fading;
    if (!f) return;
    if (!f.outgoing.audio.ended) f.outgoing.audio.play().catch(() => {});
    this.beginFade();
  }

  pause() {
    this.audio.pause();
    this.holdFade();
    if (this.fading) this.fading.outgoing.audio.pause();
  }

  async next(auto = false) {
    if (!this.queue.length) return;
    if (this.index < this.queue.length - 1) {
      this.index++;
    } else if (this.repeat === 'all') {
      if (this.shuffle) this.queue = randomOrder(this.queue);
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
    if (this.stopAtTrackEnd) { this.emit('sleepend'); return; }
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
    this.volume = Math.max(0, Math.min(1, value));
    if (this.muted && value > 0) this.muted = false;
    this.normalizer.setVolume(this.volume, this.muted);
    saveSettings({ volume: this.volume, muted: this.muted });
    this.emit('volume', this.volume, this.muted);
  }

  toggleMute() {
    this.muted = !this.muted;
    this.normalizer.setVolume(this.volume, this.muted);
    saveSettings({ muted: this.muted });
    this.emit('volume', this.volume, this.muted);
  }

  setNormalize(on) {
    this.normalizer.setEnabled(on);
    saveSettings({ normalize: on });
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    if (this.shuffle) {
      this.applyShuffle();
      this.shuffleWholeCollection();
    }
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
    const rest = randomOrder(this.queue.filter((t, i) => i !== this.index));
    this.queue = current ? [current, ...rest] : rest;
    this.index = current ? 0 : -1;
  }

  /**
   * Lists like Likes load in pages. Load every remaining page of the list the queue
   * came from, then put the whole collection (minus the current song) in random order.
   */
  async shuffleWholeCollection() {
    const context = this.context;
    if (!context || !context.loadAll || this.loadingAll === context) return;
    this.loadingAll = context;
    let all;
    try {
      all = await context.loadAll();
    } catch (e) {
      return;
    } finally {
      this.loadingAll = null;
    }
    // the user may have started something else or turned shuffle off meanwhile
    if (this.context !== context || !this.shuffle) return;

    const current = this.current;
    const tracks = all.filter(t => t && t.kind !== 'playlist');
    if (tracks.length <= this.queue.length) return;
    const played = this.queue.slice(0, this.index);
    const rest = randomOrder(tracks.filter(t => (!current || t.id !== current.id) && !played.some(p => p.id === t.id)));
    this.original = tracks;
    this.queue = [...played, ...(current ? [current] : []), ...rest];
    this.emit('queue');
    toast(`Shuffling all ${tracks.length} tracks`);
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
