// Feed: new posts and reposts from people you follow (soundcloud.com/feed)
// Reference view: other views follow the same structure.
import * as api from '../api.js';
import { h, onNearBottom, coverOf, timeAgo } from '../dom.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { player } from '../player.js';
import {
  pageHeader, feedItem, spinner, emptyState, errorState, link, userHref, playlistHref,
  likeButton, repostButton, playButton, staticTrackList, button, avatar
} from '../ui.js';

const context = { label: 'Feed', href: '#/feed' };

export async function render(page) {
  const pager = api.stream();
  const feed = h('div.feed');
  const spin = spinner();
  const tracks = [];   // every track in the feed, in order: the play queue
  const items = [];    // stream items matching `tracks` (for "x reposted" headers)

  const main = h('div', feed, spin);
  const sidebar = h('aside.sidebar', sidebarHistory(), sidebarLikes());
  page.append(
    pageHeader('Feed', { subtitle: 'Hear the latest posts from the people you\'re following' }),
    h('div.with-sidebar', main, sidebar)
  );

  const loadMore = async () => {
    if (pager.done) return;
    try {
      const batch = await pager.next();
      for (const item of batch) {
        if (item.track) {
          tracks.push(item.track);
          items.push(item);
          feed.append(feedItem(tracks, tracks.length - 1, { items, context }));
        } else if (item.playlist) {
          feed.append(playlistFeedCard(item));
        }
      }
      if (!feed.children.length && pager.done) feed.append(emptyState('Follow some artists to fill your feed.'));
    } catch (error) {
      feed.append(errorState(error));
      pager.done = true;
    }
    if (pager.done) spin.remove();
  };

  await loadMore();
  // a short first page might not fill the screen
  if (!pager.done && feed.children.length < 6) await loadMore();
  return onNearBottom(document.getElementById('view'), loadMore);
}

/** A playlist or album posted/reposted into the feed */
function playlistFeedCard(item) {
  const playlist = item.playlist;
  const href = playlistHref(playlist);
  const reposted = item.type && item.type.endsWith('repost');
  let full = null;
  const getTracks = async () => {
    if (!full) full = await api.playlist(playlist.id);
    return full.tracks;
  };
  const tracksSlot = h('div.feed-playlist-tracks');

  const card = h('article.feed-card',
    h('div.feed-header',
      reposted ? icon('repost', 14) : null,
      link(userHref(item.user), item.user.username),
      reposted ? ' reposted a ' : ' posted a ',
      playlist.is_album ? 'album' : 'playlist',
      h('span.muted', ' · ' + timeAgo(item.created_at))
    ),
    h('div.feed-body',
      h('a.feed-art', { href, style: { backgroundImage: coverOf(playlist) ? `url("${coverOf(playlist)}")` : '' } }),
      h('div.feed-content',
        h('div.feed-top',
          playButton(() => full ? full.tracks : getTracks(), 0, { label: playlist.title, href }, 'play-btn.play-btn-lg'),
          h('div.feed-titles',
            link(userHref(playlist.user), playlist.user.username, 'muted'),
            h('a.feed-title', { href }, playlist.title)
          ),
          h('div.feed-right', h('span.tag-pill', `${playlist.track_count} tracks`))
        ),
        tracksSlot,
        h('div.feed-actions',
          likeButton(playlist, { withCount: true }),
          repostButton(playlist, { withCount: true }),
          h('div.spacer'),
          button('View all', () => { location.hash = href; }, 'btn-ghost.btn-sm')
        )
      )
    )
  );

  // show the first few tracks once loaded
  getTracks().then((list) => {
    tracksSlot.append(staticTrackList(list.slice(0, 5), { context: { label: playlist.title, href } }));
  }).catch(() => {});
  return card;
}

function sidebarHistory() {
  const box = h('section', h('div.sidebar-title', h('span', 'Listening history'), h('a', { href: '#/library/history' }, 'View all')));
  const list = h('div');
  box.append(list);
  api.myPlayHistory().next().then((tracks) => {
    tracks.slice(0, 4).forEach((track, i) => list.append(miniTrack(tracks, i, { label: 'Listening history', href: '#/library/history' })));
    if (!tracks.length) list.append(h('div.muted.small', 'Nothing played yet'));
  }).catch(() => {});
  return box;
}

function sidebarLikes() {
  const box = h('section', h('div.sidebar-title', h('span', 'Likes'), h('a', { href: '#/library/likes' }, 'View all')));
  const list = h('div');
  box.append(list);
  api.myTrackLikes(store.me.id).next().then((tracks) => {
    tracks.slice(0, 4).forEach((track, i) => list.append(miniTrack(tracks, i, { label: 'Likes', href: '#/library/likes' })));
    if (!tracks.length) list.append(h('div.muted.small', 'No likes yet'));
  }).catch(() => {});
  return box;
}

/** Compact track line for sidebars */
export function miniTrack(tracks, index, context) {
  const track = tracks[index];
  const row = h('div.mini-user', { style: { cursor: 'pointer' } },
    h('div.track-art', { style: { width: '44px', height: '44px', backgroundImage: coverOf(track, 't67x67') ? `url("${coverOf(track, 't67x67')}")` : '' } }),
    h('div', { style: { minWidth: 0, flex: 1 } },
      h('div.muted.small', track.user ? track.user.username : ''),
      h('a.mini-user-name', { href: '#/track/' + track.id, style: { display: 'block' } }, track.title)
    )
  );
  row.addEventListener('click', () => player.toggleOrPlay(tracks, index, context));
  return row;
}
