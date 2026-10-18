// Shared UI components. Every view builds its pages from these.
import { h, clear, compact, duration, timeAgo, artwork, coverOf, onNearBottom } from './dom.js';
import { icon } from './icons.js';

// Lazy imports avoid circular-import timing issues (store/player import ui.js)
let _store, _player, _api;
const store = () => _store;
const player = () => _player;
export function bindServices(s, p, a) { _store = s; _player = p; _api = a; }

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

export const go = (hash) => { location.hash = hash; };
export const userHref = (user) => '#/user/' + user.id;
export const trackHref = (track) => '#/track/' + track.id;
export const playlistHref = (playlist) =>
  playlist.kind === 'system-playlist' ? '#/station/' + encodeURIComponent(playlist.urn) : '#/playlist/' + playlist.id;

export function link(href, text, cls = '') {
  return h('a.link' + (cls ? '.' + cls : ''), { href, onclick: (e) => e.stopPropagation() }, text);
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

export function toast(message, type = 'info') {
  let host = document.getElementById('toasts');
  if (!host) host = document.body.appendChild(h('div#toasts'));
  host.id = 'toasts';
  const el = h('div.toast.toast-' + type, message);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function iconButton(name, title, onclick, cls = '') {
  return h('button.icon-btn' + (cls ? '.' + cls : ''), { title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); onclick(e); } }, icon(name));
}

export function button(label, onclick, cls = '', iconName = null) {
  return h('button.btn' + (cls ? '.' + cls : ''), { onclick: (e) => { e.stopPropagation(); onclick(e); } }, iconName ? icon(iconName, 18) : null, label ? h('span', label) : null);
}

/** Heart that stays in sync with the store everywhere it appears */
export function likeButton(item, { withCount = false, cls = '' } = {}) {
  const btn = h('button.icon-btn.like-btn' + (cls ? '.' + cls : ''), { title: 'Like' });
  const render = () => {
    const liked = store().isLiked(item);
    clear(btn).append(icon(liked ? 'heartFilled' : 'heart'));
    if (withCount && item.likes_count != null) btn.append(h('span.count', compact(item.likes_count)));
    btn.classList.toggle('active', liked);
    btn.title = liked ? 'Unlike' : 'Like';
  };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const was = store().isLiked(item);
    if (item.likes_count != null) item.likes_count += was ? -1 : 1;
    render();
    await store().toggleLike(item);
  });
  watchStore(btn, render);
  render();
  return btn;
}

export function repostButton(item, { withCount = false } = {}) {
  const btn = h('button.icon-btn.repost-btn', { title: 'Repost' });
  const render = () => {
    const on = store().isReposted(item);
    clear(btn).append(icon('repost'));
    if (withCount && item.reposts_count != null) btn.append(h('span.count', compact(item.reposts_count)));
    btn.classList.toggle('active', on);
    btn.title = on ? 'Remove repost' : 'Repost';
  };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (item.user && item.user.id === store().me.id) return toast("You can't repost your own track");
    const was = store().isReposted(item);
    if (item.reposts_count != null) item.reposts_count += was ? -1 : 1;
    render();
    await store().toggleRepost(item);
  });
  watchStore(btn, render);
  render();
  return btn;
}

export function followButton(user) {
  const btn = h('button.btn.follow-btn');
  const render = () => {
    const on = store().isFollowing(user.id);
    btn.textContent = on ? 'Following' : 'Follow';
    btn.classList.toggle('btn-primary', !on);
    btn.classList.toggle('btn-outline', on);
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); store().toggleFollow(user); });
  btn.addEventListener('mouseenter', () => { if (store().isFollowing(user.id)) btn.textContent = 'Unfollow'; });
  btn.addEventListener('mouseleave', render);
  if (store().me && user.id === store().me.id) return h('span');
  watchStore(btn, render);
  render();
  return btn;
}

