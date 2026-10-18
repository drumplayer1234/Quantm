import test, { beforeEach, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

installBrowser();
// The session timer is unrelated to queue behavior and must not keep Node alive.
const timer = mock.method(globalThis, 'setInterval', () => 0);
const { player } = await import('../src/js/player.js');
timer.mock.restore();
const tracks = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: 'Track ' + (i + 1), duration: 100000 }));

describe('player queue', () => {
  beforeEach(() => {
    player.queue = tracks.slice();
    player.index = 2;
    player.original = null;
    player.shuffle = false;
    player.context = null;
    localStorage.clear();
  });

  test('clearQueue retains the current track at zero from every valid index', () => {
    for (let index = 0; index < tracks.length; index++) {
      player.queue = tracks.slice();
      player.index = index;
      player.original = tracks.slice();
      player.clearQueue();
      assert.deepEqual(player.queue, [tracks[index]]);
      assert.equal(player.current, tracks[index]);
      assert.equal(player.index, 0);
      assert.equal(player.original, null);
    }
    player.queue = [];
    player.index = -1;
    player.clearQueue();
    assert.deepEqual(player.queue, []);
    assert.equal(player.index, -1);
  });

  test('removing a queued track updates original and cannot resurrect it after shuffle', () => {
    player.shuffle = true;
    player.original = tracks.slice();
    player.queue = [tracks[4], tracks[0], tracks[2], tracks[3], tracks[1]];
    const current = player.current;
    player.removeFromQueue(1);
    assert.equal(player.index, 1);
    assert.equal(player.current, current);
    assert.ok(!player.original.includes(tracks[0]));
    player.toggleShuffle();
    assert.deepEqual(player.queue, tracks.slice(1));
    assert.equal(player.current, current);
    assert.equal(player.original, null);
  });

  test('removing the current track is a no-op; removing a later track preserves index', () => {
    player.original = tracks.slice();
    player.removeFromQueue(2);
    assert.deepEqual(player.queue, tracks);
    assert.deepEqual(player.original, tracks);
    player.removeFromQueue(4);
    assert.equal(player.index, 2);
    assert.equal(player.current, tracks[2]);
    assert.deepEqual(player.original, tracks.slice(0, 4));
  });

  test('every queue move keeps index on the same track', () => {
    for (let index = 0; index < tracks.length; index++) {
      for (let from = 0; from < tracks.length; from++) {
        for (let to = 0; to < tracks.length; to++) {
          player.queue = tracks.slice();
          player.index = index;
          player.moveInQueue(from, to);
          assert.equal(player.current, tracks[index], `index=${index}, from=${from}, to=${to}`);
          const expected = tracks.slice();
          expected.splice(to, 0, expected.splice(from, 1)[0]);
          assert.deepEqual(player.queue, expected);
        }
      }
    }
  });

  test('addToQueue and playNext keep original in sync when shuffle is disabled again', t => {
    // Toast expiry timers are UI-only; exercise the real queue methods and events.
    t.mock.method(globalThis, 'setTimeout', () => 0);
    player.shuffle = true;
    player.original = tracks.slice();
    const current = player.current;
    const extra = [6, 7, 8, 9].map(id => ({ id, title: 'Track ' + id }));
    player.addToQueue(extra[0]);
    player.addToQueue(extra.slice(1, 3));
    player.playNext(extra[3]);
    assert.equal(player.queue[player.index + 1], extra[3]);
    assert.deepEqual(player.original, [...tracks, ...extra]);
    assert.equal(player.current, current);
    player.toggleShuffle();
    assert.deepEqual(player.queue, [...tracks, ...extra]);
    assert.equal(player.current, current);
  });
});
