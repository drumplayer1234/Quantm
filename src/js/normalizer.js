// Loudness normalization: tracks on SoundCloud are mastered at very different levels.
// Audio is routed through Web Audio so we can measure each track's loudness while it
// plays and nudge a gain node toward a common target, like Spotify's "normalize volume".
//
//   <audio> → source ─┬─ meter tap → meter (K-weighting-ish filters → analyser)
//                     └─ deck fade gain → normalize gain → preamp → EQ → limiter → user volume → sleep gain → speakers
//
// There is one source + fade gain per <audio> element ("deck"), so two tracks can
// overlap while crossfading. The meter only listens to the active deck.

import { safeParse } from './store.js';
import { EQ_BANDS, normalizeEqualizer } from './equalizer.js';

const TARGET = -14;          // dB, roughly the -14 LUFS streaming services use
const MAX_BOOST = 9;         // never boost quiet tracks by more than this
const MAX_CUT = -15;
const BLOCK_MS = 100;        // one loudness measurement every 100ms
const MIN_BLOCKS = 15;       // wait 1.5s of audio before the first adjustment
const CACHE_KEY = 'quantm.loudness';
const CACHE_LIMIT = 3000;

const CURVE_POINTS = 96;     // resolution of the equal-power crossfade curves

const dbToGain = (db) => Math.pow(10, db / 20);
/** Equal-power fade level at t (0..1): the two tracks together keep a steady loudness */
const fadeLevel = (fadeIn, t) => (fadeIn ? Math.sin(t * Math.PI / 2) : Math.cos(t * Math.PI / 2));

export class Normalizer {
  constructor(audio) {
    this.audio = audio;      // the active deck: the one being measured
    this.decks = new Map();  // <audio> → { source, tap, fade }
    this.enabled = true;
    this.ctx = null;
    this.blocks = [];        // mean-square energy per block for the current track
    this.trackId = null;
    this.cache = safeParse(localStorage.getItem(CACHE_KEY));
    this.equalizer = normalizeEqualizer();
    this.volume = 1;
    this.muted = false;
  }

  /** Build the audio graph lazily (needs to happen once, before playback) */
  init() {
    if (this.ctx) return true;
    try {
      const ctx = new AudioContext();

      // meter branch: rough K-weighting so bass-heavy tracks aren't over-counted
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 60;
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf';
      shelf.frequency.value = 1500;
      shelf.gain.value = 4;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      const silent = ctx.createGain();
      silent.gain.value = 0; // keeps the meter branch running without making sound
      highpass.connect(shelf).connect(this.analyser).connect(silent).connect(ctx.destination);
      this.meterIn = highpass;

      // output branch (every deck's fade gain feeds this.gain)
      this.gain = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.25;
      this.output = ctx.createGain();
      this.preamp = ctx.createGain();
      this.eqFilters = EQ_BANDS.map((frequency, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking';
        filter.frequency.value = Math.min(frequency, ctx.sampleRate / 2);
        filter.Q.value = 1;
        return filter;
      });
      let tail = this.gain.connect(this.preamp);
      this.eqFilters.forEach(filter => { tail = tail.connect(filter); });
      this.sleepGain = ctx.createGain();
      tail.connect(this.limiter).connect(this.output).connect(this.sleepGain).connect(ctx.destination);

      // visualizer tap: after normalization, before user volume, so it looks the same at any volume
      this.visual = ctx.createAnalyser();
      this.visual.fftSize = 256;
      this.visual.smoothingTimeConstant = 0.78;
      this.limiter.connect(this.visual);

      this.ctx = ctx;
      this.buffer = new Float32Array(this.analyser.fftSize);
      if (!this.addDeck(this.audio)) { this.ctx = null; throw new Error('Could not route the audio element'); }
      this.setEqualizer(this.equalizer);
      this.applyVolume();
      setInterval(() => this.measure(), BLOCK_MS);
      return true;
    } catch (error) {
      console.error('Volume normalization unavailable', error);
      return false;
    }
  }

  /** Route another <audio> element through the graph (created lazily for the crossfade deck) */
  addDeck(audio) {
    if (!this.ctx || this.decks.has(audio)) return !!this.ctx;
    try {
      const ctx = this.ctx;
      const source = ctx.createMediaElementSource(audio);
      const tap = ctx.createGain(); // meter listens to the active deck only
      tap.gain.value = audio === this.audio ? 1 : 0;
      const fade = ctx.createGain();
      source.connect(tap).connect(this.meterIn);
      source.connect(fade).connect(this.gain);
      this.decks.set(audio, { source, tap, fade });
      return true;
    } catch (error) {
      console.error('Second audio deck unavailable', error);
      return false;
    }
  }

  /** The deck whose track is the current one: the meter measures it */
  setActive(audio) {
    this.audio = audio;
    for (const [el, deck] of this.decks) deck.tap.gain.value = el === audio ? 1 : 0;
  }

  /** Set a deck's fade gain right now (1 = full, 0 = silent) */
  setFade(audio, level) {
    const deck = this.decks.get(audio);
    if (!deck) return;
    deck.fade.gain.cancelScheduledValues(this.ctx.currentTime);
    deck.fade.gain.setValueAtTime(level, this.ctx.currentTime);
  }

