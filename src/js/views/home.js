// Home: personalised discovery (soundcloud.com/discover)
// Greeting, recently played, SoundCloud's mixed selections and what's trending.
// Every section loads independently and appears as soon as its data arrives.
import * as api from '../api.js';
import { h } from '../dom.js';
import { store } from '../store.js';
import { shelf, spinner, emptyState, errorState } from '../ui.js';

const KINDS = new Set(['track', 'playlist', 'system-playlist', 'user']);

function greeting() {
  const hour = new Date().getHours();
  const part = hour < 5 ? 'evening' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${store.me ? store.me.username : 'there'}`;
}

/** Keep only items we know how to draw as a card; stations are treated like system playlists */
function usable(items) {
  const seen = new Set();
  const out = [];
  for (let item of items) {
    if (!item) continue;
    if (item.kind === 'station' && item.urn) item = Object.assign({}, item, { kind: 'system-playlist' });
    if (!KINDS.has(item.kind)) continue;
    const key = item.kind + ':' + (item.id || item.urn);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function render(page) {
  const slots = { recent: h('div'), mixed: h('div'), trending: h('div') };
  const mixedSpinner = spinner();
  slots.mixed.append(mixedSpinner);

  page.append(
    h('header.home-hero',
      h('h1.home-greeting', greeting()),
      h('div.home-sub', 'Pick up where you left off, or find something new.')
    ),
    slots.recent, slots.mixed, slots.trending
  );

  let shown = 0; // how many shelves made it onto the page
  const add = (slot, node) => { slot.append(node); shown++; };

  // Recently played: contexts (playlists, stations, artists), else individual tracks
  const recent = (async () => {
    let items = [];
    try {
      const contexts = await api.myRecentContexts().next();
      items = usable(contexts.map(c => c.playlist || c.system_playlist || c.station || c.user));
    } catch (e) { /* fall back to history below */ }
    if (items.length) {
      add(slots.recent, shelf('Recently played', items.slice(0, 20), { href: '#/library/history' }));
      return;
    }
    const tracks = (await api.myPlayHistory().next()).filter(t => t && t.kind === 'track').slice(0, 20);
    if (tracks.length) {
      add(slots.recent, shelf('Recently played', tracks, {
        href: '#/library/history', context: { label: 'Listening history', href: '#/library/history' }
      }));
    }
  })().catch(() => {});

  // One shelf per mixed selection (Made for you, Charts, Artist stations, ...)
  const mixed = (async () => {
    const data = await api.mixedSelections();
    for (const section of data.collection || []) {
      const items = usable((section.items && section.items.collection) || []);
      if (!items.length) continue;
      add(slots.mixed, shelf(section.title || 'Discover', items, {
        subtitle: section.description || null,
        context: { label: section.title || 'Discover', href: '#/home' }
      }));
    }
  })().catch((error) => slots.mixed.append(errorState(error)))
    .finally(() => mixedSpinner.remove());

  // Trending now: a taste of the charts
  const trending = (async () => {
    const tracks = (await api.trending().next()).slice(0, 12);
    if (tracks.length) {
      add(slots.trending, shelf('Trending now', tracks, {
        href: '#/trending', context: { label: 'Trending', href: '#/trending' }
      }));
      slots.trending.lastChild.querySelector('.shelf-nav').prepend(
        h('a.home-see-all', { href: '#/trending' }, 'See all')
      );
    }
  })().catch(() => {});

  // If nothing at all loaded, say so rather than leaving a blank page
  Promise.all([recent, mixed, trending]).then(() => {
    if (!shown && !slots.mixed.querySelector('.error')) page.append(emptyState('Nothing to show yet. Play some music and check back.'));
  });
}
