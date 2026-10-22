import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAME_RATE, resample, onsetStrength, estimateTempo, analyze, beatPhase, nextBeat,
  phaseError, tempoRatio } from '../src/js/beats.js';

function random(seed = 12345) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function track(bpm, { duration = 10, start = 12.37, offset = 0.217, noise = 0, hat = 0,
  gaps = false, seed = 12345 } = {}) {
  const rand = random(seed);
  const period = 60 / bpm;
  const samples = [];
  const pulse = (time, phase, decay) => {
    const age = time - phase;
    return age < 0 ? 0 : Math.exp(-((age % period) / decay));
  };
  for (let time = 0; time <= duration; time += 0.002 + rand() * 0.013) {
    if (gaps && ((time > 2.1 && time < 2.29) || (time > 5.4 && time < 5.53) ||
        (time > 7.1 && time < 7.25))) continue;
    samples.push({ t: start + time, v: pulse(time, offset, 0.045) +
      hat * pulse(time, offset + period / 2, 0.018) + noise * (0.5 + rand()) });
  }
  return { samples, kick: start + offset, period };
}

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

function checkGrid(grid, source, bpm) {
  assert.ok(grid, `missing grid at ${bpm} BPM`);
  close(grid.bpm, bpm, 0.3);
  close(grid.period, 60 / grid.bpm);
  const beats = (grid.offset - source.kick) / source.period;
  const error = Math.abs(beats - Math.round(beats)) * source.period;
  assert.ok(error < 0.01, `${bpm} BPM kick offset error: ${error} seconds`);
  assert.ok(grid.confidence > 0.5, `${bpm} BPM confidence: ${grid.confidence}`);
  assert.ok(grid.offset >= source.samples[0].t && grid.offset <= source.samples.at(-1).t);
}

test('resample interpolates small gaps, zeros large gaps, and drops backwards samples', () => {
  assert.equal(FRAME_RATE, 100);
  const result = resample([{ t: 5, v: 0 }, { t: 5.02, v: 2 }, { t: 5.02, v: 4 },
    { t: 4, v: 100 }, { t: NaN, v: 1 }, null, { t: 5.04, v: 0 }, { t: 5.4, v: 3 }]);
  assert.equal(result.start, 5);
  assert.ok(result.values instanceof Float32Array);
  assert.equal(result.values.length, 41);
  assert.deepEqual([...result.values.slice(0, 5)], [0, 2, 4, 2, 0]);
  assert.ok(result.values.slice(5, 40).every(value => value === 0));
  assert.equal(result.values[40], 3);
  assert.deepEqual([...resample([{ t: 0, v: 0 }, { t: 0.2, v: 2 }], 10).values], [0, 1, 2]);
  assert.equal(resample([{ t: 1, v: 0 }, { t: 1, v: 1 }]), null);
});

test('onset strength has the same length, suppresses steady energy, and emphasizes rises', () => {
  const steady = onsetStrength(new Float32Array(100).fill(1));
  assert.ok(steady instanceof Float32Array);
  assert.equal(steady.length, 100);
  assert.ok(steady.every(value => value === 0));
  const onsets = onsetStrength([0, 0, 0, 1, 0.5, 0.2, 0, 0]);
  assert.equal(onsets.length, 8);
  assert.ok(onsets[3] > 0 && onsets[3] > onsets[5]);
  assert.ok(onsets.every(value => Number.isFinite(value) && value >= 0));
});

for (const bpm of [90, 120, 128, 140, 174]) {
  test(`jittered clean kicks at ${bpm} BPM yield an accurate tempo and phase`, () => {
    for (const seed of [12345, 71, 98765]) {
      const source = track(bpm, { seed });
      checkGrid(analyze(source.samples), source, bpm);
    }
  });

  test(`noise and quieter off-beat hats at ${bpm} BPM still lock to kicks`, () => {
    for (const seed of [9981, 71, 98765]) {
      const source = track(bpm, { noise: 0.035, hat: 0.18, seed });
      checkGrid(analyze(source.samples), source, bpm);
    }
  });
}

