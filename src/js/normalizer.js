// Loudness normalization: tracks on SoundCloud are mastered at very different levels.
// Audio is routed through Web Audio so we can measure each track's loudness while it
// plays and nudge a gain node toward a common target, like Spotify's "normalize volume".
//
//   <audio> → source ─┬─ meter tap → meter (K-weighting-ish filters → analyser)
//                     ├─ beat taps → low-pass / high-pass → analysers (Auto mix listens for kicks and snares, automix.js)
//                     └─ deck fade gain → deck bass → deck loudness gain → mix → preamp → EQ → limiter → user volume → sleep gain → speakers
//
// There is one source + fade gain + bass shelf + loudness gain per <audio> element ("deck"), so two
// tracks can overlap while crossfading, each at its own normalized level (Auto mix swaps their bass
// halfway). The meter only listens to the active deck and adjusts that deck's loudness gain.

import { safeParse } from './store.js';
import { EQ_BANDS, normalizeEqualizer } from './equalizer.js';
import { DropCutEffect } from './dropcut.js';

const TARGET = -14;          // dB, roughly the -14 LUFS streaming services use
const MAX_BOOST = 9;         // never boost quiet tracks by more than this
const MAX_CUT = -15;
const BLOCK_MS = 100;        // one loudness measurement every 100ms
const MIN_BLOCKS = 15;       // wait 1.5s of audio before the first adjustment
const CACHE_KEY = 'quantm.loudness';
const CACHE_LIMIT = 3000;

const CURVE_POINTS = 96;     // resolution of the equal-power crossfade curves
const BASS_KILL = -26;       // dB on a deck's bass shelf while Auto mix keeps its bass out of the mix

const dbToGain = (db) => Math.pow(10, db / 20);
/** Equal-power fade level at t (0..1): the two tracks together keep a steady loudness */
const equalPower = (fadeIn, t) => (fadeIn ? Math.sin(t * Math.PI / 2) : Math.cos(t * Math.PI / 2));
const smooth = (t) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
/**
 * Level of a deck at t (0..1) of the fade. shape.dj (Auto mix) blends like a DJ: the incoming song
 * comes up to full during the first half (its bass still out), the outgoing one stays full until
 * the halfway bass swap and then goes. A dj between 0 and 1 blends the two styles (Auto mix
 * learns how much of each the listener likes).
 */
