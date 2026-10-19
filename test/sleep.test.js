import test from 'node:test';
import assert from 'node:assert/strict';
import { SleepTimer, formatRemaining } from '../src/js/sleep.js';

function fixture() {
  let now = 10000;
  const events = {};
  const calls = [];
  const player = {
    current: { id: 1 }, playing: true, rate: 1,
    on: (name, fn) => { (events[name] ||= []).push(fn); },
    normalizer: { fadeForSleep: seconds => calls.push(['fade', seconds]), restoreSleepVolume: () => calls.push(['restore']) },
    pause: () => calls.push(['pause'])
  };
  const timer = new SleepTimer(player, text => calls.push(['toast', text]), () => now);
  return { timer, player, calls, advance: ms => { now += ms; timer.tick(); }, emit: (name, ...args) => events[name]?.forEach(fn => fn(...args)) };
}

test('remaining time rounds up, supports 90 minutes, and never goes negative', () => {
  for (const [ms, text] of [[0, '00:00'], [1, '00:01'], [59999, '01:00'], [61000, '01:01'], [5400000, '90:00'], [-1, '00:00'], [NaN, '00:00']]) {
    assert.equal(formatRemaining(ms), text);
  }
});

test('timed sleep fades in the final eight seconds, pauses, and restores without changing volume', t => {
  t.mock.method(globalThis, 'setInterval', () => 0);
  const { timer, calls, advance } = fixture();
  let changes = 0;
  timer.on('change', () => changes++);
  timer.start(15);
  advance(15 * 60000 - 8000);
  assert.deepEqual(calls.at(-1), ['fade', 8]);
  advance(8000);
  assert.equal(timer.mode, null);
  assert.deepEqual(calls.slice(-3).map(c => c[0]), ['pause', 'restore', 'toast']);
  assert.ok(changes >= 3);
});

test('replacement and cancellation restore a fade and disarm end of track', t => {
  t.mock.method(globalThis, 'setInterval', () => 0);
  const { timer, player, calls, advance } = fixture();
  timer.startEndOfTrack();
  assert.equal(player.stopAtTrackEnd, true);
  timer.start(1);
  assert.equal(player.stopAtTrackEnd, false);
  advance(53000);
  timer.cancel();
  assert.equal(timer.firing, false);
  assert.equal(timer.mode, null);
  assert.equal(calls.some(c => c[0] === 'pause'), false);
  assert.deepEqual(calls.at(-2), ['restore']);
});

test('track timer follows pause, seek, speed and end events and cancels on manual skip', () => {
  const { timer, player, calls, emit } = fixture();
  timer.startEndOfTrack();
  emit('time', 92, 100);
  assert.deepEqual(calls.at(-1), ['fade', 8]);
  player.playing = false;
  emit('state');
  assert.equal(timer.firing, false);
  emit('time', 93, 100);
  assert.deepEqual(calls.at(-1), ['restore']);
  player.playing = true;
  player.rate = 2;
  emit('speed');
  emit('time', 94, 100);
  assert.deepEqual(calls.at(-1), ['fade', 3]);
  emit('time', 50, 100);
  assert.equal(timer.firing, false);
  emit('sleepend');
  assert.equal(timer.mode, null);
  assert.equal(player.stopAtTrackEnd, false);
  assert.equal(calls.filter(c => c[0] === 'pause').length, 1);
  timer.startEndOfTrack();
  player.current = { id: 2 };
  emit('track');
  assert.equal(timer.mode, null);
});

test('player end hook beats repeat-one and crossfade without advancing the queue', async t => {
  const { installBrowser } = await import('./helpers/browser.js');
  installBrowser();
  t.mock.method(globalThis, 'setInterval', () => 0);
  const { player } = await import('../src/js/player.js');
  const previous = { stopAtTrackEnd: player.stopAtTrackEnd, repeat: player.repeat };
  player.stopAtTrackEnd = true;
  player.repeat = 'one';
  let fired = 0;
  const off = player.on('sleepend', () => fired++);
  t.mock.method(player, 'next', () => assert.fail('must not advance'));
  t.mock.method(player, 'upcomingTransition', () => assert.fail('must not crossfade'));
  try {
    player.onEnded();
    player.checkCrossfade();
    assert.equal(fired, 1);
  } finally {
    off();
    Object.assign(player, previous);
  }
});