/** Re-render el when store sets change; stops once el leaves the DOM */
function watchStore(el, render) {
  const off = store().on('change', () => {
    if (!el.isConnected) return setTimeout(() => { if (!el.isConnected) off(); }, 0);
    render();
  });
}

/** Play/pause button bound to a list of tracks */
export function playButton(getTracks, index = 0, context = null, cls = 'play-btn') {
  const btn = h('button.' + cls, { title: 'Play' }, icon('play', 22));
  const isThis = () => {
    const tracks = getTracks();
    const p = player();
    return p.current && tracks[index] && p.current.id === tracks[index].id && (!context || !p.context || p.context.href === context.href);
  };
  const render = () => {
    const playing = isThis() && player().playing;
    clear(btn).append(icon(playing ? 'pause' : 'play', 22));
    btn.title = playing ? 'Pause' : 'Play';
  };
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const tracks = await Promise.resolve(getTracks());
    if (isThis()) player().toggle();
    else if (tracks.length) player().playList(tracks, index, context);
  });
  const offs = [player().on('state', render), player().on('track', render)];
  const tidy = () => { if (!btn.isConnected) offs.forEach(off => off()); };
  player().on('track', tidy);
  render();
  return btn;
}

// ---------------------------------------------------------------------------
// Waveform (canvas)
// ---------------------------------------------------------------------------

/**
 * Waveform for a track. When the track is playing it shows progress and is seekable;
 * clicking an idle waveform starts the track at that position.
 * onSeek(fraction) is called instead of playing when given.
 */
export function waveform(track, { height = 60, onPlay, comments = null } = {}) {
  const wrap = h('div.waveform', { style: { height: height + 'px' } });
  const canvas = h('canvas');
  const commentLayer = h('div.wave-comments');
  wrap.append(canvas, commentLayer);
  let samples = null;
  let hover = -1;

  const draw = () => {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(document.documentElement);
    const played = styles.getPropertyValue('--wave-played').trim();
    const unplayed = styles.getPropertyValue('--wave').trim();
    const p = player();
    const progress = p.current && p.current.id === track.id && p.duration ? p.audio.currentTime / p.duration : 0;

    const bar = 2, gap = 1, count = Math.floor(rect.width / (bar + gap));
    const data = samples || new Array(count).fill(0.15);
    const mid = height * 0.7;
    for (let i = 0; i < count; i++) {
      const sample = data[Math.floor((i / count) * data.length)] || 0;
      const x = i * (bar + gap);
      const fraction = i / count;
      ctx.fillStyle = fraction < progress ? played : (hover > -1 && fraction < hover ? played : unplayed);
      ctx.globalAlpha = fraction >= progress && hover > -1 && fraction < hover ? 0.6 : 1;
      const top = Math.max(1, sample * mid);
      ctx.fillRect(x, mid - top, bar, top);
      ctx.globalAlpha *= 0.35;
      ctx.fillRect(x, mid + 1, bar, Math.max(1, sample * (height - mid)));
      ctx.globalAlpha = 1;
    }
  };

  wrap.addEventListener('mousemove', (e) => {
    const r = wrap.getBoundingClientRect();
    hover = (e.clientX - r.left) / r.width;
    draw();
  });
  wrap.addEventListener('mouseleave', () => { hover = -1; draw(); });
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = wrap.getBoundingClientRect();
    const fraction = (e.clientX - r.left) / r.width;
    const p = player();
    if (p.current && p.current.id === track.id) {
      p.seek(fraction * p.duration);
    } else {
      const start = onPlay ? onPlay() : p.playTrack(track);
      Promise.resolve(start).then(() => {
        p.audio.addEventListener('loadedmetadata', () => p.seek(fraction * p.duration), { once: true });
      });
    }
  });

  const renderComments = (list) => {
    clear(commentLayer);
    if (!list || !track.duration) return;
    list.filter(c => c.timestamp != null).slice(0, 200).forEach((comment) => {
      const left = Math.min(99, (comment.timestamp / track.duration) * 100);
      commentLayer.append(h('img.wave-comment', {
        src: artwork(comment.user.avatar_url, 'badge') || '',
        style: { left: left + '%' },
        title: `${comment.user.username}: ${comment.body}`
      }));
    });
  };
  if (comments) renderComments(comments);
  wrap.setComments = renderComments;

  _api.waveform(track).then((data) => { samples = data; draw(); }).catch(() => {});
  const observer = new ResizeObserver(draw);
  observer.observe(wrap);
  const onTime = () => {
    if (!wrap.isConnected) { observer.disconnect(); offTime(); return; }
    if (player().current && player().current.id === track.id) draw();
  };
  const offTime = player().on('time', onTime);
  document.addEventListener('themechange', draw);
  return wrap;
}

