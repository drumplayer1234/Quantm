import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';
installBrowser();
const { packFor, listPacks } = await import('../src/js/theme-packs.js');
const { PRESETS, PRESET_STYLES, PRESET_RADIUS, contrast } = await import('../src/js/theme.js');

test('packs are keyed by registered style and unknown ids have no pack', () => {
  // the original packs are always there; newer ones only need to be wired up properly
  for (const id of ['listening-room', 'pocket', 'tmux']) assert.ok(listPacks().includes(id), id);
  for (const id of listPacks()) assert.equal(typeof packFor(id).load, 'function', id);
  assert.equal(packFor('tmux').base, 'terminal');
  assert.equal(packFor('listening-room').layout, 'stage');
  assert.equal(typeof packFor('listening-room').load, 'function');
  for (const id of listPacks()) assert.ok(Object.values(PRESET_STYLES).includes(id));
  assert.equal(packFor('unknown'), null);
  assert.equal(packFor('toString'), null);
});

test('private local packs merge without changing the built-in registry', async () => {
  const localPack = { layout: 'private', load: async () => ({}) };
  window.QUANTM_LOCAL_THEMES = { packs: { private: localPack } };
  try {
    const local = await import('../src/js/theme-packs.js?local-test');
    assert.equal(local.packFor('private'), localPack);
    assert.ok(local.listPacks().includes('listening-room'));
    assert.equal(packFor('private'), null);
  } finally { delete window.QUANTM_LOCAL_THEMES; }
});

test('Listening Room text and accent labels meet contrast requirements', () => {
  const c = PRESETS['Listening Room'];
  assert.equal(PRESET_RADIUS['Listening Room'], 18);
  for (const bg of ['bg', 'surface', 'bar']) {
    for (const text of ['text', 'muted']) assert.ok(contrast(c[text], c[bg]) >= 4.5);
  }
  assert.ok(contrast(c.accentText, c.accent) >= 4.5);
});
