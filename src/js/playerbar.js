// Bottom player bar + queue panel
import { h, clear, duration, coverOf } from './dom.js';
import { icon } from './icons.js';
import { player } from './player.js';
import { createVisualizer } from './visualizer.js';
import { store, settings, saveSettings } from './store.js';
import { getSleepTimer, formatRemaining } from './sleep.js';
import { iconButton, likeButton, addToPlaylistDialog, trackMenu, link, userHref, trackHref, emptyState, menu, transitionDialog, toast } from './ui.js';
import { getCues, cueEvents, transitionFor } from './cues.js';
import { formatCueTime } from './cue-time.js';

export function mountPlayerBar(root, { offline = false } = {}) {
  const art = h('a.pb-art', { href: '#' });
  const title = h('a.pb-title', { href: '#' });
  const artist = h('div.pb-artist');
  const likeSlot = h('div.pb-like');

  const playBtn = h('button.pb-play', { title: 'Play (Space)', onclick: () => player.toggle() }, icon('play', 22));
  const shuffleBtn = iconButton('shuffle', 'Shuffle', () => player.toggleShuffle(), 'pb-mode');
  const repeatBtn = iconButton('repeat', 'Repeat', () => player.cycleRepeat(), 'pb-mode');

  const current = h('span.pb-time', '0:00');
  const total = h('span.pb-time', '0:00');
  const fill = h('div.pb-fill');
  const buffer = h('div.pb-buffer');
  const knob = h('div.pb-knob');
  const hoverTime = h('div.pb-hovertime');
  const ticks = h('div.pb-cue-ticks');
  const progress = h('div.pb-progress', h('div.pb-track', buffer, fill, ticks, knob), hoverTime);
  const renderTicks = () => {
    clear(ticks);
    const track = player.current;
    const seconds = player.duration || track?.duration / 1000;
    if (!track || !seconds) return;
    const data = getCues(track.id);
    const tick = (t, kind) => {
      if (t != null && t <= seconds) ticks.append(h('span.pb-cue-tick.' + kind, { style: { left: t / seconds * 100 + '%' } }));
    };
    data.cues.forEach(cue => tick(cue.t, 'cue'));
    tick(data.mixIn, 'mix-in');
    tick(data.mixOut, 'mix-out');
  };
  player.on('track', renderTicks);
  player.audio.addEventListener('loadedmetadata', renderTicks);
  cueEvents.on('change', id => { if (String(id) === String(player.current?.id)) renderTicks(); });
  renderTicks();

  const addBtn = iconButton('addToPlaylist', 'Add to playlist', () => addToPlaylistDialog(player.current), 'pb-add');
  const moreBtn = iconButton('more', 'More', (e) => player.current && trackMenu(player.current, e));
  addBtn.hidden = moreBtn.hidden = offline;
  const queueBtn = iconButton('queue', 'Queue', () => toggleQueue(), 'pb-queue-btn');
  const speedBtn = h('button.pb-speed', { title: 'Playback speed', 'aria-label': 'Playback speed', onclick: (e) => { e.stopPropagation(); speedMenu(e); } });
  const eqBtn = h('button.pb-speed.pb-eq', { title: 'Equalizer', 'aria-label': 'Equalizer', onclick: (e) => {
    e.stopPropagation();
    menu([
      { label: settings.eq.enabled ? 'Turn equalizer off' : 'Turn equalizer on', icon: 'equalizer', onclick: () => {
        saveSettings({ eq: { ...settings.eq, enabled: !settings.eq.enabled } });
        location.hash = '#/settings/playback?card=equalizer';
      } },
      { label: 'Equalizer settings', icon: 'settings', onclick: () => { location.hash = '#/settings/playback?card=equalizer'; } }
    ], e);
  } }, 'EQ');
  const syncEq = () => { eqBtn.classList.toggle('active', settings.eq.enabled); eqBtn.setAttribute('aria-pressed', String(settings.eq.enabled)); };
  store.on('settings', syncEq);
  syncEq();
  const sleep = getSleepTimer(player, toast);
  const sleepLabel = h('span.pb-sleep-label');
  const sleepBtn = h('button.icon-btn.pb-sleep', { title: 'Sleep timer', 'aria-label': 'Sleep timer', onclick: (e) => {
    e.stopPropagation();
    menu([
      ...[15, 30, 45, 60, 90].map(minutes => ({ label: `${minutes} minutes`, onclick: () => sleep.start(minutes) })),
      player.current ? { label: 'End of this track', onclick: () => sleep.startEndOfTrack() } : null,
      'separator',
      { label: 'Cancel timer', onclick: () => sleep.cancel() }
    ], e);
  } }, icon('moon', 18), sleepLabel);
  const syncSleep = () => {
    sleepBtn.classList.toggle('active', !!sleep.mode);
    sleepLabel.textContent = sleep.mode === 'time' ? formatRemaining(sleep.remaining) : sleep.mode === 'track' ? '•' : '';
    sleepBtn.title = sleep.mode === 'track' ? 'Sleep timer: end of this track' : sleep.mode ? `Sleep timer: ${formatRemaining(sleep.remaining)} remaining` : 'Sleep timer';
    sleepBtn.setAttribute('aria-label', sleepBtn.title);
  };
  sleep.on('change', syncSleep);
  syncSleep();
  const volIcon = iconButton('volume', 'Mute (M)', () => player.toggleMute());
  const volFill = h('div.pb-fill');
  const volume = h('div.pb-volume', h('div.pb-track', volFill));

  const visualizer = createVisualizer();
  const pbText = h('div.pb-text', title, artist);
  const pbLeft = h('div.pb-left', art, pbText, likeSlot, addBtn);
  const pbCenter = h('div.pb-center',
      h('div.pb-controls',
        shuffleBtn,
        iconButton('prev', 'Previous (Ctrl+←)', () => player.prev(), 'pb-skip'),
        playBtn,
        iconButton('next', 'Next (Ctrl+→)', () => player.next(), 'pb-skip'),
        repeatBtn
      ),
      h('div.pb-progress-row', current, progress, total)
  );
  const pbRight = h('div.pb-right', moreBtn, speedBtn, eqBtn, sleepBtn, queueBtn, volIcon, volume);
  const bar = h('footer.playerbar.idle', pbLeft, pbCenter, pbRight);
  root.append(bar);

  // the visualizer can live on the left, in the center beside the controls, or on the right
  const placeVisualizer = () => {
    const spot = settings.visualizerPosition;
    if (spot === 'left') { if (visualizer.parentElement !== pbLeft) pbLeft.insertBefore(visualizer, likeSlot); }
    else if (spot === 'center') { if (visualizer.parentElement !== pbCenter) pbCenter.append(visualizer); }
    else if (visualizer.parentElement !== pbRight) pbRight.insertBefore(visualizer, moreBtn);
  };
  placeVisualizer();
  store.on('settings', placeVisualizer);

  // --- progress / seeking -----------------------------------------------------
  let dragging = false;
  const fractionAt = (e, el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const setProgress = (fraction) => {
    fill.style.width = fraction * 100 + '%';
    knob.style.left = fraction * 100 + '%';
  };
  progress.addEventListener('mousedown', (e) => {
    if (!player.current) return;
    dragging = true;
    progress.classList.add('dragging');
    const move = (ev) => {
      const f = fractionAt(ev, progress);
      setProgress(f);
      current.textContent = duration(f * player.duration * 1000);
    };
    const up = (ev) => {
      dragging = false;
      progress.classList.remove('dragging');
      player.seek(fractionAt(ev, progress) * player.duration);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    move(e);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  progress.addEventListener('mousemove', (e) => {
    const f = fractionAt(e, progress);
    hoverTime.textContent = duration(f * player.duration * 1000);
    hoverTime.style.left = f * 100 + '%';
  });

  player.on('time', (time, dur) => {
    if (dragging) return;
    current.textContent = duration(time * 1000);
    total.textContent = duration(dur * 1000);
    setProgress(dur ? time / dur : 0);
    const a = player.audio;
    if (a.buffered.length && dur) buffer.style.width = (a.buffered.end(a.buffered.length - 1) / dur) * 100 + '%';
  });

  // --- playback speed -----------------------------------------------------------
  const renderSpeed = () => {
    speedBtn.textContent = player.speedLabel;
    speedBtn.classList.toggle('active', settings.speedMode !== undefined && settings.speedMode !== 'normal');
    speedBtn.title = `Playback speed: ${+player.rate.toFixed(2)}×`;
  };
  const speedMenu = (e) => {
    const mode = settings.speedMode || 'normal';
    const rate = player.rate;
    const custom = (value) => ({ label: `${value}×`, icon: mode === 'custom' && rate === value ? 'check' : null, onclick: () => player.setSpeed(value) });
    menu([
      { label: 'Normal', icon: mode === 'normal' ? 'check' : null, onclick: () => player.setSpeedMode('normal') },
      { label: 'Nightcore', icon: mode === 'nightcore' ? 'check' : null, onclick: () => player.setSpeedMode('nightcore') },
      { label: 'Slowed', icon: mode === 'slowed' ? 'check' : null, onclick: () => player.setSpeedMode('slowed') },
      'separator',
      custom(0.75), custom(1.25), custom(1.5)
    ], e);
  };
  player.on('speed', renderSpeed);
  renderSpeed();

  // --- volume -------------------------------------------------------------------
  const renderVolume = () => {
    const v = player.muted ? 0 : player.volume;
    volFill.style.width = v * 100 + '%';
    clear(volIcon).append(icon(v === 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume'));
  };
  volume.addEventListener('mousedown', (e) => {
    const move = (ev) => player.setVolume(fractionAt(ev, volume));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    move(e);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  volume.addEventListener('wheel', (e) => { e.preventDefault(); player.setVolume(player.volume - Math.sign(e.deltaY) * 0.05); }, { passive: false });
  player.on('volume', renderVolume);
  renderVolume();

  // --- track / state ------------------------------------------------------------
  player.on('track', (track) => {
    bar.classList.remove('idle');
    const cover = coverOf(track, 't300x300');
    art.style.backgroundImage = cover ? `url("${cover}")` : '';
    art.href = trackHref(track);
    title.textContent = track.title;
    title.href = trackHref(track);
    title.title = track.title;
    clear(artist).append(track.user ? link(userHref(track.user), track.user.username) : '');
    clear(likeSlot);
    if (!offline) likeSlot.append(likeButton(track));
    total.textContent = duration(track.duration);
    document.title = `${track.title} · ${track.user ? track.user.username : ''} — Quantm`;
  });
  const renderState = () => {
    clear(playBtn).append(icon(player.playing ? 'pause' : 'play', 22));
    playBtn.title = player.playing ? 'Pause (Space)' : 'Play (Space)';
  };
  player.on('state', renderState);
  player.on('buffering', (on) => bar.classList.toggle('buffering', on));
  const renderModes = () => {
    shuffleBtn.classList.toggle('active', player.shuffle);
    repeatBtn.classList.toggle('active', player.repeat !== 'off');
    clear(repeatBtn).append(icon(player.repeat === 'one' ? 'repeatOne' : 'repeat'));
    repeatBtn.title = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: one' }[player.repeat];
  };
  player.on('modes', renderModes);
  renderModes();

  // --- queue panel --------------------------------------------------------------
  const panel = h('aside.queue-panel');
  root.append(panel);

  function toggleQueue(force) {
    const open = force !== undefined ? force : !panel.classList.contains('open');
    panel.classList.toggle('open', open);
    queueBtn.classList.toggle('active', open);
    if (open) renderQueue();
  }

  function renderQueue() {
    if (!panel.classList.contains('open')) return;
    clear(panel);
    panel.append(h('div.queue-head',
      h('h2', 'Queue'),
      h('div.queue-head-actions',
        h('button.btn.btn-ghost.btn-sm', { onclick: () => player.clearQueue() }, 'Clear'),
        iconButton('close', 'Close', () => toggleQueue(false))
      )
    ));
    if (!player.queue.length) {
      panel.append(emptyState('Your queue is empty. Play something!', 'queue'));
      return;
    }
    if (player.context) panel.append(h('div.queue-context.muted.small', 'Playing from ', h('a', { href: player.context.href }, player.context.label)));

    const list = h('div.queue-list');
    player.queue.forEach((track, i) => {
      if (i < player.index - 3) return; // keep a little history visible
      const row = h('div.queue-row' + (i === player.index ? '.current' : '') + (i < player.index ? '.past' : ''),
        { draggable: true, dataset: { index: i } },
        h('div.queue-art', { style: { backgroundImage: coverOf(track, 't67x67') ? `url("${coverOf(track, 't67x67')}")` : '' } }),
        h('div.queue-meta', h('div.queue-title', track.title), h('div.muted.small', track.user ? track.user.username : '')),
        h('span.muted.small', duration(track.duration)),
        i !== player.index ? iconButton('close', 'Remove', () => player.removeFromQueue(i), 'queue-remove') : null
      );
      row.addEventListener('dblclick', () => player.jump(i));
      row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        if (!isNaN(from) && from !== i) player.moveInQueue(from, i);
      });
      if (i === player.index) list.append(h('div.queue-label', 'Now playing'));
      if (i === player.index + 1) list.append(h('div.queue-label', 'Next up'));
      list.append(row);
      const next = player.queue[i + 1];
      if (next) {
        const transition = transitionFor(track.id, next.id, player.crossfadeSeconds());
        const label = transition.custom
          ? `↘ ${transition.out == null ? 'end' : formatCueTime(transition.out)} → ${formatCueTime(transition.in)} · ${transition.fade}s`
          : 'Transition';
        list.append(h('button.queue-transition' + (transition.custom ? '.custom' : ''), {
          title: `Edit transition: ${track.title} → ${next.title}`,
          onclick: () => transitionDialog(track, next)
        }, label));
      }
    });
    panel.append(list);
    const currentRow = list.querySelector('.current');
    if (currentRow) currentRow.scrollIntoView({ block: 'nearest' });
  }

  player.on('queue', renderQueue);
  player.on('track', renderQueue);
  cueEvents.on('change', renderQueue);
  store.on('settings', renderQueue);

  return { toggleQueue };
}
