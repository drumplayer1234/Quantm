import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

installBrowser();
const local = await import('../src/js/local-playlists.js');
const track = id => ({ id, title: `Track ${id}`, duration: 120000, permalink_url: `https://soundcloud.com/artist/${id}`, artwork_url: null, user: { id: 10, username: 'Artist', avatar_url: null } });
test.beforeEach(() => localStorage.clear());

test('create, rename, remove and changes are persisted without exposing mutable state', () => {
  let changes = 0;
  const off = local.events.on('change', () => changes++);
  const p = local.create('  Favorites  ', [track(1)]);
  assert.match(p.id, /^q[a-z0-9]+$/);
  assert.equal(local.list()[0].title, 'Favorites');
  assert.ok(p.createdAt > 0);
  p.tracks.length = 0;
  assert.equal(local.get(p.id).tracks.length, 1);
  assert.equal(local.rename(p.id, 'Renamed'), true);
  assert.equal(local.get(p.id).title, 'Renamed');
  assert.ok(local.get(p.id).updatedAt >= p.createdAt);
  assert.equal(local.remove(p.id), true);
  assert.equal(local.get(p.id), null);
  assert.equal(local.remove(p.id), false);
  assert.equal(changes, 3);
  off();
  assert.throws(() => local.create('   '));
});

test('adds do not duplicate and toggle adds/removes instantly', () => {
  const p = local.create('Test', [track(1), track(1)]);
  assert.equal(local.addTrack(p.id, track(1)), false);
  assert.equal(local.addTrack(p.id, track(2)), true);
  assert.equal(local.has(p.id, 2), true);
  assert.equal(local.toggleTrack(p.id, track(2)), false);
  assert.equal(local.has(p.id, 2), false);
  assert.equal(local.toggleTrack(p.id, track(2)), true);
  assert.equal(local.removeTrack(p.id, 1), true);
  assert.deepEqual(local.get(p.id).tracks.map(t => t.id), [2]);
  assert.equal(local.addTrack('missing', track(3)), false);
});

test('move keeps order and rejects out of bounds and non-integer positions', () => {
  const p = local.create('Test', [track(1), track(2), track(3)]);
  assert.equal(local.moveTrack(p.id, 0, 2), true);
  assert.deepEqual(local.get(p.id).tracks.map(t => t.id), [2, 3, 1]);
  for (const [from, to] of [[-1, 0], [0, -1], [3, 0], [0, 3], [0.5, 1], [0, 0]]) {
    assert.equal(local.moveTrack(p.id, from, to), false);
  }
  assert.equal(local.moveTrack(p.id, 2, 0), true);
  assert.deepEqual(local.get(p.id).tracks.map(t => t.id), [1, 2, 3]);
});

test('export/import round trip preserves metadata and resolves conflicting IDs', () => {
  const p = local.create('Favorites', [track(1), track(2)]);
  const exported = local.exportJSON(p.id);
  const [copy] = local.importJSON(exported);
  assert.notEqual(copy.id, p.id);
  assert.deepEqual(copy.tracks, p.tracks);
  assert.equal(copy.title, p.title);
  assert.equal(copy.createdAt, p.createdAt);
  const all = local.exportJSON();
  localStorage.clear();
  assert.equal(local.importJSON(all).length, 2);
  assert.deepEqual(JSON.parse(local.exportJSON()), JSON.parse(all));
});

test('import rejects junk envelopes and ignores malformed playlists/tracks and unsafe fields', () => {
  for (const value of ['oops', 'null', '{}', '[]', '{"version":2,"playlists":[]}', '{"version":1,"playlists":[null,{}]}']) {
    assert.throws(() => local.importJSON(value));
    assert.deepEqual(local.list(), []);
  }
  const [p] = local.importJSON(JSON.stringify({ version: 1, playlists: [null, {}, {
    id: '../unsafe', title: 'Imported', tracks: [null, {}, track(-1), { ...track(1), duration: 'bad' },
      { ...track(1), user: { id: 1 } }, { ...track(1), id: '1' },
      { ...track(2), artwork_url: 'javascript:alert(1)', track_authorization: 'secret' }, track(2)]
  }] }));
  assert.match(p.id, /^q[a-z0-9]+$/);
  assert.deepEqual(p.tracks.map(t => t.id), [2]);
  assert.equal(p.tracks[0].artwork_url, null);
  assert.equal(p.tracks[0].track_authorization, undefined);
});

test('corrupt or unsupported storage falls back to empty', () => {
  for (const value of ['bad JSON', 'null', '{"version":9,"playlists":[]}', '{"version":1,"playlists":[null,{}]}']) {
    localStorage.setItem(local.KEY, value);
    assert.deepEqual(local.list(), []);
  }
  assert.equal(local.create('Recovered').title, 'Recovered');
});

test('storage failures do not emit success or destroy the previous data', t => {
  const p = local.create('Test');
  let changes = 0;
  const off = local.events.on('change', () => changes++);
  t.mock.method(localStorage, 'setItem', () => { throw new Error('Quota exceeded'); });
  assert.throws(() => local.rename(p.id, 'Lost'), /Could not save/);
  assert.equal(local.get(p.id).title, 'Test');
  assert.equal(changes, 0);
  off();
});