// ---------------------------------------------------------------------------
// Track rows / lists
// ---------------------------------------------------------------------------

/**
 * A row in a track list. tracks + index give it a play queue.
 * opts: { context, showArt, showWave, number, extraActions: (track) => [elements] }
 */
export function trackRow(tracks, index, opts = {}) {
  const track = tracks[index];
  const p = player();
  const row = h('div.track-row', { dataset: { id: track.id } });
  const cover = h('div.track-art', { style: { backgroundImage: coverOf(track, 't300x300') ? `url("${coverOf(track, 't300x300')}")` : '' } },
    h('div.track-art-overlay', icon('play', 18)));

  const meta = h('div.track-meta',
    h('a.track-title', { href: trackHref(track), onclick: (e) => e.stopPropagation() }, track.title),
    h('div.track-sub',
      track.user ? link(userHref(track.user), track.user.username, 'muted') : null,
      opts.reason ? h('span.track-reason', opts.reason) : null
    )
  );

  const stats = h('div.track-stats',
    track.playback_count != null ? h('span.stat', { title: 'Plays' }, icon('play', 12), compact(track.playback_count)) : null,
    track.genre ? h('span.tag-pill', track.genre) : null
  );

  const actions = h('div.track-actions',
    likeButton(track),
    repostButton(track),
    iconButton('addToPlaylist', 'Add to playlist', () => addToPlaylistDialog(track)),
    iconButton('more', 'More', (e) => trackMenu(track, e, opts)),
    ...(opts.extraActions ? opts.extraActions(track) : [])
  );

  row.append(
    opts.number ? h('div.track-num', String(index + 1)) : null,
    cover,
    h('div.track-main', meta, opts.showWave ? waveform(track, { height: 44, onPlay: () => p.playList(tracks, index, opts.context) }) : null),
    stats,
    h('div.track-duration', duration(track.full_duration || track.duration)),
    actions
  );

  const play = () => p.toggleOrPlay(tracks, index, opts.context);
  row.addEventListener('dblclick', play);
  cover.addEventListener('click', (e) => { e.stopPropagation(); play(); });
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); trackMenu(track, e, opts); });

  const sync = () => {
    const isCurrent = p.current && p.current.id === track.id;
    row.classList.toggle('current', !!isCurrent);
    row.classList.toggle('playing', !!(isCurrent && p.playing));
    clear(cover.firstChild).append(icon(isCurrent && p.playing ? 'pause' : 'play', 18));
  };
  sync();
  const offs = [p.on('track', sync), p.on('state', sync)];
  const cleanup = () => { if (!row.isConnected) offs.forEach(off => off()); };
  p.on('queue', cleanup);
  return row;
}

/**
 * Infinite-scrolling track list fed by an api Pager.
 *   trackList(pager, { context, showWave, empty: 'No tracks' })
 * Returns the element; el.tracks holds loaded tracks.
 */
