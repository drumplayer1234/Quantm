import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, resizeObservers } from './helpers/browser.js';

installBrowser();
const { Emitter } = await import('../src/js/dom.js');
const { bindServices, waveform, playButton, trackRow } = await import('../src/js/ui.js');
const player = Object.assign(new Emitter(), { current: null, playing: false });
const store = Object.assign(new Emitter(), { isLiked: () => false, isReposted: () => false });
bindServices(store, player, { waveform: async () => null });
const tracks = [{ id: 1, title: 'Track', duration: 10000 }];
const count = emitter => Object.values(emitter.handlers).reduce((total, handlers) => total + handlers.length, 0);

test('removing a subtree releases waveform, row and button listeners without another player event', async () => {
  const baseline = { player: count(player), store: count(store), theme: document.listenerCount('themechange'), style: document.listenerCount('wavestylechange') };
  for (let i = 0; i < 3; i++) {
    const host = document.createElement('div');
    host.append(waveform(tracks[0]), playButton(() => tracks), trackRow(tracks, 0));
    document.body.append(host);
    assert.ok(count(player) > baseline.player);
    assert.ok(count(store) > baseline.store);
    assert.equal(document.listenerCount('themechange'), baseline.theme + 1);
    host.remove();
    await Promise.resolve();
    assert.equal(count(player), baseline.player);
    assert.equal(count(store), baseline.store);
    assert.equal(document.listenerCount('themechange'), baseline.theme);
    assert.equal(document.listenerCount('wavestylechange'), baseline.style);
    assert.equal(resizeObservers.at(-1).disconnected, true);
  }
});

test('building detached components and moving connected components preserves subscriptions', async () => {
  const host = document.createElement('div');
  const target = document.createElement('div');
  const wave = waveform(tracks[0]);
  const before = count(player);
  await Promise.resolve();
  assert.equal(count(player), before);
  host.append(wave);
  document.body.append(host, target);
  target.append(wave);
  await Promise.resolve();
  assert.equal(count(player), before);
  assert.equal(resizeObservers.at(-1).disconnected, false);
  target.remove();
  host.remove();
  await Promise.resolve();
  assert.equal(count(player), before - 1);
  assert.equal(resizeObservers.at(-1).disconnected, true);
});
