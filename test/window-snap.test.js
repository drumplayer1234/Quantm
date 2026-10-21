import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { snapTarget, restoreBounds } = require('../window-snap.js');

// a 1920x1080 screen with a 40px taskbar at the bottom
const work = { x: 0, y: 0, width: 1920, height: 1040 };

test('top edge maximizes, side edges give halves, corners give quarters', () => {
  assert.deepEqual(snapTarget({ x: 900, y: 0 }, work), { kind: 'maximize' });
  assert.deepEqual(snapTarget({ x: 0, y: 500 }, work), { kind: 'half', bounds: { x: 0, y: 0, width: 960, height: 1040 } });
  assert.deepEqual(snapTarget({ x: 1919, y: 500 }, work), { kind: 'half', bounds: { x: 960, y: 0, width: 960, height: 1040 } });
  assert.deepEqual(snapTarget({ x: 0, y: 3 }, work).bounds, { x: 0, y: 0, width: 960, height: 520 });
  assert.deepEqual(snapTarget({ x: 1919, y: 1039 }, work).bounds, { x: 960, y: 520, width: 960, height: 520 });
});

test('dropping away from the edges, or on the bottom edge, does not snap', () => {
  assert.equal(snapTarget({ x: 900, y: 500 }, work), null);
  assert.equal(snapTarget({ x: 900, y: 1039 }, work), null);
  assert.equal(snapTarget({ x: 20, y: 500 }, work), null);
});

test('works on a second monitor to the right', () => {
  const second = { x: 1920, y: 0, width: 2560, height: 1400 };
  assert.deepEqual(snapTarget({ x: 1920, y: 700 }, second).bounds, { x: 1920, y: 0, width: 1280, height: 1400 });
});

test('a snapped window dragged away gets its old size back under the pointer', () => {
  const r = restoreBounds({ x: 480, y: 10 }, { x: 0, y: 0, width: 960, height: 1040 }, { x: 300, y: 200, width: 1280, height: 820 });
  assert.equal(r.width, 1280);
  assert.equal(r.height, 820);
  assert.equal(r.x, 480 - 640);
});