export function trackList(pager, opts = {}) {
  const list = h('div.track-list' + (opts.showWave ? '.with-wave' : ''));
  const tracks = [];
  list.tracks = tracks;
  const spinnerEl = spinner();
  list.append(spinnerEl);

  const loadMore = async () => {
    if (pager.done) return;
    try {
      const items = await pager.next();
      const start = tracks.length;
      tracks.push(...items.filter(t => t && t.kind === 'track'));
      for (let i = start; i < tracks.length; i++) list.insertBefore(trackRow(tracks, i, opts), spinnerEl);
      if (!tracks.length && pager.done) list.insertBefore(emptyState(opts.empty || 'Nothing here yet'), spinnerEl);
    } catch (error) {
      list.insertBefore(errorState(error), spinnerEl);
      pager.done = true;
    }
    if (pager.done) spinnerEl.remove();
  };

  list.loadMore = loadMore;
  loadMore().then(() => {
    const scroller = document.getElementById('view');
    const off = onNearBottom(scroller, loadMore);
    const stop = () => { if (!list.isConnected) { off(); window.removeEventListener('hashchange', stop); } };
    window.addEventListener('hashchange', stop);
  });
  return list;
}

/** Static list for an array of tracks */
export function staticTrackList(tracks, opts = {}) {
  const list = h('div.track-list' + (opts.showWave ? '.with-wave' : ''));
  list.tracks = tracks;
  if (!tracks.length) list.append(emptyState(opts.empty || 'No tracks'));
  tracks.forEach((t, i) => list.append(trackRow(tracks, i, opts)));
  return list;
}

// ---------------------------------------------------------------------------
// Feed-style track card (big waveform, used in Feed and profiles)
// ---------------------------------------------------------------------------

/** item: a track, or a stream item { type, track|playlist, user, created_at } */
export function feedItem(tracks, index, opts = {}) {
  const item = opts.items ? opts.items[index] : null;
  const track = tracks[index];
  const p = player();
  const header = item && item.type && item.type.endsWith('repost') && item.user
    ? h('div.feed-header', icon('repost', 14), link(userHref(item.user), item.user.username), ' reposted', h('span.muted', ' · ' + timeAgo(item.created_at)))
    : item && item.created_at ? h('div.feed-header', link(userHref(track.user), track.user.username), ' posted a track', h('span.muted', ' · ' + timeAgo(item.created_at))) : null;

  const cover = h('div.feed-art', { style: { backgroundImage: coverOf(track) ? `url("${coverOf(track)}")` : '' } });
  const playBtn = playButton(() => tracks, index, opts.context, 'play-btn.play-btn-lg');
  const card = h('article.feed-card',
    header,
    h('div.feed-body',
      cover,
      h('div.feed-content',
        h('div.feed-top',
          playBtn,
          h('div.feed-titles',
            track.user ? link(userHref(track.user), track.user.username, 'muted') : null,
            h('a.feed-title', { href: trackHref(track) }, track.title)
          ),
          h('div.feed-right',
            h('span.muted.small', timeAgo(track.display_date || track.created_at)),
            track.genre ? h('span.tag-pill', '#' + track.genre) : null
          )
        ),
        waveform(track, { height: 64, onPlay: () => p.playList(tracks, index, opts.context) }),
        h('div.feed-actions',
          likeButton(track, { withCount: true }),
          repostButton(track, { withCount: true }),
          iconButton('addToPlaylist', 'Add to playlist', () => addToPlaylistDialog(track)),
          iconButton('link', 'Copy link', () => { window.native.copy(track.permalink_url); toast('Link copied'); }),
          iconButton('more', 'More', (e) => trackMenu(track, e, opts)),
          h('div.spacer'),
          track.playback_count != null ? h('span.stat', icon('play', 12), compact(track.playback_count)) : null,
          track.comment_count != null ? h('a.stat', { href: trackHref(track) }, icon('comment', 12), compact(track.comment_count)) : null
        )
      )
    )
  );
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); trackMenu(track, e, opts); });
  return card;
}

// ---------------------------------------------------------------------------
// Cards (playlists, albums, users, stations) and shelves
// ---------------------------------------------------------------------------

