import { h, clear, duration } from '../dom.js';
import { icon } from '../icons.js';
import { motionAllowed } from '../audio-reactivity.js';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const artist = track => track?.user?.username || track?.publisher_metadata?.artist || 'Unknown artist';

function border() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sm-pad-border');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(svg.namespaceURI, 'rect');
  Object.entries({ x: 2, y: 2, width: 96, height: 96, rx: 5, pathLength: 100 }).forEach(([key, value]) => rect.setAttribute(key, value));
  svg.append(rect);
  return { svg, rect };
}

function home(container, ctx) {
  const { player } = ctx;
  const title = h('h1.sm-title', 'Sampler');
  const now = h('p.sm-now');
  const mixLabel = h('p.sm-mix', { 'aria-live': 'off' });
  const tempo = h('span.sm-tempo', 'Waiting for a beat');
  const play = h('button.btn.btn-primary', { type: 'button', onclick: () => player.toggle() });
  const steps = Array.from({ length: 16 }, (_, index) => h('span.sm-step', { title: `Step ${index + 1}` }));
  const grid = h('div.sm-pads', { 'aria-label': 'Current track and next fifteen queue tracks' });
  const list = h('div.sm-queue-list');
  const count = h('span.sm-count');
  const browse = h('div.sm-browse', { hidden: true });
  let alive = true;
  let browseCleanup;
  let browseStarted = false;
  const browseButton = h('button.btn', { type: 'button', 'aria-expanded': 'false', onclick: async () => {
    browse.hidden = !browse.hidden;
    browseButton.setAttribute('aria-expanded', String(!browse.hidden));
    browseButton.textContent = browse.hidden ? 'Browse music' : 'Close Browse';
    if (browse.hidden || browseStarted) return;
    browseStarted = true;
    try {
      const module = await import('../views/home.js');
      if (!alive) return;
      const cleanup = await module.render(browse);
      if (!alive) { if (typeof cleanup === 'function') cleanup(); }
      else browseCleanup = cleanup;
    } catch (error) { if (alive) { browse.textContent = 'Browse could not load. Use Search or Library to choose music.'; browseStarted = false; } }
  } }, 'Browse music');
  const node = h('div.sm-home',
    h('header.sm-header', h('div', h('p.sm-kicker', 'QUEUE INSTRUMENT / 16 PADS'), title), browseButton),
    h('div.sm-layout', h('section.sm-chassis', { 'aria-label': 'Queue sampler' },
      h('div.sm-display', now, h('div.sm-controls', play, tempo)),
      h('div.sm-steps', { 'aria-hidden': 'true' }, steps), grid, mixLabel,
      h('p.sm-hint', 'Select a pad to jump to its track. Numbers follow your queue.')),
    h('aside.sm-queue', { 'aria-label': 'Full queue' }, h('h2', 'Full queue ', count), list)), browse);
  container.append(node);
  let pads = [];
  let rows = [];
  let windowKey = '';
  let lastPlay = '';
  let lastCurrent = -2;
  function paintPads(status) {
    const from = status.mix?.from;
    const outgoing = from ? player.queue.findIndex(track => track.id === from.id) : -1;
    const start = Math.max(0, outgoing >= 0 ? Math.min(player.index, outgoing) : player.index);
    const tracks = player.queue.slice(start, start + 16);
    const key = `${start}:${tracks.map(track => track.id).join(',')}`;
    if (windowKey === key) return;
    windowKey = key;
    const focused = grid.contains(document.activeElement) ? document.activeElement.dataset.index : null;
    clear(grid); pads = [];
    for (let slot = 0; slot < 16; slot++) {
      const track = tracks[slot];
      const index = start + slot;
      if (!track) {
        grid.append(h('div.sm-pad.sm-pad-empty', { 'aria-hidden': 'true' }, h('span', '--'), h('span', 'Unassigned')));
        pads.push(null); continue;
      }
      const line = border();
      const button = h('button.sm-pad', { type: 'button', dataset: { index, colour: slot % 4 },
        title: `${track.title || 'Untitled track'} · ${artist(track)}`,
        'aria-label': `Play queue track ${index + 1}: ${track.title || 'Untitled track'}, ${artist(track)}`,
        onclick: () => player.jump(index) },
      h('span.sm-pad-head', h('span', String(index + 1).padStart(2, '0')), h('span.sm-pad-led', { 'aria-hidden': 'true' })),
      h('strong.sm-pad-title', track.title || 'Untitled track'), h('span.sm-pad-artist', artist(track)),
      h('span.sm-pad-duration', duration(track.duration) || '--:--'), line.svg);
      pads.push({ button, rect: line.rect, track, index }); grid.append(button);
    }
    if (focused !== null) grid.querySelector(`[data-index="${Number(focused)}"]`)?.focus({ preventScroll: true });
  }
  function queue() {
    windowKey = ''; lastCurrent = -2;
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.index : null;
    clear(list); rows = [];
    count.textContent = String(player.queue.length);
    player.queue.forEach((track, index) => {
      const row = h('button.sm-queue-row', { type: 'button', dataset: { index }, onclick: () => player.jump(index) },
        h('span.sm-queue-number', String(index + 1).padStart(2, '0')),
        h('span.sm-queue-meta', h('strong', track.title || 'Untitled track'), h('span', artist(track))),
        h('span', duration(track.duration) || '--:--'));
      rows.push(row); list.append(row);
    });
    if (!rows.length) list.append(h('p.sm-empty', 'Browse music to fill your pads.'));
    if (focused !== null) rows[Number(focused)]?.focus({ preventScroll: true });
  }
  function update(status) {
    paintPads(status);
    now.textContent = player.current ? `${player.current.title} · ${artist(player.current)}` : 'Load a queue to begin';
    const label = player.playing ? 'Pause' : 'Play';
    if (label !== lastPlay) { clear(play).append(icon(player.playing ? 'pause' : 'play', 18), label); lastPlay = label; }
    play.disabled = !player.current;
    if (lastCurrent !== player.index) {
      rows[lastCurrent]?.removeAttribute('aria-current');
      rows[player.index]?.setAttribute('aria-current', 'true'); lastCurrent = player.index;
    }
    const mix = status.mix;
    const progress = clamp(mix?.progress);
    pads.forEach(pad => {
      if (!pad) return;
      const outgoing = !!mix && pad.track.id === mix.from?.id;
      const incoming = !!mix && pad.track.id === mix.to?.id;
      pad.button.classList.toggle('sm-outgoing', outgoing);
      pad.button.classList.toggle('sm-incoming', incoming);
      pad.button.classList.toggle('sm-current', pad.index === player.index);
      if (pad.index === player.index) pad.button.setAttribute('aria-current', 'true');
      else pad.button.removeAttribute('aria-current');
      pad.rect.setAttribute('stroke-dasharray', `${100 * (incoming ? progress : outgoing ? 1 - progress : 0)} 100`);
    });
    mixLabel.textContent = mix ? `Auto mix ${Math.round(progress * 100)}% · A ${Math.round((1 - progress) * 100)} / B ${Math.round(progress * 100)}` : 'Single deck · Waiting for the next mix';
  }
  function beat(step, bpm, phase) {
    steps.forEach((node, index) => node.classList.toggle('sm-lit', index === step));
    pads.forEach((pad, index) => pad?.button.classList.toggle('sm-step-lit', index === step));
    tempo.textContent = bpm > 0 ? `${Math.round(bpm)} BPM · Step ${String(step + 1).padStart(2, '0')}` : 'Waiting for a beat';
    node.style.setProperty('--sm-beat', String(clamp(1 - phase)));
  }
  queue();
  return { queue, update, beat,
    frame(frame) { node.style.setProperty('--sm-bass', String(frame.playing ? clamp(frame.bass) * 0.25 : 0)); },
    still() { node.style.setProperty('--sm-bass', '0'); beat(-1, 0, 1); },
    destroy() { if (!alive) return; alive = false; if (typeof browseCleanup === 'function') browseCleanup(); node.remove(); }
  };
}

