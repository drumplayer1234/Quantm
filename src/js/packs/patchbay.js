import { h, clear, duration } from '../dom.js';
import { icon } from '../icons.js';
import { motionAllowed } from '../audio-reactivity.js';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const artist = track => track?.user?.username || track?.publisher_metadata?.artist || 'Unknown artist';

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  node.append(...children);
  return node;
}

function signalDiagram() {
  const cable = (className, d) => svg('path', { class: `px-cable ${className}`, d });
  const socket = (cx, cy) => svg('circle', { class: 'px-socket', cx, cy, r: 10 });
  const text = (x, y, value) => { const node = svg('text', { x, y }); node.textContent = value; return node; };
  return svg('svg', { class: 'px-diagram', viewBox: '0 0 640 300', 'aria-hidden': 'true' },
    svg('rect', { class: 'px-module', x: 16, y: 18, width: 128, height: 80, rx: 4 }),
    svg('rect', { class: 'px-module', x: 16, y: 134, width: 128, height: 80, rx: 4 }),
    svg('rect', { class: 'px-module', x: 274, y: 76, width: 106, height: 102, rx: 4 }),
    svg('rect', { class: 'px-module', x: 500, y: 76, width: 124, height: 102, rx: 4 }),
    text(32, 44, 'CURRENT / A'), text(32, 160, 'INCOMING / B'), text(294, 102, 'MIX BUS'), text(518, 102, 'OUTPUT'),
    cable('px-a', 'M126 72 C202 72 208 116 290 116'),
    cable('px-b', 'M126 188 C202 188 208 146 290 146'),
    cable('px-a px-output-a', 'M364 116 C426 116 442 116 516 116'),
    cable('px-b px-output-b', 'M364 146 C426 146 442 146 516 146'),
    cable('px-low px-low-a', 'M126 86 C198 86 190 260 326 260 H454 Q546 260 546 166'),
    cable('px-low px-low-b', 'M126 202 C198 202 218 260 326 260 H454 Q546 260 546 166'),
    text(270, 290, 'LOW FREQUENCY'),
    ...[[126, 72], [126, 188], [290, 116], [290, 146], [364, 116], [364, 146], [516, 116], [516, 146], [546, 166]].map(([x, y]) => socket(x, y)));
}

