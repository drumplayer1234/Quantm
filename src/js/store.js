// App-wide state: the logged in user, what they like / repost / follow, and settings.
import * as api from './api.js';
import { Emitter } from './dom.js';
import { toast } from './ui.js';

class Store extends Emitter {
  constructor() {
    super();
    this.me = null;
    this.likedTracks = new Set();
    this.likedPlaylists = new Set();
    this.repostedTracks = new Set();
    this.repostedPlaylists = new Set();
    this.following = new Set();
    this.myPlaylists = null; // cached for the add-to-playlist dialog
  }

  async init() {
    this.me = await api.me();
    this.emit('me', this.me);
    // these can load in the background
    const load = (fn, key) => fn().then(ids => { this[key] = new Set(ids); this.emit('change', key); }).catch(() => {});
    load(api.likedTrackIds, 'likedTracks');
    load(api.likedPlaylistIds, 'likedPlaylists');
    load(api.repostedTrackIds, 'repostedTracks');
    load(api.repostedPlaylistIds, 'repostedPlaylists');
    load(() => api.followingIds(this.me.id), 'following');
  }

  isLiked(item) {
    return item.kind === 'playlist' || item.kind === 'system-playlist'
      ? this.likedPlaylists.has(item.id)
      : this.likedTracks.has(item.id);
  }

  isReposted(item) {
    return item.kind === 'playlist' ? this.repostedPlaylists.has(item.id) : this.repostedTracks.has(item.id);
  }

  isFollowing(userId) {
    return this.following.has(userId);
  }

  /** Optimistically flip a Set entry, call the API, roll back on failure */
  async toggle(setName, id, call, messages) {
    const set = this[setName];
    const on = !set.has(id);
    on ? set.add(id) : set.delete(id);
    this.emit('change', setName, id, on);
    try {
      await call(on);
      if (messages) toast(on ? messages[0] : messages[1]);
    } catch (error) {
      on ? set.delete(id) : set.add(id);
      this.emit('change', setName, id, !on);
      toast(error.status === 429 ? 'SoundCloud is rate limiting you. Try again later.' : 'That didn\'t work. Please try again.', 'error');
    }
    return set.has(id);
  }

  toggleLike(item) {
    if (item.kind === 'playlist') {
      return this.toggle('likedPlaylists', item.id, on => api.likePlaylist(this.me.id, item.id, on), ['Added to your liked playlists', 'Removed from your liked playlists']);
    }
    return this.toggle('likedTracks', item.id, on => api.likeTrack(this.me.id, item.id, on), ['Added to your Likes', 'Removed from your Likes']);
  }

  toggleRepost(item) {
    if (item.kind === 'playlist') {
      return this.toggle('repostedPlaylists', item.id, on => api.repostPlaylist(item.id, on), ['Reposted to your profile', 'Repost removed']);
    }
    return this.toggle('repostedTracks', item.id, on => api.repostTrack(item.id, on), ['Reposted to your profile', 'Repost removed']);
  }

  toggleFollow(user) {
    return this.toggle('following', user.id, on => api.follow(user.id, on), [`Following ${user.username}`, `Unfollowed ${user.username}`]);
  }

  /** The user's own playlists, cached */
  async getMyPlaylists(force = false) {
    if (!this.myPlaylists || force) {
      const pager = api.myPlaylists(this.me.id);
      let all = [];
      while (!pager.done) all = all.concat(await pager.next());
      this.myPlaylists = all.filter(p => p.user && p.user.id === this.me.id);
    }
    return this.myPlaylists;
  }

  playlistChanged() {
    this.myPlaylists = null;
    this.emit('playlists');
  }
}

export const store = new Store();

// ---------------------------------------------------------------------------
// Persistent settings (localStorage)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = 'quantm.settings';
const defaults = {
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off', // off | all | one
  notifications: true,
  autoplayRelated: true,
  normalize: true,
  visualizer: true,
  visualizerStyle: 'bars' // bars | mirror | wave
};

export const settings = Object.assign({}, defaults, safeParse(localStorage.getItem(SETTINGS_KEY)));

export function saveSettings(patch) {
  Object.assign(settings, patch);
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  store.emit('settings', settings);
}

export function safeParse(text) {
  try { return JSON.parse(text) || {}; } catch (e) { return {}; }
}
