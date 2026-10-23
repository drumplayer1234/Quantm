import { h } from '../dom.js';
import { motionAllowed } from '../audio-reactivity.js';

const WIDTH = 480;
const BINS = 64;
const INTERVAL = 1000 / 15;
const stamp = seconds => {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** 480 x 64 ring texture, 15 columns/second, with a bounded metadata ledger. */
export function mount(ctx) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const buffer = h('canvas', { width: WIDTH, height: BINS });
  const texture = buffer.getContext('2d');
  const column = texture?.createImageData(1, BINS);
  const times = new Float64Array(WIDTH);
  let bytes;
  let ranges = [];
  let serial = 0;
  let elapsed = 0;
  let last = -Infinity;
  let panel = null;
  let canvas = null;
  let paint = null;
  let status = null;
  let current = null;
  let overlap = null;
  let log = null;
  let boundaryId;
  let activeMix = null;
  let events = [];
  let colors = { bg: '#0c0e10', text: '#fff1d6', muted: '#bcb09b', amber: '#e4af64', ivory: '#fff1d6' };
  let ramp = [];
  const visible = () => !document.hidden && !document.documentElement.hasAttribute('data-hidden');
  const motion = () => motionAllowed(ctx.settings, reduced) &&
    document.documentElement.dataset.themeMotion !== 'off' &&
    !(document.documentElement.dataset.themeMotion === 'auto' && reduced.matches);

  function palette() {
    const style = getComputedStyle(panel || document.documentElement);
    for (const name of ['bg', 'text', 'muted']) colors[name] = style.getPropertyValue(`--${name}`).trim() || colors[name];
    for (const name of ['amber', 'ivory']) colors[name] = style.getPropertyValue(`--ledger-${name}`).trim() || colors[name];
    // Resolve any valid CSS color through the canvas rather than assuming hex presets.
    const rgb = color => {
      if (!texture) return [0, 0, 0];
      texture.fillStyle = color;
      texture.fillRect(0, 0, 1, 1);
      return [...texture.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const bg = rgb(colors.bg), amber = rgb(colors.amber), ivory = rgb(colors.ivory);
    ramp = Array.from({ length: 256 }, (_, i) => {
      const value = i / 255;
      const from = value < 0.55 ? bg : amber;
      const to = value < 0.55 ? amber : ivory;
      const t = value < 0.55 ? value / 0.55 : (value - 0.55) / 0.45;
      return from.map((v, j) => Math.round(v + (to[j] - v) * t));
    });
    // Palette changes reset the texture, preventing differently colored old columns.
    texture?.clearRect(0, 0, WIDTH, BINS);
    serial = 0; elapsed = 0; times.fill(0); events = []; activeMix = null; boundaryId = undefined;
    trackBoundary();
    const mix = ctx.player.autoMixStatus?.().mix;
    if (mix) beginMix(mix.from, mix.to);
    draw();
  }

  function addEvent(event) {
    events.push({ serial, time: elapsed, ...event });
    if (events.length > 24) events.shift();
    updateLog();
  }
  function trackBoundary() {
    const track = ctx.player.current;
    const id = track?.id ?? track?.urn ?? null;
    if (id === boundaryId) return;
    boundaryId = id;
    if (track) addEvent({ type: 'track', title: track.title || 'Untitled track' });
    sync();
  }
  function beginMix(from, to) {
    if (activeMix) return;
    activeMix = { type: 'mix', from: from?.title || 'Outgoing track', to: to?.title || 'Incoming track', end: null };
    addEvent(activeMix);
    // Keep the same object in the bounded ledger so the bracket can acquire its end.
    activeMix = events[events.length - 1];
    sync();
  }
  function endMix() {
    if (activeMix) activeMix.end = serial;
    activeMix = null;
    updateLog(); sync();
  }
  function updateLog() {
    if (!log) return;
    log.replaceChildren(...events.slice(-4).reverse().map(event => h('li',
      h('span.ledger-log-time', stamp(event.time)),
      h('span', event.type === 'mix' ? `Auto mix: ${event.from} / ${event.to}` : event.title))));
  }
  function sync() {
    last = -Infinity;
    if (!status) return;
    status.textContent = !motion() ? 'STILL / CAPTURE PAUSED' : !ctx.player.playing ? 'PAUSED' :
      ctx.player.normalizer?.visual ? 'LIVE / 15 FPS' : 'WAITING FOR AUDIO';
    current.textContent = ctx.player.current?.title || 'Play a track to start the ledger';
    overlap.textContent = activeMix ? `Auto mix overlap: ${activeMix.from} / ${activeMix.to}` :
      'High frequencies above / low frequencies below';
    draw();
  }

  function draw() {
    if (!paint || !visible()) return;
    const x0 = 44, y0 = 24, w = 580, height = 108;
    const count = Math.min(serial, WIDTH);
    const first = Math.max(0, serial - WIDTH);
    const cursor = serial % WIDTH;
    const xAt = index => x0 + w * (1 - (serial - index) / WIDTH);
    // The canvas is drawn at 2x so labels stay crisp when the panel is scaled up.
    paint.setTransform(2, 0, 0, 2, 0, 0);
    paint.fillStyle = colors.bg;
    paint.fillRect(0, 0, 640, 208);
    paint.imageSmoothingEnabled = false;
    if (serial < WIDTH) {
      if (count) paint.drawImage(buffer, 0, 0, count, BINS, x0 + w * (1 - count / WIDTH), y0, w * count / WIDTH, height);
    } else {
      if (cursor < WIDTH) paint.drawImage(buffer, cursor, 0, WIDTH - cursor, BINS, x0, y0, w * (WIDTH - cursor) / WIDTH, height);
      if (cursor) paint.drawImage(buffer, 0, 0, cursor, BINS, x0 + w * (WIDTH - cursor) / WIDTH, y0, w * cursor / WIDTH, height);
    }
    paint.font = '600 12px Consolas, monospace';
    paint.fillStyle = colors.ivory;
    const midY = y0 + height * (1 - Math.log(1000 / 20) / Math.log(16000 / 20));
    paint.fillText('16k', 4, y0 + 9); paint.fillText('1k', 10, midY + 4); paint.fillText('20Hz', 2, y0 + height);
    const oldest = count ? times[first % WIDTH] : 0;
    paint.fillText(stamp(oldest), x0, 150);
    paint.fillText(stamp(elapsed), x0 + w - 35, 150);
    paint.strokeStyle = colors.muted;
    paint.globalAlpha = 0.16;
    for (const y of [y0, midY, y0 + height]) {
      paint.beginPath(); paint.moveTo(x0, y); paint.lineTo(x0 + w, y); paint.stroke();
    }
    paint.globalAlpha = 1;
    const retained = events.filter(event => event === activeMix || (event.end ?? event.serial) >= first);
    for (const event of retained) {
      const x = Math.max(x0, xAt(event.serial));
      paint.strokeStyle = event.type === 'mix' ? colors.ivory : colors.amber;
      paint.beginPath();
      if (event.type === 'mix') {
        const end = Math.min(x0 + w, xAt(event.end ?? serial));
        paint.moveTo(x, 18); paint.lineTo(x, 10); paint.lineTo(end, 10); paint.lineTo(end, 18);
      } else {
        paint.moveTo(x, y0); paint.lineTo(x, y0 + height);
      }
      paint.stroke();
    }
    // Labels have their own solid band, separated from the frequency texture.
    const labels = retained.slice(-2);
    labels.forEach((event, index) => {
      const label = `${stamp(event.time)}  ${event.type === 'mix' ? `${event.from} / ${event.to}` : event.title}`;
      paint.save();
      paint.beginPath(); paint.rect(x0, 156 + index * 23, w, 22); paint.clip();
      paint.fillStyle = colors.text;
      paint.fillText(label, x0, 172 + index * 23);
      paint.restore();
    });
  }

  function attach(page, path = location.hash.replace(/^#/, '')) {
    panel?.remove(); panel = null; canvas = null; paint = null; status = null; log = null;
    if (path && path !== '/' && !/^\/home(?:[/?]|$)/.test(path)) return;
    canvas = h('canvas.ledger-canvas', { width: 1280, height: 416, 'aria-hidden': 'true' });
    paint = canvas.getContext('2d');
    status = h('span.ledger-status');
    current = h('p.ledger-current');
    overlap = h('p.ledger-overlap');
    log = h('ol.ledger-log', { 'aria-label': 'Recent track boundaries and Auto mix overlaps' });
    panel = h('section.ledger-panel', { 'aria-label': 'Spectral Ledger' },
      h('header.ledger-heading', h('div', h('h2', 'Spectral Ledger'), current), status),
      h('figure.ledger-figure', canvas, h('figcaption', overlap,
        h('span', 'CAPTURE TIME / MM:SS'))), log);
    page.prepend(panel);
    sync(); updateLog(); draw();
  }

  ctx.on(document, 'routerendered', event => attach(event.detail.page, event.detail.path));
  ctx.on(document, 'themechange', palette);
  ctx.on(ctx.moments, 'trackchange', () => { trackBoundary(); draw(); });
  ctx.on(ctx.moments, 'transition', ({ phase, from, to }) => {
    if (phase === 'start') beginMix(from, to);
    else if (phase === 'end') endMix();
    draw();
  });
  ctx.on(ctx.moments, 'playstate', sync);
  ctx.on(ctx.store, 'settings', sync);
  ctx.on(reduced, 'change', sync);
  ctx.on(document, 'visibilitychange', sync);
  ctx.on(document, 'appvisibility', sync);
  ctx.frame(frame => {
    if (!frame.playing || !motion() || !panel?.isConnected || !texture || !column || frame.time - last < INTERVAL) return;
    const analyser = ctx.player.normalizer?.visual;
    if (!analyser) return;
    if (!bytes || bytes.length !== analyser.frequencyBinCount) {
      bytes = new Uint8Array(analyser.frequencyBinCount);
      const nyquist = analyser.context.sampleRate / 2;
      ranges = Array.from({ length: BINS }, (_, row) => {
        const low = 20 * (16000 / 20) ** (row / BINS);
        const high = 20 * (16000 / 20) ** ((row + 1) / BINS);
        const start = Math.max(0, Math.min(bytes.length - 1, Math.floor(low / nyquist * bytes.length)));
        return [start, Math.min(bytes.length, Math.max(start + 1, Math.ceil(high / nyquist * bytes.length)))];
      });
    }
    analyser.getByteFrequencyData(bytes);
    const dt = Number.isFinite(last) ? Math.min(0.2, (frame.time - last) / 1000) : INTERVAL / 1000;
    last = frame.time;
    elapsed += dt;
    for (let row = 0; row < BINS; row++) {
      const [start, end] = ranges[row];
      let sum = 0;
      for (let bin = start; bin < end; bin++) sum += bytes[bin];
      const value = Math.round(sum / (end - start));
      const offset = (BINS - row - 1) * 4;
      column.data.set(ramp[value], offset);
      column.data[offset + 3] = 255;
    }
    texture.putImageData(column, serial % WIDTH, 0);
    times[serial % WIDTH] = elapsed;
    serial++;
    const mix = ctx.player.autoMixStatus?.().mix;
    if (mix && !activeMix) beginMix(mix.from, mix.to);
    else if (!mix && activeMix) endMix();
    // Discard old labels as their columns leave the ring; active brackets may span it.
    events = events.filter(event => event === activeMix || (event.end ?? event.serial) >= serial - WIDTH);
    draw();
  });
  const page = document.querySelector('#view > .page');
  if (page) attach(page);
  palette(); sync();
  return () => {
    panel?.remove(); panel = null; paint = null; canvas = null;
    buffer.width = 0; buffer.height = 0; bytes = null; ranges = []; events = []; ramp = [];
  };
}
