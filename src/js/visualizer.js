// Small audio visualizer for the player bar. Reads the analyser tapped after loudness
// normalization (normalizer.visual) and draws in the theme's accent colors.
import { h } from './dom.js';
import { player } from './player.js';
import { store, settings } from './store.js';

export const VISUALIZER_STYLES = [
  { id: 'bars', label: 'Bars' },
  { id: 'mirror', label: 'Mirrored bars' },
  { id: 'wave', label: 'Wave' }
];

export function createVisualizer({ width = 120, height = 34 } = {}) {
  const canvas = h('canvas.pb-visualizer', { title: 'Visualizer (change it in Settings → Playback)' });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  let frame = null;
  let colors = readColors();
  let freq = null;
  let wave = null;
  let idle = 0; // fades the bars down after pausing

  function readColors() {
    const css = getComputedStyle(document.documentElement);
    return { a: css.getPropertyValue('--accent').trim() || '#ff5500', b: css.getPropertyValue('--wave-played').trim() || '#ff5500' };
  }

  function draw() {
    frame = null;
    const analyser = player.normalizer && player.normalizer.visual;
    if (!settings.visualizer || !analyser || !canvas.isConnected) return;

    if (!freq || freq.length !== analyser.frequencyBinCount) {
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
    }
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, height, 0, 0);
    gradient.addColorStop(0, colors.a);
    gradient.addColorStop(1, colors.b);
    ctx.fillStyle = gradient;
    ctx.strokeStyle = gradient;

    const style = settings.visualizerStyle;
    if (style === 'wave') {
      analyser.getByteTimeDomainData(wave);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const step = wave.length / width;
      for (let x = 0; x < width; x++) {
        const v = (wave[Math.floor(x * step)] - 128) / 128;
        const y = height / 2 + v * (height / 2 - 2) * (player.playing ? 1 : 0);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    } else {
      analyser.getByteFrequencyData(freq);
      const bars = 18;
      const gap = 2;
      const barWidth = (width - gap * (bars - 1)) / bars;
      // log-ish frequency spacing so bass doesn't take over every bar
      const usable = Math.floor(freq.length * 0.72);
      for (let i = 0; i < bars; i++) {
        const start = Math.floor(Math.pow(i / bars, 1.7) * usable);
        const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / bars, 1.7) * usable));
        let sum = 0;
        for (let j = start; j < end; j++) sum += freq[j];
        const value = sum / (end - start) / 255;
        const barHeight = Math.max(2, value * (style === 'mirror' ? height / 2 : height));
        const x = i * (barWidth + gap);
        if (style === 'mirror') {
          roundRect(x, height / 2 - barHeight, barWidth, barHeight * 2);
        } else {
          roundRect(x, height - barHeight, barWidth, barHeight);
        }
      }
    }

    // keep animating while playing, and briefly after pausing so bars fall smoothly
    idle = player.playing ? 0 : idle + 1;
    if (idle < 40) frame = requestAnimationFrame(draw);
  }

  function roundRect(x, y, w, hgt) {
    const r = Math.min(2, w / 2);
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, hgt, r) : ctx.rect(x, y, w, hgt);
    ctx.fill();
  }

  const start = () => {
    canvas.classList.toggle('hidden', !settings.visualizer);
    idle = 0;
    if (!frame) frame = requestAnimationFrame(draw);
  };

  player.on('state', start);
  player.on('track', start);
  store.on('settings', start);
  document.addEventListener('themechange', () => { colors = readColors(); start(); });
  start();
  return canvas;
}
