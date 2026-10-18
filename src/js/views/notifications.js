// Notifications: likes, reposts, comments and new followers (soundcloud.com/notifications)
import * as api from '../api.js';
import { h, clear, onNearBottom, coverOf, timeAgo } from '../dom.js';
import { icon } from '../icons.js';
import {
  pageHeader, spinner, emptyState, errorState, link, userHref, trackHref, playlistHref, avatar, followButton
} from '../ui.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'like', label: 'Likes' },
  { id: 'repost', label: 'Reposts' },
  { id: 'comment', label: 'Comments' },
  { id: 'follow', label: 'Follows' }
];

const EMPTY = {
  all: 'No notifications yet',
  like: 'No likes to show',
  repost: 'No reposts to show',
  comment: 'No comments to show',
  follow: 'No new followers to show'
};

/** Map a raw activity type to one of the filter ids ('other' for anything unknown) */
function kindOf(item) {
  const type = String(item.type || '').toLowerCase();
  if (type.includes('follow') || type.includes('affiliation')) return 'follow';
  if (type.includes('repost')) return 'repost';
  if (type.includes('like')) return 'like';
  if (type.includes('comment')) return 'comment';
  return 'other';
}

export async function render(page) {
  const pager = api.activities();
  const items = [];
  let filter = 'all';

  const list = h('div.notif-list');
  const spin = spinner();
  const chips = h('div.chips.notif-chips');

  const renderChips = () => {
    clear(chips).append(...FILTERS.map(f => h('button.chip' + (f.id === filter ? '.active' : ''), {
      onclick: () => { filter = f.id; renderChips(); refresh(); }
    }, f.label)));
  };

  const matches = (item) => filter === 'all' || kindOf(item) === filter;
  const visible = () => items.filter(matches).length;

  /** Rebuild the list from loaded items, then pull more if the filter leaves it short */
  const refresh = () => {
    clear(list);
    items.filter(matches).forEach(item => list.append(row(item)));
    showEmpty();
    fill();
  };

  const showEmpty = () => {
    const existing = page.querySelector('.notif-empty');
    if (existing) existing.remove();
    if (!visible() && pager.done) list.after(h('div.notif-empty', emptyState(EMPTY[filter], 'bell')));
  };

  let failed = false;
  const loadMore = async () => {
    if (pager.done) return;
    try {
      const batch = await pager.next();
      items.push(...batch);
      batch.filter(matches).forEach(item => list.append(row(item)));
    } catch (error) {
      failed = true;
      list.append(errorState(error));
      pager.done = true;
    }
    if (pager.done) spin.remove();
    if (!failed) showEmpty();
  };

  // a filter can hide most of a page, so keep loading (a few pages at most) until there is something to see
  const fill = async () => {
    for (let i = 0; i < 4 && !pager.done && visible() < 8; i++) await loadMore();
  };

  page.append(
    pageHeader('Notifications', { subtitle: 'Likes, reposts, comments and new followers' }),
    chips,
    list,
    spin
  );
  renderChips();

  await loadMore();
  await fill();
  return onNearBottom(document.getElementById('view'), loadMore);
}

/** One notification row */
function row(item) {
  const kind = kindOf(item);
  const comment = item.comment || null;
  const user = item.user || (comment && comment.user) || null;
  const subject = item.track || item.playlist || (comment && comment.track) || null;
  const subjectHref = subject ? (subject.kind === 'track' || item.track ? trackHref(subject) : playlistHref(subject)) : null;
  const noun = item.track || (subject && subject.kind === 'track') ? 'track'
    : subject && subject.is_album ? 'album' : 'playlist';

  const who = user ? link(userHref(user), user.username, 'notif-user') : h('span.notif-user', 'Someone');
  const what = subject ? link(subjectHref, subject.title, 'notif-subject') : null;

  let text;
  let iconName = 'bell';
  if (kind === 'follow') {
    iconName = 'user';
    text = [who, ' started following you'];
  } else if (kind === 'like') {
    iconName = 'heartFilled';
    text = [who, ` liked your ${noun}`, what ? ' ' : null, what];
  } else if (kind === 'repost') {
    iconName = 'repost';
    text = [who, ` reposted your ${noun}`, what ? ' ' : null, what];
  } else if (kind === 'comment') {
    iconName = 'comment';
    text = [who, ' commented', what ? ' on ' : null, what, comment && comment.body ? ': ' : null,
      comment && comment.body ? h('span.notif-quote', '“' + comment.body + '”') : null];
  } else {
    // unknown type: still show who and when
    text = [who, ' sent you a notification', item.type ? h('span.muted', ` (${item.type})`) : null, what ? ': ' : null, what];
  }

  const when = item.created_at || (comment && comment.created_at);
  const art = subject && kind !== 'follow' ? coverOf(subject, 't200x200') : null;

  return h('div.notif-row.notif-' + kind,
    h('a.notif-avatar', { href: user ? userHref(user) : null }, avatar(user, 48), h('span.notif-badge', icon(iconName, 12))),
    h('div.notif-body',
      h('div.notif-text', text),
      when ? h('div.notif-time', timeAgo(when)) : null
    ),
    kind === 'follow' && user ? followButton(user) : null,
    subject && kind !== 'follow'
      ? h('a.notif-art', { href: subjectHref, title: subject.title, style: { backgroundImage: art ? `url("${art}")` : '' } }, art ? null : icon('playlist', 22))
      : null
  );
}
