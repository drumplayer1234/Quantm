// Appearance: layout, density, fonts, zoom, backgrounds, artwork-matched colors,
// waveform style and the light/dark theme schedule. Everything is applied through
// <html data-*> attributes and CSS variables, so it combines with any theme or style layer.
import { safeParse } from './store.js';
import { player } from './player.js';
import { artwork } from './dom.js';
import * as theme from './theme.js';

const KEY = 'quantm.appearance';

export const FONTS = [
  { id: 'system', label: 'System default', stack: null },
  { id: 'bahnschrift', label: 'Bahnschrift (techy)', stack: '"Bahnschrift", "DIN Alternate", "Segoe UI", sans-serif' },
  { id: 'cascadia', label: 'Cascadia (code)', stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet', stack: '"Trebuchet MS", Tahoma, sans-serif' },
  { id: 'georgia', label: 'Georgia (serif)', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'comic', label: 'Comic Sans', stack: '"Comic Sans MS", "Comic Neue", cursive' }
];

export const WAVE_STYLES = [
  { id: 'bars', label: 'Bars' },
  { id: 'mirror', label: 'Mirrored' },
  { id: 'line', label: 'Smooth line' },
  { id: 'blocks', label: 'Blocks' }
];

export const DEFAULTS = {
  density: 'comfortable',      // comfortable | compact
  playerPosition: 'bottom',    // bottom | top | side
  nav: 'top',                  // top | sidebar
  showPlays: true,
  showGenres: true,
  background: 'none',          // none | artwork | image
  bgImage: '',                 // data URL of the user's picture
  bgDim: 70,                   // % of the theme background laid over the picture
  bgBlur: 24,                  // px
  artworkColors: false,        // accent follows the playing track's artwork
  font: 'system',
  zoom: 100,                   // %
  waveStyle: 'bars',
  waveThickness: 2,            // px per bar
  schedule: { enabled: false, day: 'SoundCloud Light', night: 'SoundCloud Dark', dayStart: '07:00', nightStart: '19:00' }
};

export function getAppearance() {
  const saved = safeParse(localStorage.getItem(KEY));
  return Object.assign({}, DEFAULTS, saved, { schedule: Object.assign({}, DEFAULTS.schedule, saved.schedule || {}) });
}

export function saveAppearance(patch) {
  const next = Object.assign(getAppearance(), patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (e) {
    // a huge background picture can overflow storage: keep everything else
    if (patch.bgImage) throw new Error('That picture is too large to save');
  }
  applyAppearance(next);
  return next;
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

let bgLayer = null;

export function applyAppearance(a = getAppearance()) {
  const root = document.documentElement;
  root.dataset.density = a.density;
  root.dataset.player = a.playerPosition;
  root.dataset.nav = a.nav;
  placeNav(a.nav);
  toggleAttr(root, 'data-hide-plays', !a.showPlays);
  toggleAttr(root, 'data-hide-genres', !a.showGenres);

  const font = FONTS.find(f => f.id === a.font);
  if (font && font.stack) {
    root.style.setProperty('--font', font.stack);
    root.style.setProperty('--font-display', font.stack);
  } else {
    root.style.removeProperty('--font');
    root.style.removeProperty('--font-display');
  }
  if (window.native && window.native.setZoom) window.native.setZoom(a.zoom / 100);

  root.dataset.wave = a.waveStyle;
  root.style.setProperty('--wave-bar', String(a.waveThickness));
  document.dispatchEvent(new CustomEvent('wavestylechange'));

  applyBackground(a);
  applyArtworkColors(a);
  checkSchedule(a, true);
}

/**
 * In sidebar mode the nav lives directly in #app. Inside the top bar, a blur effect on the
 * bar (glass themes, backgrounds) would become the fixed sidebar's containing block and collapse it.
 */
function placeNav(mode) {
  const nav = document.querySelector('.nav');
  const app = document.getElementById('app');
  const topLeft = document.querySelector('.topbar-left');
  if (!nav || !app || !topLeft) return;
  if (mode === 'sidebar' && nav.parentElement !== app) app.appendChild(nav);
  if (mode !== 'sidebar' && nav.parentElement !== topLeft) topLeft.appendChild(nav);
}

function toggleAttr(el, name, on) {
  if (on) el.setAttribute(name, '');
  else el.removeAttribute(name);
}

// --- background picture -------------------------------------------------------

function applyBackground(a) {
  const root = document.documentElement;
  if (!bgLayer) {
    bgLayer = document.createElement('div');
    bgLayer.id = 'app-bg';
    bgLayer.innerHTML = '<div class="app-bg-image"></div><div class="app-bg-dim"></div>';
    document.body.prepend(bgLayer);
  }
  const image = a.background === 'image' ? a.bgImage
    : a.background === 'artwork' && player.current ? artwork(player.current.artwork_url || (player.current.user && player.current.user.avatar_url), 't500x500')
    : '';
  toggleAttr(root, 'data-bg', a.background !== 'none' && !!image);
  bgLayer.firstChild.style.backgroundImage = image ? `url("${image}")` : '';
  root.style.setProperty('--bg-dim', String(a.bgDim / 100));
  root.style.setProperty('--bg-blur', a.bgBlur + 'px');
}

/** Shrink a picked image file to a JPEG data URL small enough for localStorage */
export function imageFileToDataUrl(file, maxSize = 1920) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// --- accent from artwork ----------------------------------------------------------

let artworkAccent = null; // { accent, accentText } currently applied

function applyArtworkColors(a) {
  const root = document.documentElement.style;
  if (!a.artworkColors || !artworkAccent) {
    if (artworkAccent && !a.artworkColors) {
      artworkAccent = null;
      theme.applyTheme(); // restore the theme's own accent
    }
    return;
  }
  root.setProperty('--accent', artworkAccent.accent);
  root.setProperty('--wave-played', artworkAccent.accent);
  root.setProperty('--accent-text', artworkAccent.accentText);
  document.dispatchEvent(new CustomEvent('accentchange'));
}

async function updateArtworkAccent() {
  if (isAlbumMatch()) return; // Album Match already colors everything from the artwork
  const a = getAppearance();
  const track = player.current;
  if (!a.artworkColors || !track) return;
  const url = artwork(track.artwork_url || (track.user && track.user.avatar_url), 't67x67');
  if (!url) return;
  const color = await dominantColor(url).catch(() => null);
  if (!color || player.current !== track) return;
  const bg = theme.getTheme().colors.bg;
  const accent = ensureContrast(color, bg);
  artworkAccent = { accent, accentText: theme.luminance(accent) > 0.45 ? '#000000' : '#ffffff' };
  applyArtworkColors(getAppearance());
}

/** The most vivid color in an image (fetched through the main process: no CORS) */
async function dominantColor(url) {
  const palette = await imagePalette(url);
  return palette && palette.vivid;
}

/** { vivid, base } colors of an image: the most striking color and the overall average */
const palettes = new Map();
function imagePalette(url) {
  if (!palettes.has(url)) {
    if (palettes.size >= 12) palettes.delete(palettes.keys().next().value);
    palettes.set(url, extractImagePalette(url).catch(error => { palettes.delete(url); throw error; }));
  }
  return palettes.get(url);
}

/** Share Album Match's extraction and cache with packs. */
export async function currentArtworkPalette() {
  const track = player.current;
  const colors = theme.getTheme().colors;
  const fallback = { vivid: colors.accent, base: colors.surface };
  const url = artwork(track && (track.artwork_url || track.user?.avatar_url), 't67x67');
  const palette = url ? await imagePalette(url).catch(() => null) : null;
  return player.current === track ? palette || fallback : currentArtworkPalette();
}

async function extractImagePalette(url) {
  const dataUrl = await window.native.image(url);
  if (!dataUrl) return null;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;

  // bucket colors, score buckets by count × saturation so dull backgrounds lose
  const buckets = new Map();
  const sum = { r: 0, g: 0, b: 0, n: 0 };
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    sum.r += r; sum.g += g; sum.b += b; sum.n++;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const light = (max + min) / 510;
    if (light < 0.12 || light > 0.92) continue;
    const key = (r >> 5) + ',' + (g >> 5) + ',' + (b >> 5);
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, sat: 0 };
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.n++; bucket.sat += sat;
    buckets.set(key, bucket);
  }
  let best = null;
  let bestScore = -1;
  for (const bucket of buckets.values()) {
    const score = bucket.n * Math.pow(bucket.sat / bucket.n + 0.05, 2);
    if (score > bestScore) { bestScore = score; best = bucket; }
  }
  const base = toHex(sum.r / sum.n, sum.g / sum.n, sum.b / sum.n);
  const vivid = best ? toHex(best.r / best.n, best.g / best.n, best.b / best.n) : base;
  return { vivid, base };
}

// --- Album Match theme: the whole palette follows the playing artwork -----------

const mix = (a, b, t) => {
  const [r1, g1, b1] = theme.hexToRgb(a);
  const [r2, g2, b2] = theme.hexToRgb(b);
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
};

let albumColors = null;

export function isAlbumMatch() {
  return theme.getTheme().style === 'album';
}

/** Build a dark palette from the artwork's colors and apply it (not saved: it changes per song) */
async function updateAlbumMatch() {
  if (!isAlbumMatch()) { albumColors = null; return; }
  const track = player.current;
  if (!track) return;
  const url = artwork(track.artwork_url || (track.user && track.user.avatar_url), 't67x67');
  const palette = url ? await imagePalette(url).catch(() => null) : null;
  if (!palette || player.current !== track || !isAlbumMatch()) return;

  // tint near-black with the artwork's overall hue, then pick a vivid accent that reads on it
  const bg = mix(palette.base, '#000000', 0.86);
  const accent = ensureContrast(palette.vivid, bg);
  albumColors = {
    bg,
    surface: mix(palette.base, '#000000', 0.76),
    bar: mix(palette.base, '#000000', 0.82),
    text: '#f4f4f4',
    muted: mix(palette.base, '#b4b4b4', 0.7),
    accent,
    accentText: theme.luminance(accent) > 0.45 ? '#000000' : '#ffffff',
    wave: mix(palette.base, '#000000', 0.55),
    wavePlayed: accent
  };
  applyAlbumColors();
}

function applyAlbumColors() {
  if (!albumColors || !isAlbumMatch()) return;
  const root = document.documentElement.style;
  const c = albumColors;
  root.setProperty('--bg', c.bg);
  root.setProperty('--surface', c.surface);
  root.setProperty('--bar', c.bar);
  root.setProperty('--text', c.text);
  root.setProperty('--muted', c.muted);
  root.setProperty('--accent', c.accent);
  root.setProperty('--accent-text', c.accentText);
  root.setProperty('--wave', c.wave);
  root.setProperty('--wave-played', c.wavePlayed);
  if (window.native) window.native.setTitleBar(c.bar, '#ffffff');
  document.dispatchEvent(new CustomEvent('accentchange'));
}

/** Lighten or darken a color until it stands out against the background */
function ensureContrast(hex, bg) {
  let [r, g, b] = theme.hexToRgb(hex);
  const darkBg = theme.luminance(bg) < 0.5;
  for (let i = 0; i < 12 && theme.contrast(toHex(r, g, b), bg) < 3; i++) {
    const t = 0.15;
    if (darkBg) { r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
    else { r *= 1 - t; g *= 1 - t; b *= 1 - t; }
  }
  return toHex(r, g, b);
}

function toHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

// --- light/dark schedule ------------------------------------------------------

let lastPeriod = null;

function minutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Switch presets when the day/night period changes (or right away when forced) */
function checkSchedule(a = getAppearance(), force = false) {
  const s = a.schedule;
  if (!s.enabled) { lastPeriod = null; return; }
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const dayStart = minutes(s.dayStart);
  const nightStart = minutes(s.nightStart);
  const isDay = dayStart <= nightStart ? current >= dayStart && current < nightStart : current >= dayStart || current < nightStart;
  const period = isDay ? 'day' : 'night';
  if (period === lastPeriod && !force) return;
  lastPeriod = period;
  const preset = isDay ? s.day : s.night;
  const colors = theme.PRESETS[preset];
  if (!colors) return;
  const current_ = theme.getTheme();
  if (current_.preset === preset) return;
  theme.saveTheme({ preset, colors: Object.assign({}, colors), radius: preset in theme.PRESET_RADIUS ? theme.PRESET_RADIUS[preset] : current_.radius, style: theme.PRESET_STYLES[preset] || '' });
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

export function initAppearance() {
  applyAppearance();
  player.on('track', () => {
    const a = getAppearance();
    if (a.background === 'artwork') applyBackground(a);
    if (isAlbumMatch()) updateAlbumMatch();
    else updateArtworkAccent();
  });
  // a theme change resets the CSS variables: put the artwork accent back on top
  document.addEventListener('themechange', () => {
    if (isAlbumMatch()) {
      // switching to Album Match: build the palette now; staying on it: re-apply after a reset
      if (albumColors) applyAlbumColors();
      else updateAlbumMatch();
      return;
    }
    albumColors = null;
    if (artworkAccent) applyArtworkColors(getAppearance());
  });
  setInterval(() => checkSchedule(), 30000);
}

/** Called from settings when the artwork-colors switch turns on */
export function refreshArtworkAccent() {
  updateArtworkAccent();
}
