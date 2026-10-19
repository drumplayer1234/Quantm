import { h, Emitter } from './dom.js';
import { player } from './player.js';
import { store, settings } from './store.js';
import { packFor } from './theme-packs.js';
import { createAudioReactivity, effectsMode } from './audio-reactivity.js';
import { currentArtworkPalette } from './appearance.js';
import { setViewOverride } from './router.js';

export function createMoments(player, store) {
  const moments = new Emitter();
  let trackId = player.current?.id ?? null;
  let playing = player.playing;
  const off = [
    player.on('track', track => {
      const id = track?.id ?? null;
      if (id === trackId) return;
      trackId = id;
      moments.emit('trackchange', { track });
    }),
    player.on('state', () => {
      if (playing === player.playing) return;
      playing = player.playing;
      moments.emit('playstate', { playing });
    }),
    player.on('transition', event => moments.emit('transition', event)),
    store.on('change', (key, id, liked) => {
      if (key !== 'likedTracks' || typeof liked !== 'boolean') return;
      const track = player.current?.id === id ? player.current : player.queue.find(t => t.id === id);
      moments.emit('like', { track: track || { id }, liked });
    })
  ];
  return { moments, destroy: () => off.forEach(fn => fn()) };
}

let initialized = false;
export function initThemeRuntime() {
  if (initialized) return;
  initialized = true;
  const audio = createAudioReactivity(player, store, settings);
  const markMotion = () => { document.documentElement.dataset.themeMotion = effectsMode(settings.themeEffects); };
  markMotion();
  store.on('settings', markMotion);
  const { moments } = createMoments(player, store);
  let active = null;
  let dispose = null;
  let generation = 0;

  async function update() {
    const pack = packFor(document.documentElement.dataset.style);
    if (pack === active) return;
    const version = ++generation;
    active = pack;
    if (dispose) dispose();
    dispose = null;
    delete document.documentElement.dataset.layout;
    delete document.documentElement.dataset.baseStyle;
    if (!pack) return;
    // set before loading so the base makeover applies without a flash
    if (pack.base) document.documentElement.dataset.baseStyle = pack.base;
    const cleanups = [];
    let alive = true;
    const root = h('div.theme-layer', { 'aria-hidden': 'true' });
    function clean(fn) {
      if (typeof fn !== 'function') return;
      if (alive) cleanups.push(fn);
      else { try { fn(); } catch (error) { console.error('Theme cleanup failed', error); } }
    }
    const unmount = () => {
      if (!alive) return;
      alive = false;
      for (const fn of cleanups.reverse()) {
        try { fn(); } catch (error) { console.error('Theme cleanup failed', error); }
      }
      root.remove();
    };
    dispose = unmount;
    const fail = error => {
      console.error('Theme pack failed', error);
      if (version !== generation) return;
      ++generation;
      unmount();
      dispose = null;
      delete document.documentElement.dataset.layout;
      delete document.documentElement.dataset.baseStyle;
    };
    const guard = fn => (...args) => {
      if (!alive) return;
      try {
        const result = fn(...args);
        if (result?.then) result.catch(fail);
        return result;
      } catch (error) { fail(error); }
    };
    try {
      const module = pack.load ? await pack.load() : null;
      if (version !== generation) return;
      if (pack.layout) document.documentElement.dataset.layout = pack.layout;
      document.body.prepend(root);
      if (module) {
        clean(await module.mount({
          root, player, store, settings, moments,
          palette: currentArtworkPalette,
          on(target, event, fn) {
            if (!alive) return () => {};
            const handler = guard(fn);
            const off = target.on ? target.on(event, handler) : (() => {
              target.addEventListener(event, handler);
              return () => target.removeEventListener(event, handler);
            })();
            clean(off);
            return off;
          },
          frame(fn) {
            if (!alive) return () => {};
            const off = audio.subscribe(guard(fn));
            clean(off);
            return off;
          },
          views: { override(name, loader) {
            if (!alive) return;
            const previous = setViewOverride(name, async () => {
              try {
                const view = await loader();
                return { ...view, async render(...args) {
                  try { return await view.render(...args); }
                  catch (error) { fail(error); throw error; }
                } };
              } catch (error) { fail(error); throw error; }
            });
            clean(() => setViewOverride(name, previous));
          } }
        }));
      }
    } catch (error) { fail(error); }
  }
  document.addEventListener('themechange', update);
  update();
}