test('half-time patterns favor the preferred range and 140 BPM stays 140', () => {
  const halfTime = analyze(track(70.4).samples);
  assert.ok(halfTime);
  close(halfTime.bpm, 140.8, 0.3);
  assert.ok(halfTime.bpm >= 85 && halfTime.bpm <= 175);
  close(analyze(track(140).samples).bpm, 140, 0.3);
  close(analyze(track(70.4).samples, { preferred: [65, 80] }).bpm, 70.4, 0.3);
});

test('100–200 ms polling gaps, duplicate times, and a backwards seek preserve the grid', () => {
  const source = track(128, { gaps: true, noise: 0.02, hat: 0.12 });
  const index = source.samples.findIndex(sample => sample.t > 16);
  const backwards = source.samples.slice(index, index + 80).map(sample => ({ t: sample.t - 3, v: 20 }));
  source.samples.splice(index, 0, { ...source.samples[index - 1] }, ...backwards);
  checkGrid(analyze(source.samples), source, 128);
});

test('silence, constant energy, white noise, and short spans have no reliable tempo', () => {
  const rand = random(332);
  const samples = Array.from({ length: 1001 }, (_, i) => ({ t: i / 100, v: 0 }));
  assert.equal(analyze(samples), null);
  assert.equal(analyze(samples.map(sample => ({ ...sample, v: 1 }))), null);
  for (let run = 0; run < 5; run++) {
    const noisy = samples.map(sample => ({ ...sample, v: rand() }));
    const result = analyze(noisy);
    assert.ok(result === null || result.confidence < 0.3);
  }
  assert.equal(analyze(track(128, { duration: 2.9 }).samples), null);
  assert.equal(analyze(track(128, { duration: 3.9 }).samples), null);
  assert.equal(estimateTempo(new Float32Array(1000)), null);
});

test('tempo estimation works directly on onsets and respects the search range', () => {
  const envelope = resample(track(128).samples);
  const onsets = onsetStrength(envelope.values);
  close(estimateTempo(onsets).bpm, 128, 0.3);
  close(estimateTempo(onsets, FRAME_RATE, { minBpm: 120, maxBpm: 135 }).bpm, 128, 0.3);
  const slower = track(90);
  checkGrid(analyze(slower.samples, { frameRate: 200 }), slower, 90);
});

test('beat phase, next beat, and phase error handle media time and wrap-around', () => {
  const grid = { offset: 10, period: 0.5 };
  close(beatPhase(grid, 10), 0);
  close(beatPhase(grid, 10.125), 0.25);
  close(beatPhase(grid, 9.875), 0.75);
  close(nextBeat(grid, 10), 10);
  close(nextBeat(grid, 10 + 1e-12), 10.5);
  close(nextBeat(grid, 10.01), 10.5);
  close(nextBeat(grid, 9.6), 10);
  close(nextBeat({ offset: 0.1, period: 0.2 }, 0.3), 0.3);
  const other = { offset: 30, period: 0.4 };
  close(phaseError(grid, 10, other, 30), 0);
  close(phaseError(grid, 10, other, 30.1), 0.25);
  close(phaseError(grid, 10.45, other, 30.04), 0.2);
  close(phaseError(grid, 10, grid, 10.25), -0.5);
  close(phaseError(grid, 10.25, grid, 10), -0.5);
  close(phaseError(grid, 10, grid, 10.249), 0.498);
  close(phaseError(grid, 10, grid, 10.251), -0.498);
});

test('tempo ratio chooses the smallest stretch, including half and double time', () => {
  const ratio = tempoRatio(128, 126);
  close(ratio.ratio, 128 / 126);
  assert.equal(ratio.bpmIn, 126);
  assert.deepEqual(tempoRatio(128, 64), { ratio: 1, bpmIn: 128 });
  assert.deepEqual(tempoRatio(64, 128), { ratio: 1, bpmIn: 64 });
  assert.equal(tempoRatio(100, 128), null);
  assert.equal(tempoRatio(128, 126, 0.01), null);
  assert.deepEqual(tempoRatio(108, 100), { ratio: 1.08, bpmIn: 100 });
});

