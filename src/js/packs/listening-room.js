import { h } from '../dom.js';
import { motionAllowed } from '../audio-reactivity.js';

/** Artwork colors are often too dark to glow: keep the hue, lift saturation and lightness into a visible range */
export function glowColor(hex, minLight = 0.5, minSat = 0.45) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let hue = 0, sat = 0;
  const light = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue *= 60;
  }
  // greys stay grey instead of turning red
  const s = sat < 0.06 ? sat : Math.max(sat, minSat);
  const l = Math.min(0.72, Math.max(light, minLight));
  return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export function mount(ctx) {
  ctx.views.override('home', () => import('./listening-room-stage.js'));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const banks = [h('div.lr-washes'), h('div.lr-washes')];
  for (const bank of banks) bank.append(h('div.lr-wash.lr-wash-a'), h('div.lr-wash.lr-wash-b'), h('div.lr-wash.lr-wash-c'));
  ctx.root.append(...banks);
  let alive = true;
  let request = 0;
  let visible = 0;
  const motion = () => motionAllowed(ctx.settings, reduced);
  function sync() {
    ctx.root.classList.toggle('lr-still', !motion());
  }
  async function palette() {
    const id = ++request;
    const colors = await ctx.palette();
    if (!alive || id !== request) return;
    const next = 1 - visible;
    banks[next].style.setProperty('--room-vivid', glowColor(colors.vivid, 0.5));
    banks[next].style.setProperty('--room-base', glowColor(colors.base, 0.38, 0.3));
    banks[next].style.opacity = '1';
    banks[visible].style.opacity = '0';
    visible = next;
  }
  ctx.on(ctx.moments, 'trackchange', palette);
  ctx.on(ctx.store, 'settings', sync);
  ctx.on(document, 'appvisibility', sync);
  ctx.on(document, 'visibilitychange', sync);
  ctx.on(reduced, 'change', sync);
  ctx.frame(({ time, bass, level, pulse, playing }) => {
    const breath = playing ? Math.sin(time / 6500) * 0.012 : 0;
    for (let i = 0; i < banks.length; i++) {
      banks[i].style.transform = `scale(${1 + bass * 0.055 + pulse * 0.018 + breath}) translateY(${level * -8}px)`;
    }
  });
  sync();
  palette().catch(error => console.error('Listening Room palette failed', error));
  return () => { alive = false; ++request; };
}