export function playlistCard(playlist) {
  const href = playlistHref(playlist);
  const cover = coverOf(playlist) || (playlist.calculated_artwork_url && artwork(playlist.calculated_artwork_url));
  const play = h('button.card-play', { title: 'Play' }, icon('play', 20));
  play.addEventListener('click', async (e) => {
    e.stopPropagation();
    const full = playlist.kind === 'system-playlist' ? await _api.stationTracks(playlist.urn) : await _api.playlist(playlist.id);
    player().playList(full.tracks, 0, { label: full.title, href });
  });
  const subtitle = playlist.kind === 'system-playlist'
    ? (playlist.short_description || playlist.description || 'Station')
    : [playlist.is_album ? (playlist.set_type || 'Album') : 'Playlist', playlist.user && playlist.user.username].filter(Boolean).join(' · ');
  return h('a.card', { href },
    h('div.card-art', { style: { backgroundImage: cover ? `url("${cover}")` : '' } }, cover ? null : icon('playlist', 40), play),
    h('div.card-title', playlist.short_title || playlist.title),
    h('div.card-sub', subtitle)
  );
}

export function trackCard(tracks, index, context) {
  const track = tracks[index];
  const cover = coverOf(track);
  const play = h('button.card-play', { title: 'Play' }, icon('play', 20));
  play.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); player().toggleOrPlay(tracks, index, context); });
  const card = h('a.card', { href: trackHref(track) },
    h('div.card-art', { style: { backgroundImage: cover ? `url("${cover}")` : '' } }, play),
    h('div.card-title', track.title),
    h('div.card-sub', track.user ? track.user.username : '')
  );
  card.addEventListener('contextmenu', (e) => { e.preventDefault(); trackMenu(track, e, {}); });
  return card;
}

export function userCard(user) {
  return h('a.card.user-card', { href: userHref(user) },
    h('div.card-art.round', { style: { backgroundImage: user.avatar_url ? `url("${artwork(user.avatar_url, 't300x300')}")` : '' } }),
    h('div.card-title', user.username, user.verified ? icon('verified', 14) : null),
    h('div.card-sub', compact(user.followers_count) + ' followers'),
    followButton(user)
  );
}

/** Pick the right card for any api item */
export function cardFor(item, siblings, index, context) {
  if (!item) return null;
  if (item.kind === 'user') return userCard(item);
  if (item.kind === 'track') return trackCard(siblings, index, context);
  if (item.kind === 'playlist' || item.kind === 'system-playlist') return playlistCard(item);
  return null;
}

/** Horizontal scrolling row of cards with a title */
export function shelf(title, items, { href, subtitle, context } = {}) {
  const tracks = items.filter(i => i && i.kind === 'track');
  const row = h('div.shelf-row');
  items.forEach((item) => {
    const card = item.kind === 'track' ? trackCard(tracks, tracks.indexOf(item), context) : cardFor(item);
    if (card) row.append(card);
  });
  const scroll = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: 'smooth' });
  return h('section.shelf',
    h('div.shelf-head',
      h('div', h('h2.shelf-title', href ? h('a', { href }, title) : title), subtitle ? h('div.muted.small', subtitle) : null),
      h('div.shelf-nav', iconButton('back', 'Scroll left', () => scroll(-1)), iconButton('forward', 'Scroll right', () => scroll(1)))
    ),
    row
  );
}

/** Grid of cards fed by a Pager (infinite scroll) */
export function cardGrid(pager, { empty = 'Nothing here yet', context } = {}) {
  const grid = h('div.card-grid');
  const wrap = h('div', grid);
  const items = [];
  const spinnerEl = spinner();
  wrap.append(spinnerEl);
  const loadMore = async () => {
    if (pager.done) return;
    try {
      const batch = await pager.next();
      items.push(...batch);
      const tracks = items.filter(i => i.kind === 'track');
      batch.forEach((item) => {
        const card = item.kind === 'track' ? trackCard(tracks, tracks.indexOf(item), context) : cardFor(item);
        if (card) grid.append(card);
      });
      if (!items.length && pager.done) wrap.insertBefore(emptyState(empty), spinnerEl);
    } catch (error) {
      wrap.insertBefore(errorState(error), spinnerEl);
      pager.done = true;
    }
    if (pager.done) spinnerEl.remove();
  };
  loadMore().then(() => {
    const off = onNearBottom(document.getElementById('view'), loadMore);
    const stop = () => { if (!wrap.isConnected) { off(); window.removeEventListener('hashchange', stop); } };
    window.addEventListener('hashchange', stop);
  });
  return wrap;
}

