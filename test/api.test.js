import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';
import { Pager, ApiError, isPromoted, idOf, streamFor, cacheTrack, tracksByIds } from '../src/js/api.js';

installBrowser();
const ok = data => ({ ok: true, data });

test('Pager follows next_href, maps/filter items and stops after the last page', async t => {
  const calls = [];
  t.mock.method(window.native, 'api', async request => {
    calls.push(request);
    return ok(calls.length === 1
      ? { collection: [{ track: { id: 1 } }, {}], next_href: 'https://api/next?cursor=abc' }
      : { collection: [{ track: { id: 2 } }] });
  });
  const pager = new Pager('users/1/tracks', { limit: 2 }, item => item.track);
  assert.deepEqual(await pager.next(), [{ id: 1 }]);
  assert.equal(pager.done, false);
  assert.deepEqual(await pager.next(), [{ id: 2 }]);
  assert.equal(pager.done, true);
  assert.deepEqual(await pager.next(), []);
  assert.deepEqual(calls.map(({ method, resource, params }) => ({ method, resource, params })), [
    { method: 'GET', resource: 'users/1/tracks', params: { limit: 2, linked_partitioning: 1 } },
    { method: 'GET', resource: 'https://api/next?cursor=abc', params: undefined }
  ]);
});

test('Pager prevents duplicate loads and supports async afterLoad', async t => {
  let resolve;
  let calls = 0;
  t.mock.method(window.native, 'api', () => { calls++; return new Promise(done => { resolve = done; }); });
  const pager = new Pager('tracks');
  pager.afterLoad = async items => items.map(item => item.id);
  const pending = pager.next();
  assert.equal(pager.loading, true);
  assert.deepEqual(await pager.next(), []);
  resolve(ok({ collection: [{ id: 3 }] }));
  assert.deepEqual(await pending, [3]);
  assert.equal(pager.loading, false);
  assert.equal(calls, 1);
});

test('Pager releases loading state after an error so the same page can retry', async t => {
  let calls = 0;
  t.mock.method(window.native, 'api', async () => ++calls === 1 ? { ok: false, status: 503, data: 'retry' } : ok({}));
  const pager = new Pager('tracks');
  await assert.rejects(pager.next(), error => error instanceof ApiError && error.status === 503);
  assert.equal(pager.loading, false);
  assert.equal(pager.started, false);
  assert.deepEqual(await pager.next(), []);
  assert.equal(pager.done, true);
});

test('isPromoted detects flags and promoted feed types', () => {
  for (const item of [null, undefined, {}, { type: 'track' }, { type: 'track-repost', promoted: false }]) assert.equal(isPromoted(item), false);
  for (const item of [{ promoted: true }, { type: 'promoted-track' }, { type: 'playlist-promoted' }]) assert.equal(isPromoted(item), true);
});

test('idOf handles numeric ids, URNs and unrecognized strings', () => {
  assert.equal(idOf(123), 123);
  assert.equal(idOf('123'), 123);
  assert.equal(idOf('soundcloud:tracks:123'), 123);
  assert.equal(idOf('soundcloud:playlists:456'), 456);
  assert.equal(idOf('unknown'), 'unknown');
});

const transcoding = (url, protocol, mime_type, snipped = false) => ({ url, format: { protocol, mime_type }, snipped });
test('streamFor prefers progressive, then AAC/MP4, then other formats, excluding previews when full streams exist', async t => {
  for (const mime of ['audio/aac', 'audio/mp4']) {
    for (const failures of [0, 1, 2]) {
      const attempts = [];
      const fresh = {
        id: 77, title: 'Track', track_authorization: 'fresh-token',
        media: { transcodings: [
          transcoding('preview', 'progressive', 'audio/mpeg', true),
          transcoding('other', 'hls', 'audio/mpeg'),
          transcoding('aac', 'hls', mime),
          transcoding('progressive', 'progressive', 'audio/mpeg')
        ] }
      };
      t.mock.method(window.native, 'api', async ({ resource, params }) => {
        if (resource === 'tracks/77') return ok(fresh);
        attempts.push(resource);
        assert.deepEqual(params, { track_authorization: 'fresh-token' });
        return attempts.length <= failures ? { ok: false, status: 503 } : ok({ url: 'https://audio/' + resource });
      });
      const result = await streamFor({ id: 77 });
      assert.deepEqual(attempts, ['progressive', 'aac', 'other'].slice(0, failures + 1));
      assert.equal(result.url, 'https://audio/' + attempts.at(-1));
      assert.equal(result.protocol, failures ? 'hls' : 'progressive');
      assert.equal(result.snipped, false);
      assert.equal(result.track, fresh);
    }
  }
});

test('streamFor reports unavailable tracks and exhausted stream candidates', async t => {
  t.mock.method(window.native, 'api', async () => ok({ id: 78, media: { transcodings: [] } }));
  await assert.rejects(streamFor(78), error => error instanceof ApiError && error.status === 403);
  t.mock.method(window.native, 'api', async ({ resource }) => resource === 'tracks/78'
    ? ok({ id: 78, media: { transcodings: [transcoding('broken', 'hls', 'audio/aac')] } })
    : { ok: false, status: 502, data: 'broken' });
  await assert.rejects(streamFor(78), error => error.status === 502);
});

test('track cache evicts least recently used entries and refreshes reads and writes', async t => {
  const calls = [];
  t.mock.method(window.native, 'api', async ({ params }) => {
    calls.push(params.ids);
    return ok(params.ids.split(',').map(id => ({ id: Number(id), title: 'Fetched' })));
  });
  for (let id = 10000; id < 12000; id++) cacheTrack({ id, title: 'Cached' });
  await tracksByIds([10000]);
  cacheTrack({ id: 10001, title: 'Updated' });
  cacheTrack({ id: 12000, title: 'New' });
  const retained = await tracksByIds([10000, 10001]);
  assert.deepEqual(retained.map(track => track.title), ['Cached', 'Updated']);
  assert.deepEqual(calls, []);
  await tracksByIds([10002]);
  assert.deepEqual(calls, ['10002']);
});

test('hydrating more tracks than the cache limit preserves order, duplicates and all batches', async t => {
  const batches = [];
  t.mock.method(window.native, 'api', async ({ params }) => {
    const ids = params.ids.split(',').map(Number);
    batches.push(ids);
    return ok(ids.reverse().map(id => ({ id, title: 'Track ' + id })));
  });
  const ids = Array.from({ length: 2051 }, (_, i) => 20000 + i);
  ids.push(ids[0]);
  assert.deepEqual((await tracksByIds(ids)).map(track => track.id), ids);
  assert.equal(batches.length, 42);
  assert.ok(batches.every(batch => batch.length <= 50));
});
