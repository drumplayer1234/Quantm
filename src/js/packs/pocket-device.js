import { h, clear, artwork, duration } from '../dom.js';
import * as api from '../api.js';
import { icon } from '../icons.js';
import { button, likeButton, go, errorState } from '../ui.js';
import { motionAllowed } from '../audio-reactivity.js';
import { angleDelta, wheelSteps, moveSelection, feedItems } from './pocket-input.js';

export function renderDevice(container, ctx) {
  const { player, store, settings, moments } = ctx;
  let alive = true;
  let browseCleanup;
  let browseStarted = false;
  let artVersion = 0;
  let trackId;
  let drag = null;
  let suppressClick = false;
  let wheelRemainder = 0;
  const off = [];
  const history = [];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = () => motionAllowed(settings, reduced);
  const listen = (target, event, fn, options) => {
    if (target.on) off.push(target.on(event, fn));
    else {
      target.addEventListener(event, fn, options);
      off.push(() => target.removeEventListener(event, fn, options));
    }
  };
  function animate(node, frames, options = {}) {
    if (!motion()) return;
    node.getAnimations().forEach(animation => animation.cancel());
    node.animate(frames, { duration: 220, easing: 'ease-out', ...options });
  }
  container.classList.add('pocket-home');
  const statusIcon = h('span.pocket-status-icon', { 'aria-label': 'Paused' });
  const heading = h('span.pocket-heading', 'Pocket Quantm');
  const heart = h('span.pocket-heart', { title: 'Like status', 'aria-label': 'Not liked' }, '♡');
  const stamp = h('span.pocket-stamp', { 'aria-hidden': 'true' }, '♥');
  const list = h('div.pocket-list', { role: 'listbox', 'aria-label': 'Device menu', tabindex: '0' });
  const art = h('div.pocket-art');
  const title = h('div.pocket-track-title');
  const artist = h('div.pocket-artist');
  const position = h('div.pocket-position');
  const metadata = h('div.pocket-metadata', title, artist, position);
  const actions = h('div.pocket-track-actions');
  const elapsed = h('span', '0:00');
  const total = h('span', '0:00');
  const seek = h('input.pocket-seek', {
    type: 'range', min: '0', max: '1', step: '1', value: '0', 'aria-label': 'Seek in current track',
    oninput: () => player.seek(Number(seek.value)),
    onkeydown: event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      player.seekBy(['ArrowLeft', 'ArrowDown'].includes(event.key) ? -5 : 5);
      syncTime();
    }
  });
  const now = h('div.pocket-now', { hidden: true }, h('div.pocket-now-top', art, metadata),
    seek, h('div.pocket-times', elapsed, total), actions);
  const screen = h('section.pocket-screen', { 'aria-label': 'Music browser' },
    h('div.pocket-status', statusIcon, heading, heart), list, now, stamp);
  const live = h('span.pocket-sr', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  const tick = h('span.pocket-tick', { 'aria-hidden': 'true' });
  const control = (name, label, fn, content) => h(`button.pocket-wheel-${name}`, {
    type: 'button', title: label, 'aria-label': label, onclick: () => { if (!suppressClick) fn(); }
  }, content);
  const play = control('play', 'Play / pause (Space)', () => player.toggle(), icon('play', 21));
  const wheel = h('div.pocket-wheel', { 'aria-label': 'Click wheel: scroll or drag the ring to browse' }, tick,
    control('menu', 'Menu / back (Escape or Backspace)', back, 'MENU'),
    control('prev', 'Previous track (Left arrow)', () => player.prev(), icon('prev', 21)),
    control('next', 'Next track (Right arrow)', () => player.next(), icon('next', 21)), play,
    control('select', 'Select highlighted item (Enter)', select, h('span', 'SELECT')));
  const device = h('section.pocket-device', {
    tabindex: '0', 'aria-label': 'Pocket Quantm player. Up and Down browse, Enter selects, Escape goes back, Space plays, Left and Right skip.',
    'aria-describedby': 'pocket-help'
  }, h('div.pocket-case-top', h('span', 'QUANTM'), h('span', 'POCKET / 01')), screen, wheel,
  h('div.pocket-case-bottom', h('span', 'YOUR MUSIC, WITH YOU.'), h('span.pocket-grille', { 'aria-hidden': 'true' }, '•••••')), live);
  const browse = h('section.pocket-browse', { hidden: true, 'aria-label': 'Full Home shelves' });
  const desk = h('div.pocket-desk', device);
  const browseButton = button('Open full app', showBrowse, 'btn-outline');
  browseButton.setAttribute('aria-expanded', 'false');
  container.append(h('header.pocket-intro', h('div', h('p.pocket-eyebrow', 'LESS SCROLL. MORE SOUL.'), h('h1', 'A little music goes a long way.')), browseButton),
    desk, h('p#pocket-help.pocket-help', 'Scroll or turn the wheel · ↑ ↓ browse · Enter select · Esc back · Space play'), browse);

  let state = mainMenu();
  function mainMenu() {
    return { title: 'Pocket Quantm', index: 0, items: [
      { label: 'Now Playing', action: showNow },
      { label: 'Likes', action: () => openPager('Likes', api.myTrackLikes(store.me.id), 'tracks', '#/library/likes') },
      { label: 'Playlists', action: () => openPager('Playlists', api.myPlaylists(store.me.id), 'playlists', '#/library/playlists') },
      { label: 'Feed', action: () => openPager('Feed', api.stream(), 'feed', '#/feed') },
      { label: 'Shuffle Likes', action: shuffleLikes },
      { label: 'Settings', action: () => go('#/settings') }
    ] };
  }
  function push(next) { history.push(state); state = next; draw(); }
  function back() {
    state = history.pop() || mainMenu();
    draw();
  }
  function showNow() { push({ title: 'Now Playing', now: true, index: 0, items: [] }); }
  function select() {
    if (state.now) { player.toggle(); return; }
    state.items[state.index]?.action?.();
  }
  function step(delta) {
    if (state.now || !state.items.length) return;
    state.index = moveSelection(state.index, delta, state.items.length);
    highlight();
    animate(tick, [{ opacity: 0.15, transform: 'scale(.8)' }, { opacity: 0.8, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.05)' }]);
  }
  function highlight() {
    [...list.children].forEach((row, i) => {
      row.classList.toggle('selected', i === state.index);
      row.setAttribute('aria-selected', String(i === state.index));
    });
    const row = list.children[state.index];
    if (row) {
      list.setAttribute('aria-activedescendant', row.id);
      // The router renders off-document; repeat after attachment below.
      list.scrollTop = Math.max(0, row.offsetTop - list.offsetTop - (list.clientHeight - row.offsetHeight) / 2);
      live.textContent = row.textContent;
    } else list.removeAttribute('aria-activedescendant');
  }
  function draw() {
    heading.textContent = state.title;
    list.hidden = !!state.now;
    now.hidden = !state.now;
    clear(list);
    if (state.now) { syncTrack(); return; }
    list.setAttribute('aria-label', state.title);
    state.items.forEach((item, i) => list.append(h('div.pocket-row', {
      id: `pocket-row-${i}`, role: 'option', 'aria-selected': String(i === state.index),
      onclick: () => { state.index = i; highlight(); select(); }
    }, h('span', item.label), h('span.pocket-row-arrow', { 'aria-hidden': 'true' }, item.action ? '›' : ''))));
    highlight();
  }
  function entries(screenState, items) {
    screenState.data = items;
    const tracks = items.filter(item => item.kind !== 'playlist' && item.kind !== 'system-playlist');
    screenState.items = items.map(item => ({ label: item.title || 'Untitled', action: () => {
      if (item.kind === 'playlist' || item.kind === 'system-playlist') openPlaylist(item);
      else {
        player.playList(tracks, tracks.indexOf(item), { label: screenState.title, href: screenState.href });
        showNow();
      }
    } }));
  }
  function openPager(title, pager, kind, href) {
    const next = { title, pager, kind, href, index: 0, data: [], items: [] };
    push(next);
    loadPage(next);
  }
  async function loadPage(target) {
    if (target.loading) return;
    target.loading = true;
    entries(target, target.data);
    target.items.push({ label: 'Loading…' });
    draw();
    try {
      const batch = await target.pager.next();
      if (!alive || (state !== target && !history.includes(target))) return;
      const incoming = target.kind === 'feed' ? feedItems(batch) : batch;
      const seen = new Set(target.data.map(item => `${item.kind}:${item.id}`));
      entries(target, [...target.data, ...incoming.filter(item => !seen.has(`${item.kind}:${item.id}`))]);
      if (!target.items.length) target.items.push({ label: target.pager.done ? 'Nothing here yet' : 'No tracks on this page' });
      if (!target.pager.done) target.items.push({ label: 'Load more…', action: () => loadPage(target) });
    } catch (error) {
      if (!alive || (state !== target && !history.includes(target))) return;
      entries(target, target.data);
      target.items.push({ label: 'Could not load. Select to retry.', action: () => loadPage(target) });
    } finally {
      target.loading = false;
      if (alive && state === target) { target.index = moveSelection(target.index, 0, target.items.length); draw(); }
    }
  }
  function openPlaylist(item) {
    const target = { title: item.title || 'Playlist', index: 0, items: [] };
    push(target);
    const load = async () => {
      target.items = [{ label: 'Loading tracks…' }]; draw();
      try {
        const playlist = item.kind === 'system-playlist' ? await api.stationTracks(item.urn) : await api.playlist(item.id);
        if (!alive || state !== target) return;
        target.href = item.kind === 'system-playlist' ? '#/station/' + encodeURIComponent(item.urn) : '#/playlist/' + item.id;
        entries(target, playlist.tracks || []);
        if (!target.items.length) target.items.push({ label: 'This playlist is empty' });
      } catch (error) {
        if (!alive || state !== target) return;
        target.items = [{ label: 'Could not load. Select to retry.', action: load }];
      }
      if (alive && state === target) draw();
    };
    load();
  }
  function shuffleLikes() {
    const target = { title: 'Shuffle Likes', index: 0, items: [] };
    push(target);
    const load = async () => {
      target.items = [{ label: 'Finding your favorites…' }]; draw();
      try {
        const tracks = await api.myTrackLikes(store.me.id).next();
        if (!alive || state !== target) return;
        if (!tracks.length) { target.items = [{ label: 'Your Likes are empty' }]; draw(); return; }
        player.shufflePlay(tracks, { label: 'Likes', href: '#/library/likes' });
        state = { title: 'Now Playing', now: true, index: 0, items: [] }; draw();
      } catch (error) {
        if (!alive || state !== target) return;
        target.items = [{ label: 'Could not load. Select to retry.', action: load }]; draw();
      }
    };
    load();
  }
  function syncTime() {
    const length = Math.max(0, player.duration || 0);
    const seconds = Math.min(player.audio.currentTime || 0, length);
    seek.max = String(length || 1); seek.value = String(seconds); seek.disabled = !length;
    seek.setAttribute('aria-valuetext', `${duration(seconds * 1000)} of ${duration(length * 1000)}`);
    elapsed.textContent = duration(seconds * 1000); total.textContent = duration(length * 1000);
  }
  function syncState() {
    clear(statusIcon).append(icon(player.playing ? 'play' : 'pause', 13));
    statusIcon.setAttribute('aria-label', player.playing ? 'Playing' : 'Paused');
    clear(play).append(icon(player.playing ? 'pause' : 'play', 21));
    heart.textContent = player.current && store.isLiked(player.current) ? '♥' : '♡';
    heart.setAttribute('aria-label', player.current && store.isLiked(player.current) ? 'Liked' : 'Not liked');
    position.textContent = player.current ? `${player.index + 1} of ${player.queue.length}` : 'Select Likes to begin';
    syncTime();
  }
  function syncTrack() {
    const track = player.current;
    if (trackId !== (track?.id ?? null)) {
      trackId = track?.id ?? null;
      const version = ++artVersion;
      title.textContent = track?.title || 'Your next favorite awaits';
      artist.textContent = track?.user?.username || 'A whole library in your pocket.';
      clear(actions);
      if (track) actions.append(likeButton(track));
      const src = artwork(track?.artwork_url || track?.user?.avatar_url, 't200x200');
      const cover = src ? h('img', { src, alt: '', draggable: false }) : h('span.pocket-art-empty', '♫');
      const reveal = () => {
        if (!alive || version !== artVersion) return;
        const old = [...art.children];
        art.append(cover);
        if (old.length && motion()) {
          const fade = cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
          fade.onfinish = () => old.forEach(node => node.remove());
        } else old.forEach(node => node.remove());
      };
      if (src) {
        cover.addEventListener('load', reveal, { once: true });
        cover.addEventListener('error', () => {
          if (alive && version === artVersion) clear(art).append(h('span.pocket-art-empty', '♫'));
        }, { once: true });
      } else reveal();
      if (state.now) animate(metadata, [{ opacity: 0, transform: 'translateX(9px)' }, { opacity: 1, transform: 'translateX(0)' }]);
    }
    syncState();
  }
  async function showBrowse() {
    browse.hidden = !browse.hidden;
    desk.hidden = !browse.hidden;
    container.classList.toggle('pocket-browsing', !browse.hidden);
    browseButton.setAttribute('aria-expanded', String(!browse.hidden));
    browseButton.querySelector('span').textContent = browse.hidden ? 'Open full app' : 'Back to Pocket';
    if (browseStarted || browse.hidden) return;
    browseStarted = true;
    try {
      const home = await import('../views/home.js');
      if (!alive) return;
      const cleanup = await home.render(browse);
      if (!alive) { if (typeof cleanup === 'function') cleanup(); }
      else browseCleanup = cleanup;
    } catch (error) { if (alive) browse.append(errorState(error)); }
  }
  listen(device, 'keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.target === seek) return;
    const keys = {
      ArrowUp: () => step(-1), ArrowDown: () => step(1), Enter: select,
      Escape: back, Backspace: back, ' ': () => player.toggle(),
      ArrowLeft: () => player.prev(), ArrowRight: () => player.next()
    };
    // Enter on actual buttons keeps native button activation (Menu, Like, etc.).
    if (event.key === 'Enter' && event.target.closest('button')) return;
    if (!keys[event.key]) return;
    event.preventDefault(); event.stopPropagation(); keys[event.key]();
  });
  listen(wheel, 'wheel', event => {
    event.preventDefault();
    wheelRemainder += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
    const steps = Math.trunc(wheelRemainder / 36);
    if (steps) { wheelRemainder -= steps * 36; step(steps); }
  }, { passive: false });
  const pointerAngle = event => {
    const rect = wheel.getBoundingClientRect();
    return Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2);
  };
  listen(wheel, 'pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.pocket-wheel-select')) return;
    suppressClick = false;
    drag = { id: event.pointerId, angle: pointerAngle(event), remainder: 0, distance: 0 };
  });
  listen(wheel, 'pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const angle = pointerAngle(event);
    const delta = angleDelta(drag.angle, angle);
    drag.distance += Math.abs(delta);
    const result = wheelSteps(drag.remainder, delta);
    drag.angle = angle; drag.remainder = result.remainder;
    if (drag.distance > 0.12) {
      suppressClick = true;
      if (!wheel.hasPointerCapture(event.pointerId)) wheel.setPointerCapture(event.pointerId);
    }
    if (result.steps) step(result.steps);
  });
  const endDrag = () => { drag = null; };
  listen(wheel, 'pointerup', endDrag);
  listen(wheel, 'pointercancel', endDrag);
  listen(wheel, 'lostpointercapture', endDrag);
  // Capture ensures a completed drag never triggers the label beneath the pointer.
  listen(wheel, 'click', event => {
    if (suppressClick) { event.preventDefault(); event.stopPropagation(); suppressClick = false; }
  }, true);
  function syncMotion() {
    if (motion()) return;
    device.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    while (art.children.length > 1) art.firstChild.remove();
  }
  listen(player, 'time', syncTime);
  listen(player, 'queue', syncState);
  listen(player, 'state', syncState);
  listen(moments, 'trackchange', syncTrack);
  listen(moments, 'like', ({ track, liked }) => {
    if (track?.id !== player.current?.id) return;
    syncState();
    if (liked) animate(stamp, [{ opacity: 0, transform: 'translateY(4px) scale(.8)' }, { opacity: 1, offset: .3, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(-4px) scale(1)' }], { duration: 900 });
  });
  listen(store, 'settings', syncMotion);
  listen(document, 'visibilitychange', syncMotion);
  listen(document, 'appvisibility', syncMotion);
  listen(reduced, 'change', syncMotion);
  listen(document, 'routerendered', event => {
    highlight();
    if (event.detail?.page === container && document.activeElement === document.body) device.focus({ preventScroll: true });
  });
  draw(); syncTrack();
  return () => {
    if (!alive) return;
    alive = false; ++artVersion;
    off.forEach(fn => fn());
    device.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
    if (drag && wheel.hasPointerCapture(drag.id)) wheel.releasePointerCapture(drag.id);
    drag = null;
    if (typeof browseCleanup === 'function') browseCleanup();
    container.classList.remove('pocket-home', 'pocket-browsing');
    clear(container);
  };
}
