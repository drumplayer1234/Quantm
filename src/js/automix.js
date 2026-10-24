// Auto mix: DJ-style transitions between songs.
// While a song plays, Quantm listens to each deck's low end (the kick drum) and works out its
// tempo and where the beats fall (beats.js). The next song is pre-played silently for a few
// seconds so its beats are known too. During the mix the incoming song is sped up or slowed
// down slightly so its beats stay on top of the outgoing song's, and the two songs swap bass
// halfway through (normalizer.js), like a DJ does. Songs without a clear beat get a normal
// crossfade with the bass swap.

import * as beats from './beats.js';

const POLL_MS = 10;
const KEEP_SECONDS = 40;          // how much of each deck's recent playing is kept for analysis
// below this the beat isn't trusted (ambient, spoken word, ...). Tuned on real songs: hip-hop's
// correct readings score from about 0.25, wrong readings stayed under 0.22
const MIN_CONFIDENCE = 0.25;
export const ANALYZE_SECONDS = 7; // how much of the next song is pre-played to find its beat
export const ANALYZE_MAX_SECONDS = 12; // ...or longer, up to this, when its intro has no drums
const LOCK_MS = 50;
const CATCH_UP_SECONDS = 2;       // the first seconds of a mix may correct harder (incoming is still quiet)
const DEAD_ZONE = 0.008;          // beats within 8 ms are together; leave the tempo alone
const RELEASE_SECONDS = 8;        // after the mix the incoming song eases back to its own tempo

/** Records the low-end energy of the decks it watches, stamped with each deck's media time */
export class BeatWatcher {
  constructor(normalizer) {
    this.norm = normalizer;
    this.watched = new Map(); // <audio> → [{ t, v }]
    this.grids = new WeakMap();
    this.timer = null;
  }

