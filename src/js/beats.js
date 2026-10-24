/** Frames per second of the resampled energy envelope. */
export const FRAME_RATE = 100;

/** Metadata chooses a tempo octave, never a tempo without audio evidence. */
export function tempoOptions(track, bpm = null) {
  const text = [track?.genre, track?.title, track?.tag_list, ...(track?.tags || [])].join(' ');
  const preferred = /\bd\s*'?n'?\s*b\b|drum\s*(?:and|&|n|\/)?\s*bass|jungle/i.test(text) ? [160, 190] :
    /hardstyle|hardcore/i.test(text) ? [140, 200] :
      /dubstep|ridd?im|riddm/i.test(text) ? [130, 160] :
        /house|techno|trance|disco|\bedm\b/i.test(text) ? [110, 160] : null;
  const explicit = track?.bpm || Number(text.match(/\b(\d{2,3}(?:\.\d+)?)\s*bpm\b/i)?.[1]);
  // Audio memory resolves the octave even when service metadata says half-time.
  const reference = bpm > 0 ? bpm : explicit >= 40 && explicit <= 250 ? explicit : null;
  const options = preferred ? { preferred, maxBpm: 200 } : {};
  if (reference > 0) options.bpm = orientGrid({ period: 60 / reference, offset: 0 }, options).bpm;
  return options;
}

/** Keep a phrase/downbeat anchor when interpreting a half/double-time reading. */
export function orientGrid(grid, opts = {}) {
  if (!grid || !(grid.period > 0)) return grid;
  const bpm = 60 / grid.period, choices = [bpm, bpm * 2, bpm / 2].filter(b => b >= 40 && b <= 250);
  let chosen = bpm;
  if (opts.bpm > 0) chosen = choices.reduce((a, b) => Math.abs(Math.log(b / opts.bpm)) < Math.abs(Math.log(a / opts.bpm)) ? b : a, bpm);
  else if (opts.preferred && (bpm < opts.preferred[0] - 0.5 || bpm > opts.preferred[1] + 0.5)) {
    chosen = choices.find(b => b >= opts.preferred[0] - 0.5 && b <= opts.preferred[1] + 0.5) ?? bpm;
  }
  if (chosen === bpm) return { ...grid, bpm: grid.bpm || bpm };
  return { ...grid, bpm: chosen, period: 60 / chosen, offset: grid.downbeat ?? grid.offset };
}

/** Confirm a waveform hint using real kick energy and a local beat grid. */
export function confirmDrop(samples, candidate, hint = null) {
  const result = inspectDrop(samples, candidate, hint);
  return result.drop ? { drop: result.drop, grid: result.grid } : null;
}

/** Diagnostics are also shown in the live mix log, including failed confirmations. */
export function inspectDrop(samples, candidate, hint = null) {
  const reject = (reason, confidence = 0, grid = null) => ({ drop: null, confidence, reason, grid });
  if (!Number.isFinite(candidate?.time) || !Array.isArray(samples)) return reject('invalid candidate');
  const tolerance = Math.min(3, Math.max(0.5, candidate.uncertainty || 0.5));
  const after = samples.filter(s => s.t >= candidate.time + tolerance && s.t <= candidate.time + 12);
  const grid = analyze(after, hint || {});
  if (!(grid?.confidence >= 0.35)) return reject('no steady beat after the return', grid?.confidence || 0, grid);
  // Only a verified phrase origin constrains the edge. A waveform hint establishes
  // a local phrase; its coarse timestamp must still snap to an audible beat.
  const anchored = Number.isFinite(hint?.downbeat);
  const origin = anchored ? grid.offset + Math.round((hint.downbeat - grid.offset) / grid.period) * grid.period : grid.offset;
  const stride = grid.period * (anchored ? 32 : 1);
  let best = null;
  for (let time = origin + Math.ceil((candidate.time - tolerance - origin) / stride) * stride;
    time <= candidate.time + tolerance; time += stride) {
    const drop = detectDrop(samples, { ...grid, downbeat: time }, 0.1);
    if (!drop || Math.abs(drop.time - time) >= 0.01) continue;
    if (!best || drop.confidence > best.drop.confidence) best = { drop, grid: { ...grid, downbeat: time } };
  }
  return best ? { ...best, confidence: best.drop.confidence, reason: 'sustained bass return on the beat' } :
    reject('no sustained bass contrast at the candidate (or incomplete audio coverage)', grid.confidence * 0.5, grid);
}