/** Infinite list of users (followers, likers...) as rows */
export function userList(pager, { empty = 'No one here yet' } = {}) {
  const list = h('div.user-list');
  const spinnerEl = spinner();
  list.append(spinnerEl);
  let count = 0;
  const loadMore = async () => {
    if (pager.done) return;
    try {
      const users = await pager.next();
      users.forEach((user) => {
        count++;
        list.insertBefore(h('a.user-row', { href: userHref(user) },
          avatar(user, 48),
          h('div.user-row-meta',
            h('div.user-row-name', user.username, user.verified ? icon('verified', 14) : null),
            h('div.muted.small', [user.city, user.country_code].filter(Boolean).join(', ') || ' '),
            h('div.muted.small', icon('users', 12), ' ', compact(user.followers_count), '  ', icon('feed', 12), ' ', compact(user.track_count))
          ),
          followButton(user)
        ), spinnerEl);
      });
      if (!count && pager.done) list.insertBefore(emptyState(empty), spinnerEl);
    } catch (error) {
      list.insertBefore(errorState(error), spinnerEl);
      pager.done = true;
    }
    if (pager.done) spinnerEl.remove();
  };
  loadMore().then(() => {
    const off = onNearBottom(document.getElementById('view'), loadMore);
    const stop = () => { if (!list.isConnected) { off(); window.removeEventListener('hashchange', stop); } };
    window.addEventListener('hashchange', stop);
  });
  return list;
}

export function avatar(user, size = 40) {
  const src = user && user.avatar_url ? artwork(user.avatar_url, size > 100 ? 't500x500' : 't67x67') : '';
  return h('div.avatar', { style: { width: size + 'px', height: size + 'px', backgroundImage: src ? `url("${src}")` : '' } });
}

// ---------------------------------------------------------------------------
// Page scaffolding
// ---------------------------------------------------------------------------

/** Standard page title block */
export function pageHeader(title, { subtitle, actions } = {}) {
  return h('header.page-header',
    h('div', h('h1.page-title', title), subtitle ? h('div.page-subtitle', subtitle) : null),
    actions ? h('div.page-actions', actions) : null
  );
}

/**
 * Tab bar. tabs: [{ id, label, href }] — the tab matching `active` is highlighted.
 * Uses hrefs so tabs are routable.
 */
export function tabs(list, active) {
  return h('nav.tabs', list.map(t => h('a.tab' + (t.id === active ? '.active' : ''), { href: t.href }, t.label)));
}

/** Big hero header for track / playlist / user pages, blurred artwork behind */
export function hero({ image, round = false, eyebrow, title, subtitle, meta, actions, banner }) {
  const bg = banner || image;
  return h('section.hero',
    h('div.hero-bg', { style: { backgroundImage: bg ? `url("${bg}")` : '' } }),
    h('div.hero-inner',
      h('div.hero-art' + (round ? '.round' : ''), { style: { backgroundImage: image ? `url("${image}")` : '' } }),
      h('div.hero-text',
        eyebrow ? h('div.hero-eyebrow', eyebrow) : null,
        h('h1.hero-title', title),
        subtitle ? h('div.hero-subtitle', subtitle) : null,
        meta ? h('div.hero-meta', meta) : null,
        actions ? h('div.hero-actions', actions) : null
      )
    )
  );
}

export function spinner() {
  return h('div.spinner-wrap', h('div.spinner'));
}

export function emptyState(text, iconName = 'cloud') {
  return h('div.empty', icon(iconName, 40), h('p', text));
}

