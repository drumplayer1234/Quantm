import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

installBrowser();
const { Emitter, h } = await import('../src/js/dom.js');
const { mount } = await import('../src/js/packs/twin-deck.js');
const find = (node, name) => node.className?.split(' ').includes(name) ? node :
  node.childNodes.map(child => find(child, name)).find(Boolean);

test('console follows both decks, settings, queue navigation, pause and beat markers; disposes all work', async t => {
  let interval;
  let cleared = false;
  const timers = mock.method(globalThis, 'setInterval', fn => { interval = fn; return 42; });
  const cancel = mock.method(globalThis, 'clearInterval', id => { assert.equal(id, 42); cleared = true; });
  let mutated;
  let disconnected = false;
  const NativeObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(fn) { mutated = fn; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const clock = mock.method(performance, 'now', () => 0);
  t.after(() => {
    timers.mock.restore(); cancel.mock.restore(); clock.mock.restore();
    globalThis.MutationObserver = NativeObserver;
  });
  window.matchMedia = () => ({ matches: false });
  document.documentElement.dataset = { themeMotion: 'on', beat: 'a', automix: 'mixing' };
  const tracks = [1, 2, 3].map(id => ({ id, title: `Record ${id}`, user: { username: `Artist ${id}` }, duration: 240000 }));
  const grid = { bpm: 120, period: 0.5, offset: 0 };
  const store = new Emitter();
  let jumped;
  let calls = 0;
  const player = Object.assign(new Emitter(), {
    playing: true, autoMix: true, current: tracks[1], index: 1, queue: tracks,
    audio: { currentTime: 1, playbackRate: 1 },
    fading: { from: tracks[0], to: tracks[1] },
    lock: { match: { gridOut: grid, gridIn: grid } },
    autoMixStatus() { calls++; return { live: grid, mix: this.fading && { progress: 0.6 }, lock: { active: true, errorMs: 5 } }; },
    jump(index) { jumped = index; }
  });
  const page = h('div');
  let loader;
  const unmount = mount({ player, store, views: { override(name, value) { assert.equal(name, 'home'); loader = value; } } });
  t.after(unmount);
  const disposeView = (await loader()).render(page);
  const a = find(page, 'td-deck-a');
  const b = find(page, 'td-deck-b');
  const consoleNode = find(page, 'td-console');
  assert.equal(find(a, 'td-track-title').textContent, 'Record 1');
  assert.equal(find(b, 'td-track-title').textContent, 'Record 2');
  assert.equal(find(a, 'td-bpm').textContent, '120.0');
  assert.equal(consoleNode.dataset.mixing, 'true');
  assert.equal(find(page, 'td-lock-state').textContent, 'Locked');
  assert.equal(find(page, 'td-crossfader').attributes.get('aria-valuenow'), '60');
  document.documentElement.dataset.beat = 'b'; mutated();
  assert.equal(find(page, 'td-beats').dataset.step, '1');
  mutated(); // Repeated attributes cannot advance the four-step counter.
  assert.equal(find(page, 'td-beats').dataset.step, '1');
  document.documentElement.dataset.themeMotion = 'off';
  document.documentElement.dataset.beat = 'a'; mutated();
  assert.equal(find(page, 'td-beats').dataset.step, '1');
  const crate = find(page, 'td-crate');
  find(crate.childNodes[1], 'td-crate-track').dispatchEvent({ type: 'click' });
  assert.equal(jumped, 2);
  player.playing = false; player.emit('state');
  assert.equal(consoleNode.dataset.playing, 'false');
  player.autoMix = false; store.emit('settings');
  assert.equal(find(b, 'td-track-title').textContent, 'Auto mix off');
  assert.equal(find(b, 'td-bpm').textContent, '---.-');
  assert.equal(find(a, 'td-track-title').textContent, 'Record 2');
  assert.equal(consoleNode.dataset.auto, 'off');
  const before = calls;
  interval(); // Paused/off does not poll expensive status analysis.
  assert.equal(calls, before);
  unmount(); disposeView(); unmount();
  assert.equal(find(page, 'td-workstation'), undefined);
  assert.ok(cleared);
  assert.ok(disconnected);
  assert.ok(Object.values(player.handlers).every(list => list.length === 0));
  assert.ok(Object.values(store.handlers).every(list => list.length === 0));
});
