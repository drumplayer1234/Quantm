// Hash router. Each view module exports `render(container, params, query)`
// which may return a cleanup function.
import { clear } from './dom.js';
import { spinner, errorState } from './ui.js';

const routes = [];

/** route('/user/:id/:tab?', () => import('./views/user.js')) */
export function route(pattern, loader) {
  const keys = [];
  // one pass so keys stay in the same order as the capture groups
  const regex = new RegExp('^' + pattern.replace(/\/:(\w+)(\?)?/g, (m, key, optional) => {
    keys.push(key);
    return optional ? '(?:/([^/]+))?' : '/([^/]+)';
  }) + '/?$');
  routes.push({ regex, keys, loader });
}

let cleanup = null;
let renderId = 0;

export async function navigate() {
  const hash = location.hash.replace(/^#/, '') || '/home';
  const [path, queryString] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));
  const view = document.getElementById('view');
  const id = ++renderId;

  if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }

  const match = routes.map(r => ({ r, m: path.match(r.regex) })).find(x => x.m);
  clear(view).append(spinner());
  view.scrollTop = 0;
  document.dispatchEvent(new CustomEvent('routechange', { detail: { path, query } }));

  if (!match) {
    location.hash = '#/home';
    return;
  }

  const params = {};
  match.r.keys.forEach((key, i) => { params[key] = match.m[i + 1] ? decodeURIComponent(match.m[i + 1]) : undefined; });

  try {
    const module = await match.r.loader();
    if (id !== renderId) return;
    const page = document.createElement('div');
    page.className = 'page';
    const result = await module.render(page, params, query);
    if (id !== renderId) {
      if (typeof result === 'function') result();
      return;
    }
    clear(view).append(page);
    cleanup = typeof result === 'function' ? result : null;
  } catch (error) {
    console.error(error);
    if (id !== renderId) return;
    clear(view).append(errorState(error));
  }
}

export function startRouter() {
  window.addEventListener('hashchange', navigate);
  navigate();
}