export function errorState(error) {
  const status = error && error.status;
  const text = status === 401 ? 'Your SoundCloud login expired. Sign in again from Settings.'
    : status === 429 ? 'SoundCloud is rate limiting requests. Try again in a little while.'
    : status === 404 ? 'This page doesn\'t exist or is private.'
    : 'Something went wrong loading this.';
  return h('div.empty.error', icon('cloud', 40), h('p', text));
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

/** items: [{ label, icon, onclick, danger }] or 'separator' */
export function menu(items, event) {
  closeMenus();
  const el = h('div.menu', items.filter(Boolean).map(item => item === 'separator'
    ? h('div.menu-sep')
    : h('button.menu-item' + (item.danger ? '.danger' : ''), { onclick: () => { closeMenus(); item.onclick(); } },
        item.icon ? icon(item.icon, 16) : h('span.icon'), h('span', item.label))));
  document.body.appendChild(el);
  const x = event.clientX || (event.target.getBoundingClientRect().left);
  const y = event.clientY || (event.target.getBoundingClientRect().bottom);
  const rect = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  el.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
  setTimeout(() => {
    document.addEventListener('click', closeMenus, { once: true });
    document.addEventListener('contextmenu', closeMenus, { once: true });
  }, 0);
  return el;
}

export function closeMenus() {
  document.querySelectorAll('.menu').forEach(m => m.remove());
}

export function trackMenu(track, event, opts = {}) {
  const p = player();
  menu([
    { label: 'Play next', icon: 'next', onclick: () => p.playNext(track) },
    { label: 'Add to queue', icon: 'queue', onclick: () => p.addToQueue(track) },
    { label: 'Add to playlist', icon: 'addToPlaylist', onclick: () => addToPlaylistDialog(track) },
    track.station_urn ? { label: 'Start station', icon: 'station', onclick: () => go('#/station/' + encodeURIComponent(track.station_urn)) } : null,
    'separator',
    { label: store().isLiked(track) ? 'Unlike' : 'Like', icon: 'heart', onclick: () => store().toggleLike(track) },
    { label: store().isReposted(track) ? 'Remove repost' : 'Repost', icon: 'repost', onclick: () => store().toggleRepost(track) },
    'separator',
    { label: 'Go to track', icon: 'feed', onclick: () => go(trackHref(track)) },
    track.user ? { label: 'Go to artist', icon: 'user', onclick: () => go(userHref(track.user)) } : null,
    { label: 'Copy link', icon: 'link', onclick: () => { window.native.copy(track.permalink_url); toast('Link copied'); } },
    { label: 'Open on SoundCloud', icon: 'external', onclick: () => window.native.openExternal(track.permalink_url) },
    ...(opts.menuItems ? ['separator', ...opts.menuItems(track)] : [])
  ], event);
}

// ---------------------------------------------------------------------------
// Modal dialogs
// ---------------------------------------------------------------------------

export function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => {
    overlay.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const overlay = h('div.modal-overlay', { onclick: (e) => { if (e.target === overlay) close(); } },
    h('div.modal' + (wide ? '.wide' : ''),
      h('div.modal-head', h('h2', title), iconButton('close', 'Close', close)),
      h('div.modal-body', body)
    )
  );
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => overlay.classList.add('show'));
  overlay.close = close;
  return overlay;
}

export function confirmDialog(title, message, confirmLabel = 'Confirm', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const dialog = modal(title, h('div',
      h('p.muted', message),
      h('div.modal-actions',
        button('Cancel', () => dialog.close(), 'btn-ghost'),
        button(confirmLabel, () => { answered = true; resolve(true); dialog.close(); }, danger ? 'btn-danger' : 'btn-primary')
      )
    ), { onClose: () => { if (!answered) resolve(false); } });
  });
}

