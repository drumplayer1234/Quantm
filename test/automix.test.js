import test from 'node:test';
import assert from 'node:assert/strict';
import { BeatWatcher, matchTempo, alignedStart } from '../src/js/automix.js';
import { analyze } from '../src/js/beats.js';

const drums = (from, to, bpm = 128) => Array.from({ length: Math.round((to - from) * 100) + 1 }, (_, i) => {
  const t = from + i / 100, pulse = Math.exp(-((t % (60 / bpm)) / 0.04));
  return { t, v: pulse, h: pulse * 0.3 };
});

test('outro analysis finds a contiguous drum region preceding a drumless tail', () => {
  const watcher = new BeatWatcher({}), audio = {};
  const samples = [...drums(100, 120), ...drums(120.01, 140).map(s => ({ ...s, v: 0, h: 0 }))];
  assert.equal(analyze(samples.filter(s => s.t >= 120)), null, 'the old last-20-seconds window has no beat');
  watcher.watched.set(audio, samples);
  const grid = watcher.grid(audio);
  assert.ok(grid?.confidence >= 0.25);
  assert.ok(Math.abs(grid.bpm - 128) < 0.3);
  assert.ok(grid.from < 120 && grid.to >= 120);
});

test('forward seeks reset heard coverage and cannot manufacture a beat through a gap', () => {
  const watcher = new BeatWatcher({ beatEnergy: () => ({ low: 1, high: 0, full: 1 }) });
  const audio = { currentTime: 120, paused: false, seeking: false };
  watcher.watched.set(audio, drums(0, 20));
  watcher.poll();
  assert.equal(watcher.heard(audio), 0);
  assert.equal(watcher.grid(audio), null);
  audio.currentTime += 0.01;
  watcher.poll();
  assert.ok(watcher.heard(audio) < 0.02);
});

test('outro region search never stitches independent seek fragments into a reliable grid', () => {
  const watcher = new BeatWatcher({}), audio = {};
  watcher.watched.set(audio, [...drums(100, 102), ...drums(115, 117), ...drums(130, 132)]);
  assert.equal(watcher.grid(audio), null);
});

test('a short discontinuity also invalidates a cached grid before the next analysis interval', () => {
  const watcher = new BeatWatcher({ beatEnergy: () => ({ low: 1, high: 0, full: 1 }) });
  const audio = { currentTime: 108.6, paused: false, seeking: false };
  watcher.watched.set(audio, drums(100, 108));
  assert.ok(watcher.grid(audio));
  watcher.poll();
  audio.currentTime += 0.01;
  watcher.poll();
  assert.equal(watcher.grid(audio), null);
});

test('half/double tempo matching preserves the confirmed phrase downbeat as the grid origin', () => {
  for (const [out, incoming] of [[175, 87.5], [87.5, 175]]) {
    const gridOut = { bpm: out, period: 60 / out, offset: 0, confidence: 0.7 };
    const gridIn = { bpm: incoming, period: 60 / incoming, offset: 0.12, downbeat: 52, confidence: 0.8 };
    const match = matchTempo(gridOut, gridIn);
    assert.equal(match.ratio, 1);
    assert.equal(match.gridIn.period, gridOut.period);
    assert.equal(match.gridIn.offset, 52);
    assert.equal(alignedStart(match, 0, 52), 52);
  }
});
