import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';
import { startAutoMixCss, stopAutoMixCss } from '../src/js/automix-css.js';

installBrowser();
const { Emitter } = await import('../src/js/dom.js');

function fixture(t) {
  stopAutoMixCss();
  const frames = new Map();
  let id = 0;
  let now = 0;
  let calls = 0;
  const media = { matches: false };
  window.matchMedia = () => media;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = key => frames.delete(key);
  const clock = mock.method(performance, 'now', () => now);
  // a theme that reads --beat (automix-css only feeds it to those)
  document.documentElement.dataset = { style: 'risograph' };
  const status = { on: true, live: { bpm: 120, period: 0.5, offset: 0.1 } };
  const player = Object.assign(new Emitter(), {
    playing: true, autoMix: true, audio: { currentTime: 0.1, playbackRate: 1 }, fading: null,
    autoMixStatus() { calls++; return status; }
  });
  t.after(() => { stopAutoMixCss(); clock.mock.restore(); });
  return {
    player, status, media, frames, html: document.documentElement,
    calls: () => calls,
    frame(time, position = player.audio.currentTime) {
      now = time;
      player.audio.currentTime = position;
      const entry = frames.entries().next().value;
      assert.ok(entry, 'a frame is scheduled');
      frames.delete(entry[0]); entry[1](now);
    }
  };
}

test('on/off and pause/resume gate one loop, reset all hooks, and clean up', t => {
  const f = fixture(t);
  f.player.autoMix = false;
  startAutoMixCss(f.player);
  assert.equal(f.html.dataset.automix, 'off');
  assert.equal(f.calls(), 0);
  assert.equal(f.frames.size, 0);
  f.player.autoMix = true; f.player.emit('time');
  assert.equal(f.html.dataset.automix, 'on');
  assert.equal(f.frames.size, 1);
  f.player.emit('time'); f.player.emit('automix');
  assert.equal(f.frames.size, 1);
  assert.equal(f.calls(), 1);
  f.player.playing = false; f.player.emit('state');
  assert.equal(f.frames.size, 0);
  assert.equal(f.html.dataset.automix, 'off');
  for (const key of ['--beat', '--mix', '--bpm']) assert.equal(f.html.style[key], '0');
  assert.equal(f.html.dataset.swap, undefined);
  assert.equal(f.html.dataset.lock, 'none');
  f.player.playing = true; f.player.emit('state');
  assert.equal(f.frames.size, 1);
  f.player.autoMix = false; f.frame(16);
  assert.equal(f.frames.size, 0);
  assert.equal(f.html.dataset.automix, 'off');
  f.player.autoMix = true; f.player.emit('time');
  startAutoMixCss(f.player); // Startup is idempotent, including listeners.
  assert.equal(f.frames.size, 1);
  stopAutoMixCss(); stopAutoMixCss();
  assert.equal(f.frames.size, 0);
  f.player.emit('state');
  assert.equal(f.frames.size, 0);
});

test('cached grid drives sawtooth, beat parity and live BPM without per-frame status analysis', t => {
  const f = fixture(t);
  startAutoMixCss(f.player);
  f.frame(40, 0.225); // --beat is written at most every 33 ms
  assert.ok(Math.abs(Number(f.html.style['--beat']) - 0.25) < 1e-9);
  assert.equal(f.html.dataset.beat, 'a');
  f.frame(80, 0.6);
  assert.equal(f.html.dataset.beat, 'b');
  assert.equal(f.html.style['--beat'], '0');
  f.frame(120, 1.1);
  assert.equal(f.html.dataset.beat, 'a');
  assert.equal(f.calls(), 1);
  f.player.audio.playbackRate = 1.1;
  f.frame(250, 1.225);
  assert.equal(f.calls(), 2);
  assert.equal(f.html.style['--bpm'], '132');
  f.frame(300, 0); // A seek before the grid origin still wraps into [0, 1).
  assert.ok(Math.abs(Number(f.html.style['--beat']) - 0.8) < 1e-9);
});

test('mix progress follows the audio clock, swap is at halfway, lock requires small error', t => {
  const f = fixture(t);
  f.player.fading = { progress: 0.2, startedAt: 10, seconds: 10 };
  f.player.normalizer = { ctx: { currentTime: 10 } };
  f.status.mix = { progress: 0.2 };
  f.status.lock = { active: true, errorMs: -8 };
  startAutoMixCss(f.player);
  assert.equal(f.html.dataset.automix, 'mixing');
  assert.equal(f.html.style['--mix'], '0.2');
  assert.equal(f.html.dataset.swap, 'before');
  assert.equal(f.html.dataset.lock, 'locked');
  f.player.normalizer.ctx.currentTime = 13;
  f.frame(16);
  assert.equal(f.html.style['--mix'], '0.5');
  assert.equal(f.html.dataset.swap, 'after');
  f.status.lock = { active: true, errorMs: 30 };
  f.frame(250);
  assert.equal(f.html.dataset.lock, 'none');
  f.player.normalizer.ctx.currentTime = 30;
  f.frame(300);
  assert.equal(f.html.style['--mix'], '1');
  f.player.fading = null; f.frame(282);
  assert.equal(f.html.dataset.automix, 'on');
  assert.equal(f.html.style['--mix'], '0');
  assert.equal(f.html.dataset.swap, undefined);
  assert.equal(f.html.dataset.lock, 'none');
});

test('mixing uses incoming grid, stale plans are rejected, structure is the last fallback', t => {
  const f = fixture(t);
  f.player.mixPlan = { grid: { bpm: 100, period: 0.6, offset: 0 } };
  startAutoMixCss(f.player);
  assert.equal(f.html.style['--bpm'], '100');
  f.player.fading = { progress: 0 };
  f.player.lock = { match: { gridIn: { bpm: 150, period: 0.4, offset: 0.05 } } };
  f.player.audio = { currentTime: 0.15, playbackRate: 1 };
  f.frame(40);
  assert.equal(f.html.style['--bpm'], '150');
  assert.ok(Math.abs(Number(f.html.style['--beat']) - 0.25) < 1e-9);
  f.player.fading = null;
  f.player.mixPlan.loadId = 1; f.player.loadId = 2;
  f.status.live = null;
  f.status.structure = { grid: { bpm: 90, period: 2 / 3, offset: 0 } };
  f.frame(300);
  assert.equal(f.html.style['--bpm'], '90');
  f.status.structure.grid = { period: NaN, offset: 0 };
  f.frame(560);
  assert.equal(f.html.style['--bpm'], '0');
  assert.equal(f.html.style['--beat'], '0');
});

test('motion off freezes beat markers; auto respects reduced motion and on can override', t => {
  const f = fixture(t);
  startAutoMixCss(f.player);
  f.frame(16, 0.6);
  assert.equal(f.html.dataset.beat, 'b');
  f.html.dataset.themeMotion = 'off';
  f.frame(32, 1.1);
  assert.equal(f.html.dataset.beat, 'b');
  f.player.playing = false; f.player.emit('state');
  assert.equal(f.html.dataset.beat, 'b');
  f.player.playing = true; f.player.emit('state');
  f.html.dataset.themeMotion = 'auto'; f.media.matches = true;
  f.frame(48, 1.1);
  assert.equal(f.html.dataset.beat, 'b');
  f.html.dataset.themeMotion = 'on';
  f.frame(64, 1.1);
  assert.equal(f.html.dataset.beat, 'a');
});
