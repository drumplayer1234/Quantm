import test from 'node:test';
import assert from 'node:assert/strict';
import { installBrowser } from './helpers/browser.js';

installBrowser();
const { route, navigate } = await import('../src/js/router.js');
const view = document.createElement('div');
view.id = 'view';
document.body.append(view);
const renders = [];
let cleanups = 0;
const loader = name => async () => ({
  render(container, params, query) {
    renders.push({ name, params, query });
    container.append(name);
    return () => cleanups++;
  }
});
route('/home', loader('home'));
route('/user/:id/:tab?', loader('user'));
route('/track/:id', loader('track'));

test('route matching handles default, required and optional params, encoding and query strings', async () => {
  const cases = [
    ['', 'home', {}, {}],
    ['#/user/123', 'user', { id: '123', tab: undefined }, {}],
    ['#/user/123/', 'user', { id: '123', tab: undefined }, {}],
    ['#/user/a%20b/likes?sort=newest&q=hello+world', 'user', { id: 'a b', tab: 'likes' }, { sort: 'newest', q: 'hello world' }],
    ['#/user/123/playlists/', 'user', { id: '123', tab: 'playlists' }, {}],
    ['#/track/42', 'track', { id: '42' }, {}]
  ];
  for (const [hash, name, params, query] of cases) {
    location.hash = hash;
    await navigate();
    assert.deepEqual(renders.at(-1), { name, params, query });
    assert.equal(view.firstChild.className, 'page');
  }
  assert.equal(cleanups, cases.length - 1);
});

test('routes reject missing required params, extra segments and partial matches', async () => {
  const count = renders.length;
  for (const hash of ['#/user', '#/user/', '#/user/123/likes/extra', '#/track/', '#/prefix/track/42', '#/unknown']) {
    location.hash = hash;
    await navigate();
    assert.equal(location.hash, '#/home');
    assert.equal(renders.length, count);
  }
});

test('a late route loader cannot overwrite a newer navigation', async () => {
  let resolve;
  route('/slow', () => new Promise(done => { resolve = done; }));
  location.hash = '#/slow';
  const slow = navigate();
  location.hash = '#/home';
  await navigate();
  resolve({ render() { assert.fail('Stale route rendered'); } });
  await slow;
  assert.equal(view.firstChild.firstChild.textContent, 'home');
});
