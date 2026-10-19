// Hash router. Each view module exports `render(container, params, query)`
// which may return a cleanup function.
import { clear } from './dom.js';
import { spinner, errorState } from './ui.js';

const routes = [];
const overrides = new Map();
let started = false;

export const routeName = path => path.split('?')[0].split('/').filter(Boolean)[0] || 'home';

export function setViewOverride(name, loaderOrNull) {
  const previous = overrides.get(name) || null;
  if (loaderOrNull) overrides.set(name, loaderOrNull);
  else overrides.delete(name);
  if (started && routeName(location.hash.replace(/^#/, '')) === name) navigate();
  return previous;
}

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
    const module = await (overrides.get(routeName(path)) || match.r.loader)();
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
    document.dispatchEvent(new CustomEvent('routerendered', { detail: { path, query, page } }));
  } catch (error) {
    console.error(error);
    if (id !== renderId) return;
    clear(view).append(errorState(error));
  }
}

export function startRouter() {
  started = true;
  window.addEventListener('hashchange', navigate);
  navigate();
}