  /** Equal-power fade from `from` (0..1 of the whole fade) to the end over `seconds` */
  fadeDeck(audio, fadeIn, seconds, from = 0) {
    const deck = this.decks.get(audio);
    if (!deck) return;
    const now = this.ctx.currentTime;
    deck.fade.gain.cancelScheduledValues(now);
    deck.fade.gain.setValueAtTime(fadeLevel(fadeIn, from), now);
    if (seconds <= 0 || from >= 1) { deck.fade.gain.setValueAtTime(fadeLevel(fadeIn, 1), now); return; }
    const curve = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) curve[i] = fadeLevel(fadeIn, from + (1 - from) * i / (CURVE_POINTS - 1));
    deck.fade.gain.setValueCurveAtTime(curve, now, seconds);
  }

  /** Freeze a deck's fade where it is (progress 0..1), used while paused mid-crossfade */
  holdFade(audio, fadeIn, progress) {
    this.setFade(audio, fadeLevel(fadeIn, Math.min(1, Math.max(0, progress))));
  }

  /** Called when a new track starts loading. smooth (seconds) eases the level in, for crossfades */
  startTrack(trackId, smooth = 0) {
    this.saveCurrent();
    this.trackId = trackId;
    this.blocks = [];
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // songs we've heard before start at the right level straight away
    const known = this.cache[trackId];
    const db = this.enabled && typeof known === 'number' ? this.gainFor(known) : 0;
    const now = this.ctx.currentTime;
    const from = this.gain.gain.value;
    this.gain.gain.cancelScheduledValues(now);
    if (smooth > 0) {
      this.gain.gain.setValueAtTime(from, now);
      this.gain.gain.setTargetAtTime(dbToGain(db), now, smooth / 3);
    } else {
      this.gain.gain.setValueAtTime(dbToGain(db), now);
    }
  }

  measure() {
    if (!this.ctx || this.audio.paused || this.audio.seeking || !this.trackId) return;
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0;
    for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
    const energy = sum / this.buffer.length;
    // absolute gate: ignore silence between songs or in intros
    if (energy < 1e-7) return;
    this.blocks.push(energy);
    if (!this.enabled || this.blocks.length < MIN_BLOCKS) return;

    const known = typeof this.cache[this.trackId] === 'number';
    let db = this.gainFor(this.integrated());
    // a quiet intro shouldn't get fully boosted before the loud part arrives:
    // allow boosting gradually over the first ~15s of a song we haven't heard before
    if (db > 0 && !known) db = Math.min(db, MAX_BOOST * Math.min(1, this.blocks.length / 150));
    const current = 20 * Math.log10(Math.max(this.gain.gain.value, 1e-6));
    // turning down is quick (no blasting), turning up is slow (no pumping)
    const timeConstant = db < current ? (known ? 1.5 : 0.4) : (known ? 4 : 2.5);
    this.gain.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, timeConstant);
  }

  /** EBU R128-style gated average of the blocks so far, in dB */
  integrated() {
    const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
    const ungated = mean(this.blocks);
    // relative gate: drop blocks 10 dB below the average (quiet breaks, fade-outs)
    const gated = this.blocks.filter(e => e > ungated * 0.1);
    return 10 * Math.log10(mean(gated.length ? gated : this.blocks)) - 0.691;
  }

  gainFor(loudness) {
    return Math.max(MAX_CUT, Math.min(MAX_BOOST, TARGET - loudness));
  }

  /** Remember how loud the track was, once we've heard enough of it */
  saveCurrent() {
    if (!this.trackId || this.blocks.length < 100) return;
    const loudness = this.integrated();
    const known = this.cache[this.trackId];
    this.cache[this.trackId] = typeof known === 'number' ? (known + loudness) / 2 : loudness;
    const ids = Object.keys(this.cache);
    if (ids.length > CACHE_LIMIT) ids.slice(0, ids.length - CACHE_LIMIT).forEach(id => delete this.cache[id]);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(this.cache)); } catch (e) { /* storage full */ }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    const db = on && this.blocks.length >= MIN_BLOCKS ? this.gainFor(this.integrated()) : on && typeof this.cache[this.trackId] === 'number' ? this.gainFor(this.cache[this.trackId]) : 0;
    this.gain.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.3);
  }

  setEqualizer(value) {
    this.equalizer = normalizeEqualizer(value);
    if (!this.ctx) return;
    const { enabled, preamp, gains } = this.equalizer;
    this.preamp.gain.setTargetAtTime(dbToGain(enabled ? preamp : 0), this.ctx.currentTime, 0.03);
    this.eqFilters.forEach((filter, i) => filter.gain.setTargetAtTime(enabled ? gains[i] : 0, this.ctx.currentTime, 0.03));
  }

  /** Independent of user volume, so a timer never changes saved volume or mute. */
  fadeForSleep(seconds) {
    if (!this.ctx) return;
    const gain = this.sleepGain.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setTargetAtTime(0, now, Math.max(0.01, seconds / 5));
  }

  restoreSleepVolume() {
    if (!this.ctx) return;
    this.sleepGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.sleepGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.02);
  }

  /** User volume lives after the limiter, so it never affects the loudness measurement */
  setVolume(volume, muted) {
    this.volume = volume;
    this.muted = muted;
    this.applyVolume();
  }

  applyVolume() {
    if (!this.ctx) return;
    // squared curve feels more natural on a linear slider
    const level = this.muted ? 0 : this.volume * this.volume;
    this.output.gain.setTargetAtTime(level, this.ctx.currentTime, 0.02);
  }
}
