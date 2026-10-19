import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCueTime, parseCueTime } from '../src/js/cue-time.js';

test('cue times accept seconds, m:ss, fractions and long songs', () => {
  for (const [text, seconds] of [['84', 84], ['1:24', 84], ['0:00', 0], [' 0:05.25 ', 5.25], ['65:10', 3910]]) {
    assert.equal(parseCueTime(text, 4000000), seconds);
    assert.equal(parseCueTime(formatCueTime(seconds), 4000000), seconds);
  }
  assert.equal(formatCueTime(84), '1:24');
  assert.equal(formatCueTime(5.25), '0:05.25');
  assert.equal(formatCueTime(59.999), '1:00');
});

test('cue time validation preserves blank defaults and rejects invalid positions', () => {
  assert.equal(parseCueTime('  ', 10000), null);
  assert.equal(parseCueTime('10', 10000), 10);
  for (const text of ['-1', '1:60', '1:02:03', 'abc', 'Infinity', '1e2', '0:10.01', '.']) {
    assert.ok(Number.isNaN(parseCueTime(text, 10000)), text);
  }
});