test('bad inputs return safe values without throwing', () => {
  for (const input of [null, undefined, NaN, 0, 'bad', {}, []]) {
    assert.equal(resample(input), null);
    assert.equal(estimateTempo(input), null);
    assert.equal(analyze(input), null);
    assert.ok(onsetStrength(input) instanceof Float32Array);
  }
  for (const grid of [null, {}, { period: 0, offset: 1 }, { period: NaN, offset: 0 },
    { period: 1, offset: Infinity }]) {
    assert.equal(beatPhase(grid, 1), 0);
    assert.equal(nextBeat(grid, 1), null);
    assert.equal(phaseError(grid, 1, { period: 1, offset: 0 }, 1), 0);
  }
  const grid = { period: 0.5, offset: 0 };
  assert.equal(beatPhase(grid, NaN), 0);
  assert.equal(nextBeat(grid, NaN), null);
  assert.equal(phaseError(grid, 0, grid, NaN), 0);
  for (const rate of [0, -1, NaN, Infinity, null]) {
    assert.equal(resample([{ t: 0, v: 1 }, { t: 1, v: 1 }], rate), null);
    assert.equal(estimateTempo(new Float32Array(1000), rate), null);
    assert.equal(onsetStrength([1, 2], rate).length, 0);
  }
  assert.equal(resample([{ t: 0, v: 1 }, { t: 1e300, v: 1 }]), null);
  assert.equal(estimateTempo(new Float32Array(1000), 100, { minBpm: 0 }), null);
  assert.equal(estimateTempo(new Float32Array(1000), 100, { minBpm: 180, maxBpm: 70 }), null);
  assert.equal(analyze(track(120).samples, null)?.bpm > 0, true);
  assert.ok(onsetStrength([NaN, null, -1, Infinity, 1]).every(Number.isFinite));
  assert.ok(onsetStrength([0, Number.MAX_VALUE, 0]).every(Number.isFinite));
  assert.ok(resample([{ t: 0, v: 0 }, { t: 1, v: Number.MAX_VALUE }]).values.every(Number.isFinite));
  for (const args of [[0, 128], [128, NaN], [null, 128], [128, 0], [128, 128, -1]]) {
    assert.equal(tempoRatio(...args), null);
  }
});

test('30 seconds of samples analyze in under 50 ms', t => {
  const source = track(128, { duration: 30, noise: 0.02, hat: 0.12 });
  analyze(source.samples);
  const start = performance.now();
  const grid = analyze(source.samples);
  const elapsed = performance.now() - start;
  checkGrid(grid, source, 128);
  assert.ok(elapsed < 50, `analysis took ${elapsed.toFixed(2)} ms`);
  t.diagnostic(`30 seconds analyzed in ${elapsed.toFixed(2)} ms`);
});

// Drum & bass: kicks on 1 and the "and" of 3, snares on 2 and 4 (the h band). The kicks alone
// repeat in a 3:2 pattern that used to read as 116 instead of 174.
function breakbeat(bpm, { duration = 12, seed = 77 } = {}) {
  const rand = random(seed);
  const beat = 60 / bpm, bar = beat * 4;
  const hit = (time, at, decay) => Math.exp(-((((time - at) % bar) + bar) % bar) / decay);
  const samples = [];
  for (let time = 0; time <= duration; time += 0.002 + rand() * 0.013) {
    samples.push({ t: 30 + time, v: hit(time, 0, 0.04) + hit(time, 2.5 * beat, 0.04) + 0.02 * rand(),
      h: hit(time, beat, 0.03) + hit(time, 3 * beat, 0.03) + 0.02 * rand() });
  }
  return samples;
}

test('syncopated drum & bass reads at its real tempo (or half), not 2/3 of it', () => {
  for (const bpm of [172, 174, 176]) {
    const grid = analyze(breakbeat(bpm));
    assert.ok(grid, `missing grid at ${bpm} BPM`);
    assert.ok([1, 0.5].some(k => Math.abs(grid.bpm / (bpm * k) - 1) < 0.01), `${bpm} BPM read as ${grid.bpm}`);
  }
});
