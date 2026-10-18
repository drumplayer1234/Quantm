// Loudness normalization: tracks on SoundCloud are mastered at very different levels.
// Audio is routed through Web Audio so we can measure each track's loudness while it
// plays and nudge a gain node toward a common target, like Spotify's "normalize volume".
//
//   <audio> → source ─┬─ meter (K-weighting-ish filters → analyser)
//                     └─ normalize gain → limiter → user volume → speakers

import { safeParse } from './store.js';

const TARGET = -14;          // dB, roughly the -14 LUFS streaming services use
const MAX_BOOST = 9;         // never boost quiet tracks by more than this
const MAX_CUT = -15;
const BLOCK_MS = 100;        // one loudness measurement every 100ms
const MIN_BLOCKS = 15;       // wait 1.5s of audio before the first adjustment
const CACHE_KEY = 'quantm.loudness';
const CACHE_LIMIT = 3000;

const dbToGain = (db) => Math.pow(10, db / 20);

export class Normalizer {
  constructor(audio) {
    this.audio = audio;
    this.enabled = true;
    this.ctx = null;
    this.blocks = [];        // mean-square energy per block for the current track
    this.trackId = null;
    this.cache = safeParse(localStorage.getItem(CACHE_KEY));
    this.volume = 1;
    this.muted = false;
  }

  /** Build the audio graph lazily (needs to happen once, before playback) */
  init() {
    if (this.ctx) return true;
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(this.audio);

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
      source.connect(highpass).connect(shelf).connect(this.analyser).connect(silent).connect(ctx.destination);

      // output branch
      this.gain = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.25;
      this.output = ctx.createGain();
      source.connect(this.gain).connect(this.limiter).connect(this.output).connect(ctx.destination);

      this.ctx = ctx;
      this.buffer = new Float32Array(this.analyser.fftSize);
      this.applyVolume();
      setInterval(() => this.measure(), BLOCK_MS);
      return true;
    } catch (error) {
      console.error('Volume normalization unavailable', error);
      return false;
    }
  }

  /** Called when a new track starts loading */
  startTrack(trackId) {
    this.saveCurrent();
    this.trackId = trackId;
    this.blocks = [];
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // songs we've heard before start at the right level straight away
    const known = this.cache[trackId];
    const db = this.enabled && typeof known === 'number' ? this.gainFor(known) : 0;
    this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.gain.gain.setValueAtTime(dbToGain(db), this.ctx.currentTime);
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
