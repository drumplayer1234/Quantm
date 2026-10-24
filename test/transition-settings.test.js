import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

test('legacy settings get Smooth blend, valid choices persist, and invalid styles repair to Smooth blend', async t => {
  installBrowser();
  t.mock.method(globalThis, 'setInterval', () => 0);
  localStorage.setItem('quantm.settings', JSON.stringify({ autoMix: true, volume: 0.34, normalize: false }));
  const { settings, saveSettings } = await import('../src/js/store.js');
  assert.equal(settings.transitionStyle, 'blend');
  assert.equal(settings.autoMix, true);
  assert.equal(settings.volume, 0.34);
  assert.equal(settings.normalize, false);
  for (const style of ['blend', 'dropcut', 'auto']) {
    saveSettings({ transitionStyle: style });
    assert.equal(JSON.parse(localStorage.getItem('quantm.settings')).transitionStyle, style);
  }
  for (const [i, style] of [null, 'unknown', 9].entries()) {
    localStorage.setItem('quantm.settings', JSON.stringify({ transitionStyle: style, volume: 0.34 }));
    const fresh = await import(`../src/js/store.js?settings-test=${i}`);
    assert.equal(fresh.settings.transitionStyle, 'blend');
    assert.equal(fresh.settings.volume, 0.34);
    saveSettings({ transitionStyle: style });
    assert.equal(settings.transitionStyle, 'blend');
  }
});

test("dev.3's saved default 'auto' becomes Smooth blend, but a picked Auto stays", async t => {
  installBrowser();
  t.mock.method(globalThis, 'setInterval', () => 0);
  localStorage.setItem('quantm.settings', JSON.stringify({ transitionStyle: 'auto' }));
  const old = await import('../src/js/store.js?settings-test=dev3');
  assert.equal(old.settings.transitionStyle, 'blend');
  localStorage.setItem('quantm.settings', JSON.stringify({ transitionStyle: 'auto', transitionStyleChosen: true }));
  const picked = await import('../src/js/store.js?settings-test=picked');
  assert.equal(picked.settings.transitionStyle, 'auto');
});
