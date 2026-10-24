import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

installBrowser();
const cues = await import('../src/js/cues.js');

test('cue points stay sorted, dedupe nearby times and stop at nine', () => {
  cues._reset();
  assert.equal(cues.addCue(1, 30), 1);
  assert.equal(cues.addCue(1, 10, 'Intro'), 1);
  assert.equal(cues.addCue(1, 10.2), 1, 'within half a second of an existing cue');
  assert.deepEqual(cues.getCues(1).cues.map(c => c.t), [10, 30]);
  for (let i = 0; i < 10; i++) cues.addCue(1, 100 + i * 5);
  assert.equal(cues.getCues(1).cues.length, 9);
  assert.equal(cues.addCue(1, 500), 0, 'full');
  cues.removeCue(1, 0);
  assert.equal(cues.getCues(1).cues[0].t, 30);
});

test('mix points round-trip through storage and clear back to defaults', async () => {
  cues._reset();
  cues.setMixIn(5, 12.345);
  cues.setMixOut(5, 190);
  assert.deepEqual(cues.getCues(5), { cues: [], mixIn: 12.35, mixOut: 190 });
  const saved = JSON.parse(localStorage.getItem('quantm.cues'));
  assert.equal(saved.tracks['5'].mixOut, 190);
  cues.setMixIn(5, null);
  cues.setMixOut(5, null);
  assert.deepEqual(cues.getCues(5), { cues: [], mixIn: null, mixOut: null });
});

test('transitionFor: song points, pair overrides and fade defaults', () => {
  cues._reset();
  // nothing set: plain crossfade
  assert.deepEqual(cues.transitionFor(1, 2, 4), { out: null, in: 0, fade: 4, custom: false });
  // song points apply even with crossfade off, using the default fade
  cues.setMixOut(1, 180);
  cues.setMixIn(2, 32);
  assert.deepEqual(cues.transitionFor(1, 2, 0), { out: 180, in: 32, fade: 6, custom: true });
  assert.deepEqual(cues.transitionFor(1, 2, 3), { out: 180, in: 32, fade: 3, custom: true });
  // a pair override wins, field by field; fade 0 is a clean cut
  cues.setPair(1, 2, { out: 150, in: null, fade: 0 });
  assert.deepEqual(cues.transitionFor(1, 2, 3), { out: 150, in: 32, fade: 0, custom: true });
  // the override only covers that exact pair
  assert.deepEqual(cues.transitionFor(1, 3, 3), { out: 180, in: 0, fade: 3, custom: true });
  cues.setPair(1, 2, null);
  assert.equal(cues.getPair(1, 2), null);
});

test('changes are announced so the UI can redraw markers', () => {
  cues._reset();
  const seen = [];
  const off = cues.cueEvents.on('change', (id) => seen.push(id));
  cues.addCue(7, 3);
  cues.setMixOut(7, 60);
  off();
  assert.deepEqual(seen, [7, 7]);
});

test('pair transition styles persist and take precedence without losing mix markers', () => {
  cues._reset();
  cues.setMixOut(1, 180);
  cues.setMixIn(2, 32);
  for (const style of ['auto', 'blend', 'dropcut']) {
    cues.setPair(1, 2, { style, fade: null });
    assert.equal(cues.transitionFor(1, 2).style, style);
    assert.equal(cues.transitionFor(1, 2).out, 180);
    assert.equal(cues.transitionFor(1, 2).in, 32);
    assert.equal(JSON.parse(localStorage.getItem('quantm.cues')).pairs['1>2'].style, style);
  }
  cues.setPair(1, 2, { style: 'invalid' });
  assert.equal(cues.transitionFor(1, 2).style, undefined);
});

test('style-only pair overrides preserve normal Auto mix timing, while explicit zero cues and fades still override it', () => {
  cues._reset();
  cues.setPair(1, 2, { style: 'blend' });
  assert.deepEqual(cues.transitionFor(1, 2), { out: null, in: 0, fade: 0, custom: false, style: 'blend' });
  cues.setPair(1, 2, { style: 'auto', out: 0, in: 0, fade: 0 });
  assert.deepEqual(cues.transitionFor(1, 2, 6), { out: 0, in: 0, fade: 0, custom: true, style: 'auto' });
});