  watch(audio) {
    if (!this.watched.has(audio)) this.watched.set(audio, []);
    if (!this.timer) this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  unwatch(audio) {
    this.watched.delete(audio);
    this.grids.delete(audio);
    if (!this.watched.size && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  isWatching(audio) { return this.watched.has(audio); }

  poll() {
    for (const [audio, samples] of this.watched) {
      if (audio.paused || audio.seeking) continue;
      const energy = this.norm.beatEnergy(audio);
      if (!energy) continue;
      const t = audio.currentTime;
      // Never analyze across a seek or a stalled stream as if the gap were silence.
      if (samples.length && (t < samples.at(-1).t - 0.5 || t - samples.at(-1).t > 0.5)) {
        samples.length = 0;
        this.grids.delete(audio);
      }
      samples.push({ t, v: energy.low, h: energy.high, f: energy.full });
      if (samples[0].t < t - KEEP_SECONDS - 5) {
        const keep = samples.findIndex(s => s.t >= t - KEEP_SECONDS);
        samples.splice(0, keep);
      }
    }
  }

  /** Seconds of media heard since watching started (or since the last seek back) */
  heard(audio) {
    const samples = this.watched.get(audio);
    return samples && samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;
  }

  /** Average energy of the last `seconds` the deck played, ignoring quiet breaks (like the loudness meter's gate), or null */
  loudness(audio, seconds = 20) {
    const samples = this.watched.get(audio);
    if (!samples || samples.length < 100) return null;
    const end = samples[samples.length - 1].t;
    const values = samples.filter(s => s.t >= end - seconds && s.f > 1e-7).map(s => s.f);
    if (values.length < 100) return null;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const loud = values.filter(v => v > mean * 0.1);
    return loud.reduce((a, b) => a + b, 0) / loud.length;
  }

  /** Readings newer than media time `after` (all of them after a seek back), for the song memory */
  since(audio, after) {
    const samples = this.watched.get(audio);
    if (!samples || !samples.length) return [];
    if (samples[samples.length - 1].t < after) return samples.slice();
    let i = samples.length;
    while (i > 0 && samples[i - 1].t > after) i--;
    return samples.slice(i);
  }

  /**
   * Beat grid from a recent contiguous drum region, in media time; null if there's no clear beat.
   * bpm: the song's tempo when its memory knows it, so only the beat's position is worked out.
   * skipLast: leave out the most recent seconds (an outro that lost its kick).
   */
  grid(audio, seconds = 20, bpm = null, skipLast = 0) {
    const samples = this.watched.get(audio);
    if (!samples || samples.length < 2) return null;
    const end = samples[samples.length - 1].t - skipLast;
    const key = `${seconds}/${bpm}/${skipLast}`;
    const cache = this.grids.get(audio);
    if (cache?.samples === samples && cache.key === key && end >= cache.end && end - cache.end < 0.75) return cache.grid;
    let best = null, bestScore = -Infinity;
    // A 20 s window may straddle a breakdown or a drumless tail. Find actual
    // contiguous beat regions rather than making the entire window pass or fail.
    for (const age of [0, 8, 16]) {
      for (const span of [...new Set([seconds, 12, 8])]) {
        const points = samples.filter(s => s.t >= end - age - span && s.t <= end - age);
        if (points.length < 2 || points.at(-1).t - points[0].t < Math.min(span - 0.1, 4)) continue;
        let start = 0;
        for (let i = 1; i < points.length; i++) if (points[i].t - points[i - 1].t > 0.25) start = i;
        const region = points.slice(start);
        const grid = beats.analyze(region, bpm ? { bpm } : {});
        const score = grid?.confidence - age * 0.004;
        if (grid?.confidence >= MIN_CONFIDENCE && score > bestScore) {
          best = { ...grid, from: region[0].t, to: region.at(-1).t };
          bestScore = score;
        }
        if (age === 0 && span === seconds && grid?.confidence >= 0.6) break;
      }
      if (best?.confidence >= 0.6 && age === 0) break;
    }
    this.grids.set(audio, { key, end, samples, grid: best });
    return best;
  }
}

/**
 * How two songs line up: the incoming song's playback-rate factor and its grid at the tempo used
 * (a half- or double-time match changes the beat length). null when they can't be beat-matched.
 */
export function matchTempo(gridOut, gridIn, maxStretch = 0.08) {
  if (!gridOut || !gridIn) return null;
  const match = beats.tempoRatio(gridOut.bpm, gridIn.bpm, maxStretch);
  if (!match) return null;
  const gridIn2 = Object.assign({}, gridIn, { bpm: match.bpmIn, period: 60 / match.bpmIn,
    offset: gridIn.downbeat ?? gridIn.offset });
  return { ratio: match.ratio, gridOut, gridIn: gridIn2 };
}

/** Where the incoming song should start (at or after `from`) so it lands in phase with the outgoing song now */
export function alignedStart(match, outgoingTime, from) {
  const want = beats.beatPhase(match.gridOut, outgoingTime);
  const have = beats.beatPhase(match.gridIn, from);
  let shift = want - have;
  if (shift < 0) shift += 1;
  return from + shift * match.gridIn.period;
}

export const MAX_MIX_SECONDS = 24;
/**
 * How many media seconds the mix should last at this tempo: the longest of 64, 32 or 16 beats that
 * fits in 24 s, times the learned length factor (kept to whole 8-beat phrases).
 */
export function mixSeconds(grid, rate = 1, factor = 1) {
  if (!grid) return Math.min(MAX_MIX_SECONDS, Math.max(4, 8 * factor)) * rate;
  const beat = grid.period / rate;
  const n = [64, 32, 16].find(beats => beats * beat <= MAX_MIX_SECONDS) || 16;
  const scaled = Math.max(8, Math.round(n * factor / 8) * 8);
  return Math.min(MAX_MIX_SECONDS, Math.max(4, scaled * beat)) * rate;
}

/** A memory entry's beat grid in the shape beats.js uses, or null when it isn't trusted */
export function memoryGrid(entry) {
  if (!entry || !(entry.period > 0) || !Number.isFinite(entry.offset) || !(entry.confidence >= 0.25)) return null;
  return { bpm: entry.bpm || 60 / entry.period, period: entry.period, offset: entry.offset, confidence: entry.confidence,
    downbeat: entry.downbeat ?? entry.offset };
}

/** Keeps the incoming song's beats on the outgoing song's by nudging its speed, like a DJ riding the pitch fader */
export class BeatLock {
  constructor(outgoing, incoming, match, baseRate, lock = true) {
    this.outgoing = outgoing;
    this.incoming = incoming;
    this.match = match;
    this.baseRate = baseRate;
    this.target = baseRate * match.ratio;
    this.startedAt = null;
    this.error = null;
    this.timer = lock ? setInterval(() => this.tick(), LOCK_MS) : null;
    if (lock) incoming.playbackRate = this.target;
  }

  tick() {
    const { outgoing, incoming, match } = this;
    if (incoming.paused || outgoing.paused || outgoing.ended || incoming.seeking) return;
    if (this.startedAt === null) this.startedAt = performance.now();
    const ahead = beats.phaseError(match.gridOut, outgoing.currentTime, match.gridIn, incoming.currentTime);
    if (!Number.isFinite(ahead)) return;
    const raw = ahead * match.gridOut.period / (outgoing.playbackRate || 1);
    // smoothed, so timer jitter in the readings doesn't make the tempo wobble
    this.error = this.error == null ? raw : this.error * 0.6 + raw * 0.4;
    const seconds = Math.abs(this.error) < DEAD_ZONE ? 0 : this.error;
    const catchingUp = (performance.now() - this.startedAt) / 1000 < CATCH_UP_SECONDS;
    const limit = catchingUp ? 0.1 : 0.03;
    // close the gap in under a second, never bending the tempo more than the limit
    const nudge = Math.max(-limit, Math.min(limit, -1.5 * seconds));
    const rate = this.target * (1 + nudge);
    if (Math.abs(rate - incoming.playbackRate) > 0.001) incoming.playbackRate = rate;
  }

  /** The speed setting changed: aim for the new rate (mid-mix or while easing back) */
  setBaseRate(rate) {
    this.baseRate = rate;
    this.target = rate * this.match.ratio;
    if (this.timer) return;
    clearInterval(this.glide);
    this.glide = null;
    this.incoming.playbackRate = rate;
    const done = this.onReleased;
    this.onReleased = null;
    done?.();
  }

  /** The mix is over: ease the song back to its own tempo */
  release(onDone = () => {}) {
    clearInterval(this.timer);
    clearInterval(this.glide);
    this.glide = null;
    this.timer = null;
    this.onReleased = onDone;
    const done = () => {
      const callback = this.onReleased;
      this.onReleased = null;
      callback?.();
    };
    const audio = this.incoming;
    const from = audio.playbackRate;
    const to = this.baseRate;
    if (Math.abs(from - to) < 0.001) { audio.playbackRate = to; done(); return; }
    const started = performance.now();
    const glide = setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / (RELEASE_SECONDS * 1000));
      audio.playbackRate = from + (to - from) * t;
      if (t >= 1) { clearInterval(glide); this.glide = null; done(); }
    }, 100);
    this.glide = glide;
  }

  /** Drop it now (a skip, or the song changed): the deck goes straight back to normal speed */
  stop(rate = this.baseRate) {
    clearInterval(this.timer);
    clearInterval(this.glide);
    this.glide = null;
    this.onReleased = null;
    this.timer = null;
    this.incoming.playbackRate = rate;
  }
}