export function mount(ctx) {
  const stages = new Set();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let step = -1;
  let lastBeat = -Infinity;
  let last = -Infinity;
  const motion = () => document.documentElement.dataset.themeMotion !== 'off' &&
    !(reduced.matches && document.documentElement.dataset.themeMotion !== 'on') && motionAllowed(ctx.settings, reduced);
  const sync = () => { const status = ctx.player.autoMixStatus(); stages.forEach(stage => stage.update(status)); };
  const still = () => { if (!motion() || !ctx.player.playing) stages.forEach(stage => stage.still()); };
  ctx.views.override('home', async () => ({ render(container) {
    const stage = home(container, ctx); stages.add(stage); sync(); still();
    return () => { stages.delete(stage); stage.destroy(); };
  } }));
  ctx.on(ctx.player, 'queue', () => { stages.forEach(stage => stage.queue()); sync(); });
  ctx.on(ctx.player, 'track', sync);
  ['state', 'time', 'transition'].forEach(event => ctx.on(ctx.player, event, () => { sync(); still(); }));
  ctx.on(ctx.store, 'settings', still);
  ctx.on(reduced, 'change', still);
  ctx.on(document, 'visibilitychange', still);
  ctx.on(document, 'appvisibility', still);
  // The shell owns beat timing. No guessed BPM or free-running animation clock.
  const observer = new MutationObserver(records => {
    if (!records.some(record => record.attributeName === 'data-beat')) return;
    if (!motion() || !ctx.player.playing) { still(); return; }
    const style = getComputedStyle(document.documentElement);
    const bpm = Number.parseFloat(style.getPropertyValue('--bpm')) || 0;
    const time = performance.now();
    if (bpm <= 0) { stages.forEach(stage => stage.still()); return; }
    step = (step + 1) % 16;
    // At very fast tempos, keep the beat count but limit visible changes to 3 Hz.
    if (time - lastBeat < 334) return;
    lastBeat = time;
    const phase = Number.parseFloat(style.getPropertyValue('--beat')) || 0;
    stages.forEach(stage => stage.beat(step, bpm, phase));
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-beat'] });
  ctx.frame(frame => {
    stages.forEach(stage => { if (motion()) stage.frame(frame); else stage.still(); });
    if (frame.time - last >= 100) { last = frame.time; sync(); }
  });
  return () => { observer.disconnect(); stages.forEach(stage => stage.destroy()); stages.clear(); };
}