export function promptDialog(title, { label = '', value = '', placeholder = '', confirmLabel = 'Save' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = h('input.input', { value, placeholder });
    const submit = () => { answered = true; resolve(input.value.trim()); dialog.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const dialog = modal(title, h('div',
      label ? h('label.field-label', label) : null,
      input,
      h('div.modal-actions', button('Cancel', () => dialog.close(), 'btn-ghost'), button(confirmLabel, submit, 'btn-primary'))
    ), { onClose: () => { if (!answered) resolve(null); } });
    setTimeout(() => input.focus(), 50);
  });
}

/**
 * Add a track to one of your playlists, or create a new one.
 * Toggling a playlist that already has the track removes it.
 */
export async function addToPlaylistDialog(track) {
  if (!track) return;
  const listEl = h('div.atp-list', spinner());
  const filter = h('input.input', { placeholder: 'Find a playlist' });
  const titleInput = h('input.input', { placeholder: 'New playlist title' });
  const privateBox = h('input', { type: 'checkbox' });

  const createBtn = button('Create & add', async () => {
    const title = titleInput.value.trim();
    if (!title) return titleInput.focus();
    createBtn.disabled = true;
    try {
      await _api.createPlaylist(title, [track.id], privateBox.checked ? 'private' : 'public');
      store().playlistChanged();
      toast(`Created "${title}" and added the track`);
      dialog.close();
    } catch (e) {
      toast("Couldn't create the playlist", 'error');
      createBtn.disabled = false;
    }
  }, 'btn-primary');

  const dialog = modal('Add to playlist', h('div.atp',
    h('div.atp-track', h('div.atp-art', { style: { backgroundImage: coverOf(track, 't67x67') ? `url("${coverOf(track, 't67x67')}")` : '' } }),
      h('div', h('div.strong', track.title), h('div.muted.small', track.user ? track.user.username : ''))),
    filter,
    listEl,
    h('div.atp-create',
      h('div.field-label', 'Create a new playlist'),
      h('div.atp-create-row', titleInput, createBtn),
      h('label.checkbox', privateBox, ' Make it private')
    )
  ));

  let playlists;
  try {
    playlists = await store().getMyPlaylists();
  } catch (e) {
    clear(listEl).append(errorState(e));
    return;
  }

  const render = () => {
    const q = filter.value.trim().toLowerCase();
    clear(listEl);
    const shown = playlists.filter(pl => !q || pl.title.toLowerCase().includes(q));
    if (!shown.length) listEl.append(h('div.muted.small.atp-empty', playlists.length ? 'No playlists match' : 'You have no playlists yet. Create one below.'));
    shown.forEach((pl) => {
      const has = (pl.tracks || []).some(t => t.id === track.id);
      const row = h('button.atp-row' + (has ? '.added' : ''),
        h('div.atp-art', { style: { backgroundImage: coverOf(pl, 't67x67') ? `url("${coverOf(pl, 't67x67')}")` : '' } }, coverOf(pl) ? null : icon('playlist', 18)),
        h('div.atp-row-meta', h('div.strong', pl.title), h('div.muted.small', `${pl.track_count} tracks${pl.sharing === 'private' ? ' · Private' : ''}`)),
        h('span.atp-state', icon(has ? 'check' : 'plus', 18))
      );
      row.addEventListener('click', async () => {
        row.disabled = true;
        try {
          const full = await _api.get('playlists/' + pl.id);
          const ids = (full.tracks || []).map(t => t.id);
          const already = ids.includes(track.id);
          const next = already ? ids.filter(id => id !== track.id) : ids.concat(track.id);
          const updated = await _api.setPlaylistTracks(pl.id, next);
          pl.tracks = next.map(id => ({ id }));
          pl.track_count = updated && updated.track_count != null ? updated.track_count : next.length;
          toast(already ? `Removed from "${pl.title}"` : `Added to "${pl.title}"`);
          store().emit('playlists');
        } catch (e) {
          toast("Couldn't update the playlist", 'error');
        }
        row.disabled = false;
        render();
      });
      listEl.append(row);
    });
  };
  filter.addEventListener('input', render);
  render();
  setTimeout(() => filter.focus(), 50);
}