function home(container, ctx) {
  const { player } = ctx;
  const current = h('h1.px-title');
  const by = h('p.px-artist');
  const incoming = h('p.px-incoming');
  const from = h('p.px-source');
  const mixText = h('p.px-mix-text', { 'aria-live': 'off' });
  const output = h('span.px-output-state');
  const play = h('button.btn.btn-primary', { type: 'button', onclick: () => player.toggle() });
  const prev = h('button.btn', { type: 'button', 'aria-label': 'Previous track', onclick: () => player.prev() }, icon('prev', 20));
  const next = h('button.btn', { type: 'button', 'aria-label': 'Next track', onclick: () => player.next() }, icon('next', 20));
  const queueList = h('div.px-queue-list');
  const browse = h('div.px-browse', { hidden: true });
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
  const node = h('div.px-home',
    h('header.px-header', h('div', h('p.px-kicker', 'PATCHBAY / LISTENING CONSOLE'), h('p', 'Follow the signal.')), browseButton),
    h('div.px-layout', h('section.px-rack', { 'aria-label': 'Listening console' },
      h('div.px-rack-head', h('span', 'SIGNAL FLOW'), output), h('div.px-flow', signalDiagram()),
      h('div.px-source-labels', h('div', h('h2', 'A / Current route'), from), h('div', h('h2', 'B / Incoming route'), incoming)), mixText),
    h('section.px-transport-panel', { 'aria-label': 'Current track' },
      h('p.px-kicker', 'TRANSPORT'), current, by, h('div.px-controls', prev, play, next),
      h('p.px-note', 'Sockets show the live routing. Playback controls are below.'))),
    h('section.px-queue', { 'aria-label': 'Queue' }, h('h2', 'Queued signals'), queueList), browse);
  container.append(node);
  let lastPlay = '';
  let lastCurrent = -2;
  let rows = [];
  function queue() {
    const focused = queueList.contains(document.activeElement) ? document.activeElement.dataset.index : null;
    clear(queueList); rows = []; lastCurrent = -2;
    player.queue.forEach((track, index) => {
      const row = h('button.px-queue-row', { type: 'button', dataset: { index }, onclick: () => player.jump(index) },
        h('span.px-track-number', String(index + 1).padStart(2, '0')),
        h('span.px-track-meta', h('strong', track.title || 'Untitled track'), h('span', artist(track))),
        h('span', duration(track.duration) || '--:--'));
      rows.push(row); queueList.append(row);
    });
    if (!rows.length) queueList.append(h('p.px-empty', 'No signal loaded. Browse music to start listening.'));
    if (focused !== null) rows[Number(focused)]?.focus({ preventScroll: true });
  }
  function update(status) {
    const track = player.current;
    const mix = status.mix;
    const progress = clamp(mix?.progress);
    current.textContent = track?.title || 'Ready for a signal';
    by.textContent = track ? artist(track) : 'Browse music to load the listening console.';
    from.textContent = mix?.from?.title || track?.title || 'No current track';
    incoming.textContent = mix?.to?.title || status.upNext?.track?.title || player.queue[player.index + 1]?.title || 'No incoming track';
    node.dataset.mixing = String(!!mix);
    node.dataset.swap = mix && progress >= 0.5 ? 'after' : 'before';
    node.style.setProperty('--px-out', String(mix ? 1 - progress * 0.7 : 1));
    node.style.setProperty('--px-in', String(mix ? 0.3 + progress * 0.7 : 0.18));
    mixText.textContent = mix ? `Two routes → output · Mix ${Math.round(progress * 100)}% · Low frequency: ${progress >= 0.5 ? 'B / incoming' : 'A / outgoing'}` : 'A → mix bus → output · Low frequency: A';
    output.textContent = player.playing ? 'OUTPUT ACTIVE' : 'OUTPUT IDLE';
    const label = player.playing ? 'Pause' : 'Play';
    if (label !== lastPlay) { clear(play).append(icon(player.playing ? 'pause' : 'play', 20), label); lastPlay = label; }
    [prev, play, next].forEach(button => { button.disabled = !track; });
    if (lastCurrent !== player.index) {
      rows[lastCurrent]?.removeAttribute('aria-current');
      rows[player.index]?.setAttribute('aria-current', 'true'); lastCurrent = player.index;
    }
  }
  queue();
  return { queue, update,
    frame(frame) { node.style.setProperty('--px-energy', String(frame.playing ? 0.58 + clamp(frame.level * 2 + frame.bass * 0.35) * 0.42 : 0.58)); },
    still() { node.style.setProperty('--px-energy', '0.75'); },
    destroy() { if (!alive) return; alive = false; if (typeof browseCleanup === 'function') browseCleanup(); node.remove(); }
  };
}

export function mount(ctx) {
  const stages = new Set();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motion = () => document.documentElement.dataset.themeMotion !== 'off' &&
    !(reduced.matches && document.documentElement.dataset.themeMotion !== 'on') && motionAllowed(ctx.settings, reduced);
  const sync = () => { const status = ctx.player.autoMixStatus(); stages.forEach(stage => stage.update(status)); };
  const still = () => { if (!motion()) stages.forEach(stage => stage.still()); };
  ctx.views.override('home', async () => ({ render(container) {
    const stage = home(container, ctx); stages.add(stage); sync(); still();
    return () => { stages.delete(stage); stage.destroy(); };
  } }));
  ctx.on(ctx.player, 'queue', () => { stages.forEach(stage => stage.queue()); sync(); });
  ctx.on(ctx.player, 'track', sync);
  ['state', 'time', 'transition'].forEach(event => ctx.on(ctx.player, event, sync));
  ctx.on(ctx.store, 'settings', still);
  ctx.on(reduced, 'change', still);
  ctx.on(document, 'visibilitychange', still);
  ctx.on(document, 'appvisibility', still);
  let last = -Infinity;
  ctx.frame(frame => {
    stages.forEach(stage => { if (motion()) stage.frame(frame); else stage.still(); });
    if (frame.time - last >= 100) { last = frame.time; sync(); }
  });
  return () => { stages.forEach(stage => stage.destroy()); stages.clear(); };
}
