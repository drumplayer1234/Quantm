import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromWaveform } from '../src/js/mixmemory.js';

const tracks = JSON.parse(readFileSync(new URL('./fixtures/dropcut-waveforms.json', import.meta.url)));

test('real SoundCloud peak envelopes find electronic returns and reject acoustic controls', () => {
  for (const track of tracks) {
    const wave = { samples: track.samples, width: track.samples.length, height: track.height };
    const hints = fromWaveform(wave, track.duration).dropCandidates;
    assert.equal(hints.length > 0, track.expectedCandidate, `${track.family}: ${track.title}`);
    assert.ok(hints.length <= 8);
    assert.ok(hints.every(c => c.time >= 4 && c.time + 8 <= track.duration + 0.01));
    assert.equal(fromWaveform(wave, track.duration).drop, undefined, 'amplitude hints cannot authorize a cut');
    // Dense raw peak variation must not change a macro section decision. The means
    // of these groups equal the compact fixture, including near silence/limiting.
    const dense = track.samples.flatMap(v => {
      const noise = Math.min(v, track.height - v, 8);
      return [v - noise, v + noise, v + noise, v - noise];
    });
    assert.deepEqual(fromWaveform({ ...wave, samples: dense, width: dense.length }, track.duration).dropCandidates, hints);
  }
});

test('a compressed master needs relative contrast, a sustained breakdown and a stable return', () => {
  const waveform = fn => ({ samples: Array.from({ length: 450 }, (_, i) => fn(i * 120 / 450)), width: 450, height: 1 });
  const compressed = waveform(t => t >= 24 && t < 32 ? 0.72 : 0.96);
  assert.ok(fromWaveform(compressed, 120).dropCandidates.some(c => Math.abs(c.time - 32) <= c.uncertainty));
  assert.deepEqual(fromWaveform(waveform(() => 0.96), 120).dropCandidates, []);
  assert.deepEqual(fromWaveform(waveform(t => t >= 32 && t < 32.5 ? 0.96 : 0.72), 120).dropCandidates, []);
  assert.deepEqual(fromWaveform(waveform(t => 0.6 + t / 120 * 0.36), 120).dropCandidates, []);
});
