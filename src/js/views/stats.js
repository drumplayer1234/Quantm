// Listening stats: totals, a listening chart, top tracks / artists / genres and badges.
// All numbers come from this computer's own history (src/js/stats.js); nothing is uploaded.
import * as api from '../api.js';
import { h, clear, artwork } from '../dom.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { player } from '../player.js';
import { pageHeader, emptyState, button, modal, toast, link, userHref, trackHref } from '../ui.js';
import {
  RANGES, getStats, rangeTotals, series, topTracks, topArtists, topGenres, streaks, badgeList, formatListening, formatTime
} from '../stats.js';
import { renderCard, saveCard, copyCard } from '../stats-card.js';

const context = { label: 'Listening stats', href: '#/stats' };
const RANGE_NAME = { week: 'the last 7 days', month: 'the last 30 days', year: 'the last year', all: 'all time' };

export async function render(page) {
  let range = 'month';

  const rangeButtons = RANGES.map(r => h('button.stats-range-btn', { type: 'button', onclick: () => setRange(r.id) }, r.label));
  const rangeBar = h('div.stats-range', { role: 'group', 'aria-label': 'Time range' }, rangeButtons);
  const body = h('div.stats-body');

  page.append(
    pageHeader('Listening stats', {
      subtitle: 'Counted on this computer only. Nothing is sent anywhere.',
      actions: button('Share card', openCard, 'btn-primary', 'image')
    }),
    rangeBar,
    body
  );

  function setRange(id) {
    range = id;
    paint();
  }

  function paint() {
    rangeButtons.forEach((el, i) => el.classList.toggle('active', RANGES[i].id === range));
    const data = getStats();
    const totals = rangeTotals(data, range);
    const run = streaks(data);
    const time = formatListening(totals.seconds);
    const empty = totals.plays === 0 && totals.seconds === 0;

    clear(body).append(
      h('section.stats-numbers',
        tile(time.value, time.unit === 'min' ? 'minutes listened' : time.unit + ' listened'),
        tile(totals.plays.toLocaleString(), totals.plays === 1 ? 'play' : 'plays'),
        tile(String(run.current), 'day streak', 'flame'),
        tile(String(run.best), 'best streak', 'trophy')
      ),
      ...(empty
        ? [h('section.section', emptyState(`Nothing played in ${RANGE_NAME[range]} yet. Start listening and it will show up here.`, 'headphones'))]
        : [chartSection(data), topSection(data), h('div.stats-two', artistsSection(data), genresSection(data))]),
      badgesSection(data)
    );
  }

  function tile(value, label, iconName) {
    return h('div.stats-tile',
      h('div.stats-tile-value', iconName ? icon(iconName, 26) : null, h('span', value)),
      h('div.stats-tile-label', label)
    );
  }

  // --- chart ----------------------------------------------------------------

  function chartSection(data) {
    const bars = series(data, range);
    const max = Math.max(...bars.map(b => b.seconds), 1);
    const daily = range === 'week' || range === 'month';
    // 30 labels don't fit: show every fifth
    const showLabel = (i) => range !== 'month' || i % 5 === 0 || i === bars.length - 1;
    return h('section.section',
      h('h2.section-title', daily ? 'Listening per day' : 'Listening per month', h('span.stats-scale', `Tallest bar: ${formatTime(max)}`)),
      h('div.stats-chart' + (bars.length > 14 ? '.dense' : ''), { style: `grid-template-columns: repeat(${bars.length}, minmax(0, 1fr))` },
        bars.map((b, i) => h('div.stats-bar' + (b.seconds ? '' : '.zero'), { title: `${daily ? b.key : b.label + ' ' + b.key.slice(0, 4)}: ${formatTime(b.seconds)}, ${b.plays} ${b.plays === 1 ? 'play' : 'plays'}` },
          h('div.stats-bar-track', h('div.stats-bar-fill', { style: { height: Math.max(b.seconds / max * 100, b.seconds ? 3 : 0) + '%' } })),
          h('div.stats-bar-label', showLabel(i) ? b.label : '')
        ))
      )
    );
  }

  // --- top tracks -----------------------------------------------------------

  async function playFrom(list, index) {
    try {
      const tracks = await api.tracksByIds(list.map(t => Number(t.id)));
      const wanted = tracks.findIndex(t => String(t.id) === String(list[index].id));
      if (wanted < 0) return toast("That track isn't available anymore", 'error');
      player.toggleOrPlay(tracks, wanted, context);
    } catch (e) {
      toast("Couldn't load that track", 'error');
    }
  }

  function topSection(data) {
    const list = topTracks(data, range, 10);
    const rows = list.map((t, i) => {
      const art = artwork(t.artwork, 't300x300');
      const cover = h('div.track-art', { style: { backgroundImage: art ? `url("${art}")` : '' } }, h('div.track-art-overlay', icon('play', 18)));
      const row = h('div.stats-track',
        h('div.stats-rank', String(i + 1)),
        cover,
        h('div.stats-main',
          h('a.track-title', { href: trackHref(t), onclick: (e) => e.stopPropagation() }, t.title),
          h('div.track-sub', t.artistId ? link('#/user/' + t.artistId, t.artist, 'muted') : h('span.muted', t.artist))
        ),
        h('div.stats-count', h('strong', String(t.plays)), h('span.muted', t.plays === 1 ? ' play' : ' plays'))
      );
      row.addEventListener('click', () => playFrom(list, i));
      return row;
    });
    return h('section.section',
      h('h2.section-title', 'Top tracks',
        list.length ? button('Play all', () => playFrom(list, 0), 'btn-ghost.btn-sm', 'play') : null),
      rows.length ? h('div.stats-list', rows) : h('p.muted', 'No plays in this range yet.')
    );
  }

  // --- top artists and genres -------------------------------------------------

  function artistsSection(data) {
    const list = topArtists(data, range, 8);
    return h('section.section',
      h('h2.section-title', 'Top artists'),
      list.length ? h('div.stats-list', list.map((a, i) => {
        const src = artwork(a.avatar, 't67x67');
        const linked = /^\d+$/.test(a.id);
        return h('div.stats-artist',
          h('div.stats-rank', String(i + 1)),
          h('div.avatar', { style: { width: '40px', height: '40px', backgroundImage: src ? `url("${src}")` : '' } }),
          h('div.stats-main', linked ? link(userHref({ id: a.id }), a.name || 'Unknown artist') : h('span', a.name || 'Unknown artist')),
          h('div.stats-count', h('strong', String(a.plays)), h('span.muted', a.plays === 1 ? ' play' : ' plays'))
        );
      })) : h('p.muted', 'No plays in this range yet.')
    );
  }

  function genresSection(data) {
    const list = topGenres(data, range, 8);
    return h('section.section',
      h('h2.section-title', 'Top genres'),
      list.length ? h('div.stats-genres', list.map(g => h('div.stats-genre',
        h('div.stats-genre-head', h('span', g.name), h('span.muted', `${Math.round(g.share * 100)}%`)),
        h('div.stats-genre-track', h('div.stats-genre-fill', { style: { width: Math.max(g.share * 100, 2) + '%' } }))
      ))) : h('p.muted', 'Tracks without a genre tag are left out.')
    );
  }

  // --- badges ---------------------------------------------------------------

  function badgesSection(data) {
    const badges = badgeList(data);
    const earned = badges.filter(b => b.earned).length;
    return h('section.section',
      h('h2.section-title', 'Badges', h('span.stats-scale', `${earned} of ${badges.length} earned`)),
      h('div.stats-badges', badges.map(b => h('div.stats-badge' + (b.earned ? '.earned' : '.locked'), { title: b.description },
        h('div.stats-badge-icon', icon(b.earned ? b.icon : 'lock', 26)),
        h('div.stats-badge-name', b.name),
        h('div.stats-badge-desc', b.description),
        h('div.stats-badge-date', b.earned ? (b.date ? 'Earned ' + new Date(b.date).toLocaleDateString() : 'Earned') : 'Locked')
      )))
    );
  }

  // --- share card -----------------------------------------------------------

  async function openCard() {
    const preview = h('div.stats-card-preview', h('div.spinner-wrap', h('div.spinner')));
    let canvas = null;
    const save = button('Save image', async () => {
      try { await saveCard(canvas); } catch (e) { toast("Couldn't save the image", 'error'); }
    }, 'btn-primary', 'download');
    const copy = button('Copy image', async () => {
      try {
        await copyCard(canvas);
        toast('Image copied to the clipboard');
      } catch (e) {
        toast("Couldn't copy the image. Try Save image instead.", 'error');
      }
    }, 'btn-outline', 'copy');
    save.disabled = copy.disabled = true;

    modal('Share card', h('div.stats-card-dialog',
      preview,
      h('p.muted.small', 'This image is made on your computer. Nothing is uploaded, so share it wherever you like.'),
      h('div.stats-card-actions', save, copy)
    ), { wide: true });

    try {
      canvas = await renderCard(store.me);
      canvas.className = 'stats-card-canvas';
      clear(preview).append(canvas);
      save.disabled = copy.disabled = false;
    } catch (e) {
      console.error(e);
      clear(preview).append(emptyState("Couldn't draw the card"));
    }
  }

  paint();
}
