import { h } from '../dom.js';
import { motionAllowed } from '../audio-reactivity.js';

const COLS = 80;
const ROWS = 26;

function seedOf(track) {
  let seed = 2166136261;
  for (const char of String(track?.id ?? track?.urn ?? 'quiet-terrain')) {
    seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return seed;
}

/** Seeded height fields are computed once per track, never per audio frame. */
function landscape(seed) {
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const peaks = Array.from({ length: 4 }, () => ({
    x: random(), y: random(), width: 0.06 + random() * 0.15, height: 12 + random() * 26
  }));
  const field = new Float32Array((COLS + 1) * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col <= COLS; col++) {
      const x = col / COLS, y = row / (ROWS - 1);
      let height = 0;
      for (const peak of peaks) {
        height += peak.height * Math.exp(-((x - peak.x) ** 2 + (y - peak.y) ** 2 * 0.55) / peak.width);
      }
      field[row * (COLS + 1) + col] = height;
    }
  }
  return field;
}

export function mount(ctx) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fields = new Map();
  let panel = null;
  let canvas = null;
  let paint = null;
  let subtitle = null;
  let seedLabel = null;
  let last = -Infinity;
  let phase = 0;
  let signature = '';
  let ink = '#91cdb7';
  const visible = () => !document.hidden && !document.documentElement.hasAttribute('data-hidden');
  const motion = () => motionAllowed(ctx.settings, reduced) &&
    document.documentElement.dataset.themeMotion !== 'off' &&
    !(document.documentElement.dataset.themeMotion === 'auto' && reduced.matches);
  function field(track) {
    const seed = seedOf(track);
    if (!fields.has(seed)) {
      if (fields.size >= 3) fields.delete(fields.keys().next().value);
      fields.set(seed, landscape(seed));
    }
    return fields.get(seed);
  }
  function mixStatus() { return ctx.player.autoMixStatus?.().mix; }

  function label(mix = mixStatus()) {
    if (!subtitle) return;
    const from = mix?.from || ctx.player.current;
    const to = mix?.to;
    const key = `${seedOf(from)}:${to ? seedOf(to) : ''}:${from?.title}:${to?.title}`;
    if (key === signature) return;
    signature = key;
    subtitle.textContent = to ? `${from?.title || 'Outgoing track'} / ${to.title || 'Incoming track'}` :
      from?.title || 'Choose a track to discover its landscape';
    seedLabel.textContent = to ? `${seedOf(from).toString(16).padStart(8, '0')} > ${seedOf(to).toString(16).padStart(8, '0')}` :
      `TERRAIN ${seedOf(from).toString(16).padStart(8, '0')}`;
  }

  function draw(frame = {}, mix = mixStatus()) {
    if (!paint || !visible()) return;
    const from = field(mix?.from || ctx.player.current);
    const to = mix?.to ? field(mix.to) : from;
    const progress = Math.max(0, Math.min(1, mix?.progress || 0));
    const bass = frame.bass || 0, mid = frame.mid || 0, treble = frame.treble || 0;
    const w = canvas.width, height = canvas.height;
    paint.clearRect(0, 0, w, height);
    paint.strokeStyle = ink;
    paint.lineWidth = 0.8;
    const strip = height < 100;
    for (let row = 0; row < ROWS; row += strip ? 3 : 1) {
      paint.globalAlpha = row % 5 === 0 ? 0.85 : 0.4;
      paint.beginPath();
      for (let col = 0; col <= COLS; col++) {
        const index = row * (COLS + 1) + col;
        const elevation = from[index] + (to[index] - from[index]) * progress;
        const bend = Math.sin(col * 0.07 + row * 0.24 + phase) * mid * 6;
        const ripple = Math.sin(col * 0.65 + row * 0.6 + phase * 2) * treble * 1.8;
        const x = col / COLS * w + bend;
        const y = (32 + row * 6.8 - elevation * (0.65 + bass * 0.35) + ripple) * height / 220;
        if (col === 0) paint.moveTo(x, y);
        else paint.lineTo(x, y);
      }
      paint.stroke();
    }
    paint.globalAlpha = 1;
    label(mix);
  }

  function palette() {
    if (!panel) return;
    ink = getComputedStyle(panel).getPropertyValue('--contour-ink').trim() || '#91cdb7';
    draw();
  }
  function attach(page, path = location.hash.replace(/^#/, '')) {
    panel?.remove();
    const home = !path || path === '/' || /^\/home(?:[/?]|$)/.test(path);
    canvas = h('canvas.contour-canvas', { width: 640, height: home ? 220 : 64, 'aria-hidden': 'true' });
    paint = canvas.getContext('2d');
    subtitle = h('p.contour-track');
    seedLabel = h('span.contour-seed');
    panel = h(`section.contour-panel${home ? '.contour-wide' : '.contour-strip'}`, { 'aria-label': 'Track landscape' },
      h('header.contour-heading', h('div', h('h2', 'Contour'), subtitle), seedLabel), canvas,
      home ? h('p.contour-key', 'BASS / ELEVATION     MIDS / BEND     TREBLE / RIPPLE') : null);
    page.prepend(panel);
    signature = '';
    palette(); label();
    last = -Infinity;
  }
  function sync() {
    last = -Infinity;
    if (!motion() || !ctx.player.playing) draw();
  }
  ctx.on(document, 'routerendered', event => attach(event.detail.page, event.detail.path));
  ctx.on(document, 'themechange', palette);
  ctx.on(ctx.moments, 'trackchange', () => { label(); if (!ctx.player.playing || !motion()) draw(); });
  ctx.on(ctx.moments, 'transition', () => { label(); if (!motion()) draw(); });
  ctx.on(ctx.store, 'settings', sync);
  ctx.on(reduced, 'change', sync);
  ctx.on(document, 'visibilitychange', sync);
  ctx.on(document, 'appvisibility', sync);
  ctx.frame(frame => {
    if (!frame.playing || !motion() || frame.time - last < 1000 / 30) return;
    phase += Number.isFinite(last) ? Math.min(0.1, (frame.time - last) / 1000) * 0.2 : 0;
    last = frame.time;
    draw(frame);
  });
  const page = document.querySelector('#view > .page');
  if (page) attach(page);
  return () => { panel?.remove(); panel = null; canvas = null; paint = null; fields.clear(); };
}
