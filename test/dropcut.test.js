import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDrop, confirmDrop, inspectDrop } from '../src/js/beats.js';
import { fromWaveform } from '../src/js/mixmemory.js';
import { planStyle, buildWindow, futureWindow, rollSchedule, dropPhase, DropCutEffect } from '../src/js/dropcut.js';
import { installBrowser } from './helpers/browser.js';
import { dropAudio } from './helpers/drop-audio.js';

const grid = { bpm: 120, period: 0.5, offset: 0, downbeat: 0, confidence: 0.9 };
const envelope = (drop = 32, length = 20) => Array.from({ length: 600 }, (_, i) => {
  const t = i / 10;
  return { t, v: t >= drop && t < drop + length ? 0.9 : t >= drop - 8 ? 0.03 : 0.6 };
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('drop detection needs a sustained bass jump after a build on an eight-bar phrase', () => {
  const drop = detectDrop(envelope(), grid);
  close(drop.time, 32);
  assert.ok(drop.confidence >= 0.8);
  assert.equal(detectDrop(envelope().map(s => ({ ...s, v: 0.6 })), grid), null);
  assert.equal(detectDrop(envelope(32, 0.5), grid), null, 'one loud kick is too short');
  assert.equal(detectDrop(envelope(34), grid), null, 'off-phrase jump');
  assert.equal(detectDrop(envelope(32.5), grid), null, 'a jump one beat late must not open on a quiet beat');
  assert.equal(detectDrop(envelope().filter(s => s.t < 25 || s.t >= 30), grid), null, 'seek gap is not a build');
  assert.equal(detectDrop(envelope(), { ...grid, confidence: 0.3 }), null);
  const shifted = envelope().map(s => ({ ...s, t: s.t + 0.2 }));
  close(detectDrop(shifted, { ...grid, offset: 0.2, downbeat: 0.2 }).time, 32.2);
});

test('style planning respects Auto rules, pair overrides and readiness fallbacks', () => {
  const input = { drop: { time: 92, confidence: 0.8 }, match: { ratio: 1.01, gridOut: grid, gridIn: grid },
    features: [{ genre: 'house', energy: { overall: 0.7 } }, { tags: ['hyperpop'] }] };
  assert.equal(planStyle(input).style, 'dropcut');
  assert.match(planStyle(input).reason, /Drop at 1:32, confidence 0.80/);
  for (const override of [{ drop: null }, { ready: false }, { rejected: true }, { features: [] },
    { features: [{ genre: 'house', energy: { overall: 0.2 } }, { genre: 'house' }] }]) {
    assert.equal(planStyle({ ...input, ...override }).style, 'blend');
  }
  assert.equal(planStyle({ ...input, style: 'blend', pair: { style: 'dropcut' }, features: [], rejected: true }).style, 'dropcut');
  assert.equal(planStyle({ ...input, style: 'dropcut', pair: { style: 'blend' } }).style, 'blend');
  assert.equal(planStyle({ ...input, style: 'blend', pair: { style: 'auto' } }).style, 'dropcut');
  assert.equal(planStyle({ ...input, pair: { style: 'dropcut' }, ready: false }).style, 'blend');
  assert.equal(planStyle({ ...input, features: [{ genre: 'baconcore', title: 'kawaii future bass' },
    { genre: 'RIDDM' }] }).style, 'dropcut', 'titles and common genre spellings supplement sparse tags');
  assert.equal(planStyle({ ...input, match: { gridOut: { ...grid, confidence: 0.28 }, gridIn: null, ratio: 1.3 } }).variant, 'roll',
    'a modest outgoing grid enables rolls regardless of incoming tempo or intro confidence');
  for (const match of [null, { gridOut: { ...grid, confidence: 0.2 } }]) {
    const selected = planStyle({ ...input, match });
    assert.equal(selected.style, 'dropcut');
    assert.equal(selected.variant, 'echo');
    assert.match(selected.reason, /no loop roll/);
  }
});

test('weak-grid schedule keeps the high-pass build and echo but allocates no loop stages', () => {
  const schedule = rollSchedule(10, 0.5, 16, 'echo');
  assert.deepEqual(schedule.stages, []);
  close(schedule.drop, 18);
  assert.equal(dropPhase(schedule, schedule.roll), 'echo');
  const ctx = context(), source = ctx.createGain(), destination = ctx.createGain();
  source.connect(destination);
  const effect = new DropCutEffect(ctx, source, destination, schedule);
  assert.equal(ctx.nodes.filter(n => n.delayTime.value !== 1).length, 1, 'only the echo delay is allocated');
  assert.ok(effect.highpass.frequency.events.some(e => e.type === 'exponential' && e.v === 2400));
  effect.stop();
  assert.deepEqual(source.outputs, [destination]);
});

test('outgoing windows are phrase aligned, prefer the outro and respect mix-out markers', () => {
  assert.deepEqual(buildWindow(grid, 201), { build: 176, cut: 192 });
  assert.deepEqual(buildWindow(grid, 201, { outroStart: 181 }), { build: 184, cut: 192 });
  assert.deepEqual(buildWindow(grid, 201, { out: 180 }), { build: 180, cut: 192 });
  assert.equal(buildWindow(grid, 201, { out: 196 }), null);
  assert.equal(buildWindow({ ...grid, confidence: 0.1 }, 201), null);
});

test('roll timestamps keep beat fractions at different tempos and playback rates', () => {
  for (const beat of [0.25, 0.5, 0.75]) {
    for (const beats of [8, 16, 24, 32]) {
      const schedule = rollSchedule(10, beat, beats);
      close(schedule.drop, 10 + beats * beat);
      close(schedule.cut, schedule.drop - beat / 4);
      assert.deepEqual(schedule.stages.map(s => s.fraction), [1, 0.5, 0.25, 0.125]);
      for (const stage of schedule.stages) {
        assert.ok(stage.capture >= schedule.start);
        close(stage.at - stage.capture, stage.delay);
        close(stage.delay, stage.fraction * beat);
        for (let i = 1; i < stage.repeats.length; i++) close(stage.repeats[i] - stage.repeats[i - 1], stage.delay);
        assert.ok(stage.repeats.at(-1) < schedule.cut);
      }
      assert.equal(dropPhase(schedule, schedule.start), 'build');
      assert.equal(dropPhase(schedule, schedule.roll), 'roll');
      assert.equal(dropPhase(schedule, schedule.cut), 'cut');
      assert.equal(dropPhase(schedule, schedule.drop), 'drop');
    }
  }
  for (const args of [[0, 0], [NaN, 1], [0, 1, 4], [0, 1, 100]]) assert.equal(rollSchedule(...args), null);
});

test('future builds move the cut to a later phrase/bar, then shorten eight to four to two bars', () => {
  const window = (now, duration = 201, extra = {}) => futureWindow(grid, duration, { now, dropTime: 92, ...extra });
  assert.deepEqual(window(175), { build: 176, cut: 192, lead: 1.5 });
  assert.deepEqual(window(176.1, 210), { build: 192, cut: 208, lead: 1.5 }, 'next eight-bar phrase fits');
  assert.deepEqual(window(176.1), { build: 178, cut: 194, lead: 1.5 }, 'next bar preserves eight bars');
  assert.deepEqual(window(186), { build: 188, cut: 196, lead: 1.5 });
  assert.deepEqual(window(194), { build: 196, cut: 200, lead: 1.5 });
  assert.equal(window(198), null);
  assert.equal(window(150, 201, { dropTime: 3 }), null);
  assert.equal(window(150, 201, { out: 200 }), null);
  assert.deepEqual(window(150, 201, { out: 180.2 }), { build: 180.2, cut: 192, lead: 1.5 }, 'preserve a future mix-out marker');
  assert.deepEqual(window(170, 192.55, { rate: 1.25 }), { build: 172, cut: 188, lead: 1.875 }, 'reserve the end margin at a stretched rate');
  for (const rate of [0.8, 1, 1.25]) {
    for (let now = 160; now < 201; now += 0.17) {
      const w = window(now, 201, { rate });
      const lastCut = Math.floor((201 - Math.max(grid.period, 0.5 * rate)) / (4 * grid.period)) * 4 * grid.period;
      assert.equal(!!w, lastCut - 8 * grid.period >= now + 0.3 * rate, 'find a window whenever two future bars fit');
      if (!w) continue;
      assert.ok(w.build >= now + 0.3 * rate - 1e-8);
      assert.ok(w.cut <= 201 - Math.max(grid.period, 0.5 * rate) + 1e-8);
      close((w.cut - grid.downbeat) / (4 * grid.period) % 1, 0);
      assert.ok([8, 16, 32].includes((w.cut - w.build) / grid.period));
    }
  }
});

test('low outgoing phase confidence selects high-pass plus echo even with a strong incoming grid', () => {
  const selected = planStyle({ style: 'dropcut', drop: { time: 60, confidence: 1 },
    gridOut: { ...grid, confidence: 0.1 }, match: { gridOut: grid, gridIn: grid, ratio: 1 } });
  assert.equal(selected.style, 'dropcut');
  assert.equal(selected.variant, 'echo');
  assert.match(selected.reason, /high-pass \+ echo \(weak outgoing grid, no loop roll\)/);
  assert.deepEqual(rollSchedule(10, 0.5, 8, selected.variant).stages, []);
});

function context() {
  const nodes = [];
  const param = () => ({ value: 1, events: [],
    cancelScheduledValues(t) { this.events = this.events.filter(e => e.t < t); },
    setValueAtTime(v, t) { this.events.push({ type: 'set', v, t }); },
    setTargetAtTime(v, t) { this.events.push({ type: 'target', v, t }); },
    linearRampToValueAtTime(v, t) { this.events.push({ type: 'linear', v, t }); },
    exponentialRampToValueAtTime(v, t) { this.events.push({ type: 'exponential', v, t }); }
  });
  const node = () => { const result = { outputs: [], gain: param(), frequency: param(), Q: param(), delayTime: param(),
    threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
    connect(next) { this.outputs.push(next); return next; },
    disconnect(next) { this.outputs = next ? this.outputs.filter(n => n !== next) : []; }
  }; nodes.push(result); return result; };
  return { nodes, currentTime: 1, sampleRate: 48000, destination: node(), createGain: node, createBiquadFilter: node,
    createDelay: node, createDynamicsCompressor: node, createAnalyser: node, createMediaElementSource: node };
}

test('unused filter is fully bypassed; drop graph sweeps, opens full bass at the drop, and disposes loops', async t => {
  installBrowser();
  t.mock.method(globalThis, 'setInterval', () => 0);
  const ctx = context();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  globalThis.AudioContext = function () { return ctx; };
  t.after(() => { if (original) Object.defineProperty(globalThis, 'AudioContext', original); else delete globalThis.AudioContext; });
  const { Normalizer } = await import('../src/js/normalizer.js');
  const out = {}, into = {}, norm = new Normalizer(out);
  assert.equal(norm.init(), true);
  assert.equal(norm.addDeck(into), true);
  const a = norm.decks.get(out), b = norm.decks.get(into);
  assert.deepEqual(a.fade.outputs, [a.bass], 'original direct path has no added filter or parallel signal');
  assert.equal(a.dropcut, undefined);
  const schedule = rollSchedule(2, 0.5);
  assert.equal(norm.startDropCut(out, into, schedule), true);
  const effect = a.dropcut, nodes = effect.nodes.slice();
  assert.deepEqual(a.fade.outputs, [effect.input]);
  assert.equal(effect.highpass.type, 'highpass');
  assert.ok(effect.highpass.Q.value > 0.7);
  assert.deepEqual(effect.highpass.frequency.events.at(-1), { type: 'exponential', v: 2400, t: schedule.cut });
  assert.deepEqual(b.fade.gain.events.at(-1), { type: 'set', v: 1, t: schedule.drop }, 'full level with no fade-in');
  assert.equal(b.bass.gain.events.at(-1).v, 0, 'full incoming bass');
  assert.ok(nodes.some(n => n.gain.value === 0.4), 'bounded echo feedback');
  assert.ok(nodes.some(n => n.gain.value === 0.4 && n.gain.events.some(e => e.v === 0 && e.t === schedule.end)), 'echo feedback stops on the audio clock');
  assert.equal(norm.startDropCut(into, out, schedule), false, 'two drop graphs cannot overlap');
  norm.clearDropCut(into);
  assert.ok(!b.fade.gain.events.some(e => e.t === schedule.drop), 'releasing either deck cancels the scheduled incoming opening');
  norm.clearDropCut(out);
  norm.clearDropCut(out);
  assert.deepEqual(a.fade.outputs, [a.bass]);
  assert.equal(a.dropcut, null);
  assert.ok(nodes.every(n => n.outputs.length === 0), 'delay cycles and tails are disconnected');
  assert.equal(norm.startDropCut(out, into, rollSchedule(0, 0.5)), false, 'late schedule falls back');
  effect.stop();
  assert.deepEqual(a.fade.outputs, [a.bass], 'disposing twice never duplicates the bypass');
  const allocated = ctx.nodes.length, delay = ctx.createDelay;
  let count = 0;
  t.mock.method(ctx, 'createDelay', () => {
    if (++count === 2) throw new Error('allocation failed');
    return delay();
  });
  assert.equal(norm.startDropCut(out, into, schedule), false);
  assert.ok(ctx.nodes.slice(allocated).every(n => !n.outputs.length), 'partial construction disconnects every allocated node');
  assert.deepEqual(a.fade.outputs, [a.bass]);
});

test('drop construction rolls back a failed source connection', () => {
  const ctx = context(), source = ctx.createGain(), destination = ctx.createGain();
  source.connect(destination);
  const connect = source.connect;
  source.connect = function (next) {
    if (next !== destination) throw new Error('connection failed');
    return connect.call(this, next);
  };
  const allocated = ctx.nodes.length;
  assert.throws(() => new DropCutEffect(ctx, source, destination, rollSchedule(2, 0.5)), /connection failed/);
  assert.deepEqual(source.outputs, [destination]);
  assert.ok(ctx.nodes.slice(allocated).every(n => !n.outputs.length));
});

test('whole-track waveform jumps are time-mapped hints and real audio confirms and snaps them', () => {
  for (const duration of [120, 360]) {
    const samples = Array.from({ length: 1800 }, (_, i) => {
      const t = i * duration / 1800;
      return t >= 32 ? 0.9 : t >= 24 ? 0.05 : 0.8;
    });
    const result = fromWaveform({ samples, width: 1800, height: 1 }, duration);
    assert.ok(Math.abs(result.dropCandidates[0].time - 32) <= result.dropCandidates[0].uncertainty);
    assert.equal(result.drop, undefined, 'a waveform alone cannot enable Drop cut');
  }
  for (const values of [new Array(1800).fill(1), Array.from({ length: 1800 }, (_, i) => i / 1800),
    Array.from({ length: 1800 }, (_, i) => i === 480 ? 1 : 0.05)]) {
    assert.deepEqual(fromWaveform({ samples: values, width: 1800, height: 1 }, 120).dropCandidates, []);
  }
  const hint = { time: 32.18, uncertainty: 0.5 };
  const result = confirmDrop(dropAudio(), hint);
  assert.ok(result?.drop.confidence >= 0.7);
  assert.ok(Math.abs(result.drop.time - 32) < 0.03, 'coarse waveform time snaps to the real beat');
  close((result.drop.time - result.grid.downbeat) / (32 * result.grid.period), 0);
  assert.ok(Math.abs(confirmDrop(dropAudio(), { time: 33, uncertainty: 2 }).drop.time - 32) < 0.03,
    'coarse bins search for the actual edge across several beats');
  assert.equal(confirmDrop(dropAudio(34), { time: 34 }, grid), null, 'a known phrase origin must agree');
  assert.equal(confirmDrop(dropAudio(33), hint), null, 'a late edge is not a drop at the candidate');
  assert.equal(confirmDrop(dropAudio(32, { sustained: false }), hint), null);
  assert.equal(confirmDrop(dropAudio(32, { constant: true }), hint), null, 'loudness without beats is not confirmed');
  assert.equal(confirmDrop(dropAudio().filter(s => s.t < 27 || s.t > 30), hint), null, 'unheard gaps never count as a quiet build');
});

test('confirmation accepts a moderate sustained bass return and exposes rejection diagnostics', () => {
  const readings = dropAudio().map(s => ({ ...s, v: s.t < 32 ? s.v * 27.5 : s.v }));
  const result = inspectDrop(readings, { time: 32, uncertainty: 1 });
  assert.ok(result.drop, 'a 1.8× energy return need not reach the old 3× threshold');
  assert.ok(result.confidence >= 0.65);
  const failed = inspectDrop(dropAudio(32, { constant: true }), { time: 32 });
  assert.equal(failed.drop, null);
  assert.equal(failed.confidence, 0);
  assert.match(failed.reason, /no steady beat/);
  const compatible = { ratio: 1, gridOut: { ...grid, confidence: 0.4 }, gridIn: { ...grid, confidence: 0.4 } };
  assert.equal(planStyle({ style: 'dropcut', drop: result.drop, match: compatible }).style, 'dropcut');
  const brief = dropAudio().map(s => ({ ...s, v: s.t >= 36 ? s.v * 0.02 : s.v }));
  assert.equal(inspectDrop(brief, { time: 32 }).drop, null, 'the later half of the return must also carry bass');
});