const fadeLevel = (fadeIn, t, shape) => {
  const amount = !shape ? 0 : shape.dj === true ? 1 : Math.min(1, Math.max(0, Number(shape.dj) || 0));
  const plain = equalPower(fadeIn, t);
  if (!amount) return plain;
  const dj = fadeIn ? Math.sin(smooth(t / 0.5) * Math.PI / 2) : Math.cos(smooth((t - 0.5) / 0.5) * Math.PI / 2);
  return plain + (dj - plain) * amount;
};
/** Bass swap at t (0..1): only one song's bass plays at a time, handing over around the middle over `width` of the mix */
const bassLevel = (fadeIn, t, width = 0.2) => {
  const swap = smooth((t - (0.5 - width / 2)) / width);
  return BASS_KILL * (fadeIn ? 1 - swap : swap);
};

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
      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 220;
      bass.gain.value = 0;
      // kick drum detector for Auto mix: the low end, measured whether or not the deck is audible
      const kick = ctx.createBiquadFilter();
      kick.type = 'lowpass';
      kick.frequency.value = 180;
      const beats = ctx.createAnalyser();
      beats.fftSize = 512;
      // and snares / hi-hats, which carry the beat when the kick is syncopated (hip-hop, drum & bass)
      const snare = ctx.createBiquadFilter();
      snare.type = 'highpass';
      snare.frequency.value = 2000;
      const hats = ctx.createAnalyser();
      hats.fftSize = 512;
      // and the whole signal, so Auto mix can compare two songs' loudness before mixing them
      const full = ctx.createAnalyser();
      full.fftSize = 512;
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(tap).connect(this.meterIn);
      const level = ctx.createGain(); // this deck's loudness normalization
      source.connect(fade).connect(bass).connect(level).connect(this.gain);
      source.connect(kick).connect(beats).connect(silent).connect(ctx.destination);
      source.connect(snare).connect(hats).connect(silent);
      source.connect(full).connect(silent);
      this.decks.set(audio, { source, tap, fade, bass, level, beats, hats, full, beatBuffer: new Float32Array(beats.fftSize) });
      return true;
    } catch (error) {
      console.error('Second audio deck unavailable', error);
      return false;
    }
  }

  /** The active deck's loudness gain (the one the meter adjusts), or null */
  get level() {
    const deck = this.decks.get(this.audio);
    return deck ? deck.level.gain : null;
  }

  /** The deck whose track is the current one: the meter measures it */
  setActive(audio) {
    // remembered so a new song can be set relative to the one before it (startTrack's louderDb)
    if (audio !== this.audio && this.level) this.previousDb = 20 * Math.log10(Math.max(this.level.value, 1e-6));
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

  /** Fade from `from` (0..1 of the whole fade) to the end over `seconds`; equal-power unless shape.dj (see fadeLevel) */
  fadeDeck(audio, fadeIn, seconds, from = 0, shape = null) {
    const deck = this.decks.get(audio);
    if (!deck) return;
    const now = this.ctx.currentTime;
    deck.fade.gain.cancelScheduledValues(now);
    deck.fade.gain.setValueAtTime(fadeLevel(fadeIn, from, shape), now);
    if (seconds <= 0 || from >= 1) { deck.fade.gain.setValueAtTime(fadeLevel(fadeIn, 1, shape), now); return; }
    const curve = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) curve[i] = fadeLevel(fadeIn, from + (1 - from) * i / (CURVE_POINTS - 1), shape);
    deck.fade.gain.setValueCurveAtTime(curve, now, seconds);
  }

  /** Freeze a deck's fade where it is (progress 0..1), used while paused mid-crossfade */
  holdFade(audio, fadeIn, progress, shape = null) {
    this.setFade(audio, fadeLevel(fadeIn, Math.min(1, Math.max(0, progress)), shape));
  }

  /** Auto mix bass swap from `from` (0..1 of the whole mix) to the end over `seconds` */
  swapBass(audio, fadeIn, seconds, from = 0, width = 0.2) {
    const deck = this.decks.get(audio);
    if (!deck) return;
    const param = deck.bass.gain;
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(bassLevel(fadeIn, from, width), now);
    if (seconds <= 0 || from >= 1) { param.setValueAtTime(bassLevel(fadeIn, 1, width), now); return; }
    const curve = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) curve[i] = bassLevel(fadeIn, from + (1 - from) * i / (CURVE_POINTS - 1), width);
    param.setValueCurveAtTime(curve, now, seconds);
  }

  /** Freeze the bass swap where it is (progress 0..1), or pass null to give the deck its full bass back */
  holdBass(audio, fadeIn, progress, width = 0.2) {
    const deck = this.decks.get(audio);
    if (!deck) return;
    const param = deck.bass.gain;
    param.cancelScheduledValues(this.ctx.currentTime);
    param.setValueAtTime(progress == null ? 0 : bassLevel(fadeIn, Math.min(1, Math.max(0, progress)), width), this.ctx.currentTime);
  }

  /** Insert only for a drop cut; otherwise fade feeds bass directly, with no filter coloration. */
  startDropCut(outgoing, incoming, schedule) {
    const a = this.decks.get(outgoing), b = this.decks.get(incoming);
    if (this.dropcut || !a || !b || a === b || !this.ctx.createDelay ||
        ![schedule?.start, schedule?.drop, schedule?.end].every(Number.isFinite) ||
        schedule.start <= this.ctx.currentTime || schedule.drop <= schedule.start || schedule.end <= schedule.drop) return false;
    try { a.dropcut = new DropCutEffect(this.ctx, a.fade, a.bass, schedule); }
    catch { return false; }
    this.dropcut = { outgoing, incoming };
    this.holdBass(outgoing, false, null);
    this.holdBass(incoming, true, null);
    this.setFade(incoming, 0);
    b.fade.gain.setValueAtTime(1, schedule.drop);
    return true;
  }

  clearDropCut(audio) {
    const cut = this.dropcut;
    if (!cut || (cut.outgoing !== audio && cut.incoming !== audio)) return;
    const deck = this.decks.get(cut.outgoing), incoming = this.decks.get(cut.incoming);
    deck.dropcut.stop();
    deck.dropcut = null;
    this.dropcut = null;
    // Cancel the future drop opening too, even when the incoming deck is the one released.
    this.setFade(cut.incoming, incoming.fade.gain.value);
    this.holdBass(cut.outgoing, false, null);
    this.holdBass(cut.incoming, true, null);
  }

  /** What the deck is playing right now for Auto mix: { low, high, full } energy, or null */
  beatEnergy(audio) {
    const deck = this.decks.get(audio);
    if (!deck) return null;
    const energy = (analyser) => {
      analyser.getFloatTimeDomainData(deck.beatBuffer);
      let sum = 0;
      for (let i = 0; i < deck.beatBuffer.length; i++) sum += deck.beatBuffer[i] * deck.beatBuffer[i];
      return sum / deck.beatBuffer.length;
    };
    return { low: energy(deck.beats), high: energy(deck.hats), full: energy(deck.full) };
  }

  /**
   * Where a song never heard before starts: the median level of the songs measured so far.
   * Most uploads are mastered loud, so starting unadjusted (0 dB) meant an audible dip a second
   * or two in, once the meter caught up.
   */
  typicalDb() {
    const levels = Object.values(this.cache).filter(v => typeof v === 'number').map(v => this.gainFor(v)).sort((a, b) => a - b);
    return levels.length >= 5 ? levels[Math.floor(levels.length / 2)] : 0;
  }

  /** Whether this track's loudness was measured before */
  knows(trackId) { return typeof this.cache[trackId] === 'number'; }

  /**
   * Called when a new track starts loading on the active deck (call setActive first).
   * louderDb: for a track never measured, how much louder it is than the song before it (Auto mix
   * compares them while pre-playing), so it starts at about the right level instead of unadjusted.
   */
  startTrack(trackId, louderDb = null) {
    this.saveCurrent();
    this.trackId = trackId;
    this.blocks = [];
    const level = this.level;
    if (!this.ctx || !level) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    // songs we've heard before start at the right level straight away
    const known = this.cache[trackId];
    const before = Number.isFinite(this.previousDb) ? this.previousDb : 20 * Math.log10(Math.max(level.value, 1e-6));
    // An estimate from an intro can only err quiet (intros are softer than the drop), so it may lower
    // the start below the usual level but never raise it: rising later is gentle, dipping is heard
    const typical = this.typicalDb();
    const db = !this.enabled ? 0 : typeof known === 'number' ? this.gainFor(known)
      : Number.isFinite(louderDb) ? Math.max(MAX_CUT, Math.min(typical, before - louderDb)) : typical;
    level.cancelScheduledValues(this.ctx.currentTime);
    level.setValueAtTime(dbToGain(db), this.ctx.currentTime);
    // a song never measured starts at an estimate; the meter only hears its intro at first
    this.startDb = this.enabled && typeof known !== 'number' ? db : null;
  }

  measure() {
    if (!this.ctx || !this.level || this.audio.paused || this.audio.seeking || !this.trackId) return;
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
    // ...and keep close to the starting estimate for the first 20 s, so the level doesn't wander
    // audibly on an intro that's quieter than the rest (unless the song is much too loud)
    if (!known && this.startDb != null && this.blocks.length < 200) db = Math.max(this.startDb - 6, Math.min(this.startDb + 3, db));
    const current = 20 * Math.log10(Math.max(this.level.value, 1e-6));
    // turning down is quick when it's much too loud (no blasting), gentle otherwise so it isn't
    // heard; turning up is slow (no pumping)
    const timeConstant = db < current ? (current - db > 6 ? 0.4 : known ? 1.5 : 1) : (known ? 4 : 2.5);
    this.level.setTargetAtTime(dbToGain(db), this.ctx.currentTime, timeConstant);
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
    if (!this.ctx || !this.level) return;
    const db = on && this.blocks.length >= MIN_BLOCKS ? this.gainFor(this.integrated()) : on && typeof this.cache[this.trackId] === 'number' ? this.gainFor(this.cache[this.trackId]) : 0;
    this.level.setTargetAtTime(dbToGain(db), this.ctx.currentTime, 0.3);
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
