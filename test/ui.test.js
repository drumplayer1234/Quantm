import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser, resizeObservers } from './helpers/browser.js';

installBrowser();
const { Emitter } = await import('../src/js/dom.js');
const { cueEvents, addCue, setMixIn, setMixOut, _reset } = await import('../src/js/cues.js');
const { bindServices, waveform, playButton, trackRow } = await import('../src/js/ui.js');
const player = Object.assign(new Emitter(), { current: null, playing: false });
const store = Object.assign(new Emitter(), { isLiked: () => false, isReposted: () => false });
bindServices(store, player, { waveform: async () => null });
const tracks = [{ id: 1, title: 'Track', duration: 10000 }];
const count = emitter => Object.values(emitter.handlers).reduce((total, handlers) => total + handlers.length, 0);

test('removing a subtree releases waveform, row and button listeners without another player event', async () => {
  const baseline = { player: count(player), store: count(store), theme: document.listenerCount('themechange'), style: document.listenerCount('wavestylechange') };
  const cueBaseline = count(cueEvents);
  for (let i = 0; i < 3; i++) {
    const host = document.createElement('div');
    host.append(waveform(tracks[0]), playButton(() => tracks), trackRow(tracks, 0));
    document.body.append(host);
    assert.ok(count(player) > baseline.player);
    assert.ok(count(store) > baseline.store);
    assert.equal(count(cueEvents), cueBaseline + 1);
    assert.equal(document.listenerCount('themechange'), baseline.theme + 1);
    host.remove();
    await Promise.resolve();
    assert.equal(count(player), baseline.player);
    assert.equal(count(store), baseline.store);
    assert.equal(count(cueEvents), cueBaseline);
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

test('waveform markers update for their song and cue clicks seek to the exact media time', async () => {
  _reset();
  const wave = waveform(tracks[0]);
  document.body.append(wave);
  const markers = wave.childNodes[2];
  addCue(2, 2);
  assert.equal(markers.childNodes.length, 0);
  addCue(1, 1.25);
  setMixIn(1, 0);
  setMixOut(1, 9);
  assert.equal(markers.childNodes.length, 3);
  assert.equal(markers.childNodes[0].style.left, '12.5%');
  assert.equal(markers.childNodes[1].style.left, '0%');
  assert.equal(markers.childNodes[2].style.left, '90%');
  let sought;
  player.current = tracks[0];
  player.seek = t => { sought = t; };
  markers.childNodes[0].dispatchEvent({ type: 'click', stopPropagation() {} });
  assert.equal(sought, 1.25);
  wave.remove();
  player.current = null;
  await Promise.resolve();
  _reset();
});
