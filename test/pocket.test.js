import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installBrowser } from './helpers/browser.js';
import { angleDelta, wheelSteps, moveSelection, feedItems } from '../src/js/packs/pocket-input.js';

installBrowser();
const { PACKS } = await import('../src/js/theme-packs.js');
const { PRESETS, PRESET_STYLES, PRESET_RADIUS, contrast } = await import('../src/js/theme.js');

test('Pocket is a device pack with a linked stylesheet and readable preset', () => {
  assert.equal(PRESET_STYLES['Pocket Quantm'], 'pocket');
  assert.equal(PRESET_RADIUS['Pocket Quantm'], 14);
  assert.equal(PACKS.pocket.layout, 'device');
  assert.equal(typeof PACKS.pocket.load, 'function');
  const css = readFileSync(new URL('../src/styles/themes/pocket.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(css, /html\[data-style="pocket"\]/);
  assert.match(html, /<link rel="stylesheet" href="styles\/themes\/pocket.css">/);
  const colors = PRESETS['Pocket Quantm'];
  for (const bg of ['bg', 'surface', 'bar']) {
    for (const fg of ['text', 'muted']) assert.ok(contrast(colors[fg], colors[bg]) >= 4.5, `${fg} on ${bg}`);
  }
  assert.ok(contrast(colors.accentText, colors.accent) >= 4.5);
  const token = name => css.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))[1];
  assert.ok(contrast(token('pocket-lcd'), token('pocket-ink')) >= 4.5);
});

test('ring angle crosses its seam in either direction without a large jump', () => {
  assert.ok(Math.abs(angleDelta(Math.PI - .1, -Math.PI + .1) - .2) < 1e-10);
  assert.ok(Math.abs(angleDelta(-Math.PI + .1, Math.PI - .1) + .2) < 1e-10);
  assert.equal(angleDelta(1, 1), 0);
});

test('ring steps accumulate partial movement, preserve remainder and reverse', () => {
  const first = wheelSteps(0, .15, .25);
  assert.equal(first.steps, 0);
  const second = wheelSteps(first.remainder, .4, .25);
  assert.equal(second.steps, 2);
  assert.ok(Math.abs(second.remainder - .05) < 1e-10);
  const reverse = wheelSteps(second.remainder, -.6, .25);
  assert.equal(reverse.steps, -2);
  assert.ok(Math.abs(reverse.remainder + .05) < 1e-10);
});

test('selection clamps at both edges and handles empty lists', () => {
  assert.equal(moveSelection(0, -1, 6), 0);
  assert.equal(moveSelection(4, 10, 6), 5);
  assert.equal(moveSelection(4, -2, 6), 2);
  assert.equal(moveSelection(5, 0, 2), 1);
  assert.equal(moveSelection(0, 1, 0), 0);
});

test('feed keeps tracks and playlists, deduplicates reposts, and ignores empty posts', () => {
  const track = { kind: 'track', id: 7 };
  const playlist = { kind: 'playlist', id: 7 };
  assert.deepEqual(feedItems([{ track }, { track }, {}, { playlist }, { track: {} }]), [track, playlist]);
});

test('device retries, paginates, browses by wheel and keys, plays a list, and cleans up', async () => {
  const { Emitter, h } = await import('../src/js/dom.js');
  const { renderDevice } = await import('../src/js/packs/pocket-device.js');
  const { bindServices } = await import('../src/js/ui.js');
  const proto = Element.prototype;
  Object.defineProperty(proto, 'children', { configurable: true, get() { return this.childNodes.filter(node => node instanceof Element); } });
  proto.removeAttribute = function (key) { this.attributes.delete(key); };
  proto.getAnimations = () => [];
  window.matchMedia = () => Object.assign(new EventTarget(), { matches: true });
  const player = Object.assign(new Emitter(), {
    queue: [], index: -1, playing: false, audio: { currentTime: 0 }, duration: 0,
    playList(tracks, index, context) { this.queue = tracks; this.index = index; this.current = tracks[index]; this.context = context; }
  });
  const store = Object.assign(new Emitter(), { me: { id: 1 }, isLiked: () => false });
  bindServices(store, player, {});
  const moments = new Emitter();
  const tracks = [1, 2].map(id => ({ id, title: `Track ${id}`, kind: 'track' }));
  let calls = 0;
  window.native.api = async () => {
    calls++;
    if (calls === 1) throw new Error('Offline');
    return { ok: true, data: { collection: [{ track: tracks[calls - 2] }], next_href: calls === 2 ? 'next' : null } };
  };
  const page = h('div');
  document.body.append(page);
  const cleanup = renderDevice(page, { player, store, moments, settings: { themeEffects: 'off' } });
  const find = (node, cls) => node.className?.split(' ').includes(cls) ? node : node.childNodes.map(child => find(child, cls)).find(Boolean);
  const click = node => node.dispatchEvent({ type: 'click', stopPropagation() {} });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const list = find(page, 'pocket-list');
  click(list.children[1]);
  await flush();
  assert.equal(calls, 1);
  assert.equal(list.children.length, 1);
  click(list.children[0]);
  await flush();
  assert.equal(calls, 2);
  assert.equal(list.children.length, 2);
  let prevented = false;
  find(page, 'pocket-wheel').dispatchEvent({ type: 'wheel', deltaY: 40, deltaMode: 0, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(list.children[1].attributes.get('aria-selected'), 'true');
  find(page, 'pocket-device').dispatchEvent({ type: 'keydown', key: 'ArrowUp', target: list, preventDefault() {}, stopPropagation() {} });
  assert.equal(list.children[0].attributes.get('aria-selected'), 'true');
  click(list.children[1]);
  await flush();
  assert.equal(list.children.length, 2);
  click(list.children[1]);
  assert.deepEqual(player.queue, tracks);
  assert.equal(player.index, 1);
  assert.equal(player.context.href, '#/library/likes');
  assert.equal(list.hidden, true);
  click(find(page, 'pocket-wheel-menu'));
  assert.equal(list.hidden, false);
  assert.equal(list.children[1].attributes.get('aria-selected'), 'true');
  // A slow request that finishes after the view is disposed must not rebuild it.
  click(find(page, 'pocket-wheel-menu'));
  let finish;
  window.native.api = () => new Promise(resolve => { finish = resolve; });
  click(list.children[1]);
  assert.equal(player.handlers.time.length, 1);
  cleanup(); cleanup();
  finish({ ok: true, data: { collection: [{ track: tracks[0] }], next_href: null } });
  await flush();
  assert.equal(player.handlers.time.length, 0);
  assert.equal(moments.handlers.trackchange.length, 0);
  assert.equal(document.listenerCount('routerendered'), 0);
  assert.equal(page.childNodes.length, 0);
  page.remove();
});
