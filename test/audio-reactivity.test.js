import test from 'node:test';
import assert from 'node:assert/strict';
import { bandsFrom, smooth, onsetStep, createAudioReactivity, effectsMode, effectsAllowed } from '../src/js/audio-reactivity.js';
import { installBrowser } from './helpers/browser.js';

installBrowser();
const { Emitter } = await import('../src/js/dom.js');

test('frequency bands follow Hz boundaries and stay normalized', () => {
  const bytes = new Uint8Array(1024);
  for (let i = 1; i < 11; i++) bytes[i] = 255;
  const bands = bandsFrom(bytes, 48000, 2048);
  assert.ok(bands.bass > bands.mid && bands.bass > bands.treble);
  assert.ok(bands.bass > 0.9 && bands.bass <= 1);
  assert.deepEqual(bandsFrom(new Uint8Array(), 48000, 2048), { bass: 0, mid: 0, treble: 0 });
  bytes.fill(255);
  assert.deepEqual(bandsFrom(bytes, 48000, 2048), { bass: 1, mid: 1, treble: 1 });
});

test('smoothing uses independent attack and release', () => {
  assert.equal(smooth(0, 1, 0.6, 0.1), 0.6);
  assert.equal(smooth(1, 0, 0.6, 0.1), 0.9);
  assert.equal(smooth(0.5, 0.5), 0.5);
});

test('onsets pulse on a jump, decay, and do not retrigger at steady energy', () => {
  let state;
  for (let i = 0; i < 60; i++) state = onsetStep(state, 0.02);
  state = onsetStep(state, 0.8);
  assert.equal(state.pulse, 1);
  state = onsetStep(state, 0.8);
  assert.ok(state.pulse < 1 && state.pulse > 0);
  for (let i = 0; i < 120; i++) state = onsetStep(state, 0.8);
  assert.ok(state.pulse < 0.01);
});

test('one shared loop stops and restarts for all gating conditions and playback', () => {
  const media = new EventTarget();
  media.matches = false;
  window.matchMedia = () => media;
  const frames = new Map();
  let id = 0;
  globalThis.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const player = Object.assign(new Emitter(), { playing: true, normalizer: {} });
  const store = new Emitter();
  const settings = {};
  const scheduler = createAudioReactivity(player, store, settings);
  const seen = [];
  const offA = scheduler.subscribe(frame => seen.push(frame));
  const offB = scheduler.subscribe(() => {});
  assert.equal(frames.size, 1);
  function frame(time) {
    const [id, fn] = frames.entries().next().value;
    frames.delete(id); fn(time);
  }
  frame(0); frame(20);
  assert.equal(seen.length, 1);
  frame(40);
  assert.equal(seen.length, 2);
  for (const attr of ['data-perf', 'data-hidden']) {
    document.documentElement.setAttribute(attr, '');
    document.dispatchEvent(new CustomEvent('appvisibility'));
    assert.equal(frames.size, 0);
    document.documentElement.attributes.delete(attr);
    document.dispatchEvent(new CustomEvent('appvisibility'));
    assert.equal(frames.size, 1);
  }
  for (const gate of ['setting', 'media', 'hidden', 'playing']) {
    const toggle = blocked => {
      if (gate === 'setting') { settings.themeEffects = !blocked; store.emit('settings'); }
      if (gate === 'media') { media.matches = blocked; media.dispatchEvent(new Event('change')); }
      if (gate === 'hidden') { document.hidden = blocked; document.dispatchEvent(new CustomEvent('visibilitychange')); }
      if (gate === 'playing') { player.playing = !blocked; player.emit('state'); }
    };
    toggle(true);
    assert.equal(frames.size, 0, gate);
    assert.equal(seen.at(-1).level, 0);
    assert.equal(seen.at(-1).pulse, 0);
    toggle(false);
    assert.equal(frames.size, 1, gate);
  }
  offA(); assert.equal(frames.size, 1);
  offB(); assert.equal(frames.size, 0);
  scheduler.destroy();
});

test('theme effects: auto follows reduced motion, on overrides it, off always wins', () => {
  assert.equal(effectsMode(true), 'auto');
  assert.equal(effectsMode(undefined), 'auto');
  assert.equal(effectsMode(false), 'off');
  assert.equal(effectsMode('on'), 'on');
  assert.equal(effectsAllowed('auto', false), true);
  assert.equal(effectsAllowed('auto', true), false);
  assert.equal(effectsAllowed('on', true), true);
  assert.equal(effectsAllowed('off', false), false);
  assert.equal(effectsAllowed(true, true), false);
});
