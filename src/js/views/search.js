// Search results (soundcloud.com/search): Everything, Tracks, People, Albums, Playlists
import * as api from '../api.js';
import { h, coverOf, compact, artwork } from '../dom.js';
import { icon } from '../icons.js';
import {
  pageHeader, tabs, trackRow, trackList, userList, cardGrid, cardFor, spinner, emptyState, errorState,
  link, userHref, playlistHref, trackHref, playButton, followButton
} from '../ui.js';

const TABS = [
  { id: 'all', label: 'Everything', kind: '' },
  { id: 'tracks', label: 'Tracks', kind: 'tracks' },
  { id: 'people', label: 'People', kind: 'users' },
  { id: 'albums', label: 'Albums', kind: 'albums' },
  { id: 'playlists', label: 'Playlists', kind: 'playlists_without_albums' }
];

export async function render(page, params, query) {
  const q = (query.q || '').trim();
  const tab = TABS.find(t => t.id === query.tab || (query.tab === 'users' && t.id === 'people')) || TABS[0];
  const tabHref = (id) => `#/search?q=${encodeURIComponent(q)}${id === 'all' ? '' : '&tab=' + id}`;

  if (!q) {
    page.append(
      pageHeader('Search'),
      emptyState('Search for tracks, artists and playlists, or paste a SoundCloud link.', 'search')
    );
    return;
  }

  page.append(
    pageHeader(`Search results for “${q}”`),
    tabs(TABS.map(t => ({ id: t.id, label: t.label, href: tabHref(t.id) })), tab.id)
  );

  const context = { label: `Search “${q}”`, href: tabHref(tab.id === 'all' ? 'tracks' : tab.id) };

  if (tab.id === 'all') {
    const body = h('div', spinner());
    page.append(body);
    await renderEverything(body, q, tabHref);
  } else if (tab.id === 'tracks') {
    page.append(trackList(api.search(q, 'tracks'), { context, showWave: false, empty: `No tracks found for “${q}”` }));
  } else if (tab.id === 'people') {
    page.append(userList(api.search(q, 'users'), { empty: `No people found for “${q}”` }));
  } else {
    page.append(cardGrid(api.search(q, tab.kind), { empty: `No ${tab.label.toLowerCase()} found for “${q}”`, context }));
  }
}

// ---------------------------------------------------------------------------
// Everything tab
// ---------------------------------------------------------------------------

async function renderEverything(body, q, tabHref) {
  let items = [];
  try {
    const pager = api.search(q);
    items = await pager.next();
    // a thin first page: grab one more so the sections have something to show
    if (!pager.done && items.filter(i => i.kind === 'track').length < 5) items = items.concat(await pager.next());
  } catch (error) {
    body.replaceChildren(errorState(error));
    return;
  }

  const tracks = items.filter(i => i.kind === 'track');
  const users = items.filter(i => i.kind === 'user');
  const playlists = items.filter(i => i.kind === 'playlist' || i.kind === 'system-playlist');
  const context = { label: `Search “${q}”`, href: tabHref('tracks') };

  body.replaceChildren();
  if (!items.length) {
    body.append(emptyState(`No results for “${q}”. Check the spelling or try different keywords.`, 'search'));
    return;
  }

  // Top result next to the first few tracks
  const top = items.find(i => ['track', 'user', 'playlist'].includes(i.kind));
  const topTracks = tracks.slice(0, 4);
  if (top) {
    body.append(h('section.search-top',
      h('div',
        h('h2.search-heading', 'Top result'),
        topCard(top, context)
      ),
      topTracks.length ? h('div',
        h('h2.search-heading', 'Top tracks'),
        h('div.track-list', topTracks.map((t, i) => trackRow(tracks, i, { context })))
      ) : null
    ));
  }

  const rest = tracks.slice(4, 14);
  if (rest.length) {
    body.append(section('Tracks', tabHref('tracks'),
      h('div.track-list', rest.map((t, i) => trackRow(tracks, i + 4, { context })))));
  }

  if (users.length) {
    body.append(section('People', tabHref('people'), cardRow(users)));
  }

  if (playlists.length) {
    const onlyAlbums = playlists.every(p => p.is_album);
    body.append(section('Playlists & albums', tabHref(onlyAlbums ? 'albums' : 'playlists'), cardRow(playlists)));
  }
}

/** Titled section with a "See all" link */
function section(title, href, content) {
  return h('section.search-section',
    h('div.section-title', h('span', title), h('a.small', { href }, 'See all')),
    content
  );
}

/** Horizontal row of cards */
function cardRow(items) {
  return h('div.shelf-row', items.map(item => cardFor(item)).filter(Boolean));
}

/** Larger card for the best match: a track, a person or a playlist */
function topCard(item, context) {
  if (item.kind === 'user') {
    return h('div.search-topcard', { onclick: () => { location.hash = userHref(item); } },
      h('div.search-topart.round', { style: { backgroundImage: item.avatar_url ? `url("${artwork(item.avatar_url, 't500x500')}")` : '' } }),
      h('div.search-topinfo',
        h('div.search-toptitle', link(userHref(item), item.username), item.verified ? icon('verified', 18) : null),
        h('div.muted', 'Artist · ' + compact(item.followers_count) + ' followers'),
        h('div.search-topactions', followButton(item))
      )
    );
  }

  let full = null;
  const isPlaylist = item.kind !== 'track';
  const href = isPlaylist ? playlistHref(item) : trackHref(item);
  const getTracks = async () => {
    if (!isPlaylist) return [item];
    if (!full) full = await api.playlist(item.id);
    return full.tracks;
  };
  const cover = coverOf(item, 't500x500');
  const sub = isPlaylist
    ? [item.is_album ? 'Album' : 'Playlist', item.track_count != null ? item.track_count + ' tracks' : null].filter(Boolean).join(' · ')
    : 'Track' + (item.playback_count != null ? ' · ' + compact(item.playback_count) + ' plays' : '');

  const card = h('div.search-topcard', { onclick: () => { location.hash = href; } },
    h('div.search-topart', { style: { backgroundImage: cover ? `url("${cover}")` : '' } }, cover ? null : icon('playlist', 40)),
    h('div.search-topinfo',
      h('div.search-toptitle', link(href, item.title)),
      item.user ? h('div', link(userHref(item.user), item.user.username, 'muted')) : null,
      h('div.muted.small', sub),
      h('div.search-topactions',
        playButton(() => (isPlaylist ? (full ? full.tracks : getTracks()) : [item]), 0,
          isPlaylist ? { label: item.title, href } : context, 'play-btn.play-btn-lg')
      )
    )
  );
  return card;
}