/** A sustained bass return after a thin build, snapped to an eight-bar phrase. Missing coverage never counts as quiet. */
export function detectDrop(samples, grid, step = 0.1) {
  if (!Array.isArray(samples) || samples.length > 1000000 || !(grid?.confidence >= 0.35) ||
      !(grid.period >= 0.1 && grid.period <= 3) || !Number.isFinite(grid.offset) || !(step >= 0.01 && step <= 1)) return null;
  const bins = new Map();
  for (const s of samples) {
    if (!Number.isFinite(s?.t) || s.t < 0 || s.t > 86400 || !Number.isFinite(s.v) || s.v < 0) continue;
    const key = Math.round(s.t / step);
    const bin = bins.get(key) || { sum: 0, n: 0 };
    bin.sum += s.v; bin.n++;
    bins.set(key, bin);
  }
  if (!bins.size) return null;
  const keys = [...bins.keys()];
  const first = keys.reduce((a, b) => Math.min(a, b), Infinity), last = keys.reduce((a, b) => Math.max(a, b), -Infinity);
  const mean = (from, to) => {
    let total = 0, count = 0;
    const a = Math.ceil(from / step), b = Math.ceil(to / step);
    for (let i = a; i < b; i++) {
      const bin = bins.get(i);
      if (bin) { total += bin.sum / bin.n; count++; }
    }
    return count >= (b - a) * 0.95 ? total / count : null;
  };
  const beat = grid.period, origin = grid.downbeat ?? grid.offset, phrase = beat * 32;
  let best = null;
  for (let time = origin + Math.ceil((first * step + Math.min(4, 16 * beat) - origin) / phrase) * phrase;
    time + Math.max(8, 8 * beat) <= (last + 1) * step; time += phrase) {
    const before = mean(time - Math.min(4, 16 * beat), time - step);
    const after = mean(time, time + Math.max(8, 8 * beat));
    if (before === null || after === null || after < 1e-7 || after < before * 1.5) continue;
    // Every part of the full return must carry bass, including the later seconds.
    const span = Math.max(8, 8 * beat);
    const bars = [0, 1, 2, 3].map(i => mean(time + i * span / 4, time + (i + 1) * span / 4));
    if (bars.some(value => value === null || value < after * 0.65 || value < before * 1.35)) continue;
    // Check the actual edge too, so a slowly growing section isn't mislabeled as a drop.
    const edgeBefore = mean(time - 2 * beat, time - step), edgeAfter = mean(time, time + 2 * beat);
    if (edgeBefore === null || edgeAfter === null || edgeAfter < edgeBefore * 1.45) continue;
    const hit = mean(time, time + beat / 2);
    if (hit === null || hit < after * 0.5 || hit < before * 1.35) continue;
    const confidence = Math.min(1, 0.5 * Math.min(1, grid.confidence / 0.6) + 0.5 * Math.min(1, (1 - before / after) / 0.5));
    if (!best || confidence > best.confidence) best = { time, confidence };
  }
  return best;
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = value => ((value % 1) + 1) % 1;
const series = values => Array.isArray(values) || (ArrayBuffer.isView(values) && typeof values.length === 'number');
const positive = value => Number.isFinite(value) && value > 0;
const validGrid = grid => grid != null && positive(grid.period) && Number.isFinite(grid.offset);

/** Resample ascending media times, skipping backwards samples and zeroing gaps over 250 ms. key picks the value (v = kick band, h = snare band). */
export function resample(samples, frameRate = FRAME_RATE, key = 'v') {
  if (!Array.isArray(samples) || !positive(frameRate)) return null;
  const points = [];
  for (const sample of samples) {
    if (!sample || !Number.isFinite(sample.t) || !Number.isFinite(sample[key])) continue;
    const last = points.at(-1);
    if (last && sample.t < last.t) continue;
    const point = { t: sample.t, v: clamp(sample[key], 0, 3.4028234663852886e38) };
    if (last && sample.t === last.t) points[points.length - 1] = point;
    else points.push(point);
  }
  if (points.length < 2) return null;
  const start = points[0].t;
  const length = Math.floor((points.at(-1).t - start) * frameRate + 1e-7) + 1;
  // Bound allocation for corrupt timestamps or an invalid sampling rate.
  if (!Number.isSafeInteger(length) || length < 2 || length > 1000000) return null;
  const values = new Float32Array(length);
  let j = 1;
  for (let i = 0; i < length; i++) {
    const t = start + i / frameRate;
    while (j < points.length - 1 && points[j].t < t) j++;
    const a = points[j - 1], b = points[j];
    if (Math.abs(t - a.t) < 1e-9) values[i] = a.v;
    else if (Math.abs(t - b.t) < 1e-9) values[i] = b.v;
    else if (b.t - a.t <= 0.25) values[i] = a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  }
  return { start, values };
}

/** Extract positive log-energy changes, smooth them without delay, and remove the mean. */
export function onsetStrength(values, frameRate = FRAME_RATE) {
  if (!series(values) || !positive(frameRate) || values.length > 1000000) return new Float32Array(0);
  const length = values.length;
  const changes = new Float32Array(length);
  const result = new Float32Array(length);
  let peak = 0;
  for (const value of values) if (Number.isFinite(value)) peak = Math.max(peak, value);
  // A relative floor keeps quieter hats quieter after log compression.
  const floor = Math.max(1e-12, peak * 0.1);
  let previous = Math.log1p((positive(values[0]) ? values[0] : 0) / floor);
  for (let i = 1; i < length; i++) {
    const current = Math.log1p((positive(values[i]) ? values[i] : 0) / floor);
    changes[i] = Math.max(0, current - previous);
    previous = current;
  }
  let sum = 0;
  for (let i = 0; i < length; i++) {
    result[i] = ((changes[i - 1] || 0) + 2 * changes[i] + (changes[i + 1] || 0)) / 4;
    sum += result[i];
  }
  const mean = sum / (length || 1);
  for (let i = 0; i < length; i++) result[i] = Math.max(0, result[i] - mean);
  return result;
}

/** Estimate tempo with normalized autocorrelation and refine it across several beat intervals. */
export function estimateTempo(onsets, frameRate = FRAME_RATE, opts = {}) {
  if (!series(onsets) || !positive(frameRate) || onsets.length / frameRate < 4 || onsets.length > 1000000) return null;
  opts = opts && typeof opts === 'object' ? opts : {};
  const minBpm = opts.minBpm ?? 70, maxBpm = opts.maxBpm ?? 180;
  if (!positive(minBpm) || !positive(maxBpm) || minBpm > maxBpm) return null;
  const preferred = Array.isArray(opts.preferred) && positive(opts.preferred[0]) &&
    positive(opts.preferred[1]) && opts.preferred[0] <= opts.preferred[1] ? opts.preferred : [85, 180];
  const length = onsets.length;
  const low = Math.max(2, Math.floor(60 * frameRate / maxBpm));
  const high = Math.min(Math.ceil(60 * frameRate / minBpm), Math.floor(length / 2) - 1);
  if (low > high) return null;
  const data = new Float64Array(length);
  const squares = new Float64Array(length + 1);
  let mean = 0;
  for (let i = 0; i < length; i++) {
    data[i] = positive(onsets[i]) ? onsets[i] : 0;
    mean += data[i] / length;
  }
  for (let i = 0; i < length; i++) {
    data[i] -= mean;
    squares[i + 1] = squares[i] + data[i] * data[i];
  }
  if (!(squares[length] > 1e-20)) return null;
  const cache = new Map();
  const correlation = lag => {
    if (cache.has(lag)) return cache.get(lag);
    let sum = 0;
    for (let i = 0; i < length - lag; i++) sum += data[i] * data[i + lag];
    const scale = Math.sqrt(squares[length - lag] * (squares[length] - squares[lag]));
    const value = scale > 0 ? sum / scale : 0;
    cache.set(lag, value);
    return value;
  };
  const peakAt = lag => {
    const left = correlation(lag - 1), center = correlation(lag), right = correlation(lag + 1);
    const curvature = left - 2 * center + right;
    const delta = curvature < -1e-12 ? clamp((left - right) / (2 * curvature), -0.5, 0.5) : 0;
    return { lag: lag + delta, strength: center - (left - right) * delta / 4 };
  };
  const peaks = [];
  for (let lag = low; lag <= high; lag++) {
    if (correlation(lag) <= correlation(lag - 1) || correlation(lag) < correlation(lag + 1)) continue;
    const peak = peakAt(lag);
    const bpm = 60 * frameRate / peak.lag;
    if (bpm >= minBpm - 0.5 && bpm <= maxBpm + 0.5) peaks.push(peak);
  }
  if (!peaks.length) return null;
  const strongest = peaks.reduce((best, peak) => Math.max(best, peak.strength), 0);
  if (strongest < 0.2) return null;
  const reliable = peaks.filter(peak => peak.strength >= strongest * 0.8);
  const inRange = reliable.filter(peak => {
    const bpm = 60 * frameRate / peak.lag;
    return bpm >= preferred[0] - 0.5 && bpm <= preferred[1] + 0.5;
  });
  // The shortest strong period avoids mistaking every second kick for the beat.
  const chosen = (inRange.length ? inRange : reliable)[0];
  const nearestPeak = expected => {
    let best = Math.max(2, Math.round(expected));
    for (let lag = Math.max(2, Math.round(expected) - 2); lag <= Math.round(expected) + 2; lag++) {
      if (correlation(lag) > correlation(best)) best = lag;
    }
    return peakAt(best);
  };
  // Refine a beat length across several multiples of it.
  const refine = beatLag => {
    let numerator = 0, denominator = 0, strength = 0, count = 0;
    const intervals = Math.min(8, Math.floor((length / 2 - 2) / beatLag));
    for (let beat = 1; beat <= intervals; beat++) {
      const peak = nearestPeak(beatLag * beat);
      if (peak.strength < strongest * 0.5) continue;
      numerator += beat * peak.lag * peak.strength;
      denominator += beat * beat * peak.strength;
      strength += peak.strength;
      count++;
    }
    return denominator && count ? { bpm: 60 * frameRate / (numerator / denominator), strength, count } : null;
  };
  // A real beat also repeats every 2 and 4 beats (the bar).
  const support = beatLag => {
    let sum = 0, n = 0;
    for (const k of [1, 2, 4]) {
      if (beatLag * k + 3 >= length / 2) break;
      sum += Math.max(0, nearestPeak(beatLag * k).strength);
      n++;
    }
    return n >= 2 ? sum / n : 0;
  };
  let fit = refine(chosen.lag);
  if (!fit) return null;
  // Syncopated kicks (drum & bass) and trance rolls can make 2/3, 3/4 or 4/5 of the tempo look
  // strongest; the tempo whose bar repeats best wins.
  let best = support(60 * frameRate / fit.bpm);
  for (const factor of [1.5, 2 / 3, 4 / 3, 0.75, 1.25, 0.8]) {
    const candidate = fit.bpm * factor;
    if (candidate < minBpm || candidate > maxBpm) continue;
    const score = support(60 * frameRate / candidate);
    const refined = score > best * 1.15 ? refine(60 * frameRate / candidate) : null;
    if (refined) { best = score; fit = refined; }
  }
  const { strength, count } = fit;
  let bpm = fit.bpm;
  // A sparse half-time kick can still define a double-time grid.
  for (const alternative of [bpm * 2, bpm / 2]) {
    if ((bpm < preferred[0] - 0.5 || bpm > preferred[1] + 0.5) && alternative >= preferred[0] - 0.5 &&
        alternative <= preferred[1] + 0.5 && alternative >= minBpm && alternative <= maxBpm) bpm = alternative;
  }
  bpm = clamp(bpm, minBpm, maxBpm);
  return { bpm, confidence: clamp((strength / count - 0.15) / 0.75, 0, 1) };
}

/** Kick onsets plus half-weighted snare onsets, each scaled to the same average first. */
function blend(kicks, snares) {
  const mean = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  const a = mean(kicks), b = mean(snares);
  const out = new Float32Array(kicks.length);
  for (let i = 0; i < out.length; i++) out[i] = (a > 0 ? kicks[i] / a : 0) + (b > 0 ? 0.5 * snares[i] / b : 0);
  return out;
}

/** Analyze irregular energy samples into a tempo and a kick-aligned media-time beat grid. */
export function analyze(samples, opts = {}) {
  opts = opts && typeof opts === 'object' ? opts : {};
  const frameRate = opts.frameRate ?? FRAME_RATE;
  const envelope = resample(samples, frameRate);
  if (!envelope) return null;
  let onsets = onsetStrength(envelope.values, frameRate);
  let tempo = estimateTempo(onsets, frameRate, opts);
  // Syncopated kicks (hip-hop, drum & bass) hide the beat; snares and hi-hats (h) bring it back.
  const highs = resample(samples, frameRate, 'h');
  if (highs && highs.start === envelope.start && highs.values.length === onsets.length) {
    const mixed = blend(onsets, onsetStrength(highs.values, frameRate));
    const both = estimateTempo(mixed, frameRate, opts);
    if (both && (!tempo || both.confidence > tempo.confidence + 0.05)) tempo = both;
    // the beat's phase always uses both: kicks alone can land on and off the beat equally often
    onsets = mixed;
  }
  if (!tempo) return null;
  // A tempo already known for this song (opts.bpm, from its memory) only needs the beat's phase;
  // a reading that disagrees (a 2/3 or 4/5 misread) is a little less trusted.
  if (positive(opts.bpm) && opts.bpm >= 40 && opts.bpm <= 250) {
    const agrees = [1, 2, 0.5].some(k => Math.abs(tempo.bpm / (opts.bpm * k) - 1) < 0.02);
    tempo = { bpm: opts.bpm, confidence: agrees ? tempo.confidence : tempo.confidence * 0.8 };
  }
  const period = 60 / tempo.bpm;
  const frames = period * frameRate;
  const score = phase => {
    let sum = 0;
    for (let position = phase; position < onsets.length - 1; position += frames) {
      const index = Math.floor(position), fraction = position - index;
      sum += onsets[index] * (1 - fraction) + onsets[index + 1] * fraction;
    }
    return sum;
  };
  let best = 0, bestScore = -1;
  // Search to one millisecond at the default frame rate.
  const steps = Math.ceil(frames * 10);
  for (let i = 0; i < steps; i++) {
    const phase = frames * i / steps;
    const value = score(phase);
    if (value > bestScore) { best = phase; bestScore = value; }
  }
  // A first difference belongs halfway between its two energy samples.
  const offset = envelope.start + wrap((best - 0.5) / frames) * period;
  return { bpm: tempo.bpm, period, offset, confidence: tempo.confidence };
}

/** Return the fraction of a beat elapsed, or zero for an invalid grid or time. */
export function beatPhase(grid, time) {
  if (!validGrid(grid) || !Number.isFinite(time)) return 0;
  const beats = (time - grid.offset) / grid.period;
  return Number.isFinite(beats) ? wrap(beats) : 0;
}

/** Return the first beat at or after a media time, or null for invalid input. */
export function nextBeat(grid, time) {
  if (!validGrid(grid) || !Number.isFinite(time)) return null;
  const beats = (time - grid.offset) / grid.period;
  if (!Number.isFinite(beats)) return null;
  const index = Math.round(beats);
  const nearest = grid.offset + index * grid.period;
  const result = nearest >= time ? nearest : grid.offset + (index + 1) * grid.period;
  return Number.isFinite(result) ? result : null;
}

/** Return deck B's lead over deck A in beats, wrapped to [-0.5, 0.5). */
export function phaseError(gridA, timeA, gridB, timeB) {
  if (!validGrid(gridA) || !validGrid(gridB) || !Number.isFinite(timeA) || !Number.isFinite(timeB)) return 0;
  return wrap(beatPhase(gridB, timeB) - beatPhase(gridA, timeA) + 0.5) - 0.5;
}

/** Choose the smallest allowed playback-rate change, considering half and double time. */
export function tempoRatio(bpmOut, bpmIn, maxStretch = 0.08) {
  if (!positive(bpmOut) || !positive(bpmIn) || !Number.isFinite(maxStretch) || maxStretch < 0) return null;
  let best = null;
  for (const effective of [bpmIn, bpmIn * 2, bpmIn / 2]) {
    if (!positive(effective)) continue;
    const ratio = bpmOut / effective;
    if (positive(ratio) && Math.abs(ratio - 1) <= maxStretch + 1e-12 &&
        (!best || Math.abs(ratio - 1) < Math.abs(best.ratio - 1))) best = { ratio, bpmIn: effective };
  }
  return best;
}
