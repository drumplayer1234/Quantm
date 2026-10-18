// Theme engine: every color in the UI comes from these CSS variables.
import { safeParse } from './store.js';

const THEME_KEY = 'quantm.theme';

/** Editable color slots, in the order the theme editor shows them */
export const THEME_FIELDS = [
  { key: 'accent', label: 'Accent', hint: 'Buttons, progress, highlights' },
  { key: 'accentText', label: 'Text on accent', hint: 'Labels on accent-colored buttons' },
  { key: 'bg', label: 'Background', hint: 'Main window background' },
  { key: 'surface', label: 'Surface', hint: 'Cards, menus, dialogs' },
  { key: 'bar', label: 'Top & player bars', hint: 'Navigation bar and player bar' },
  { key: 'text', label: 'Text', hint: 'Titles and body text' },
  { key: 'muted', label: 'Secondary text', hint: 'Artists, counts, timestamps' },
  { key: 'wave', label: 'Waveform', hint: 'Unplayed part of waveforms' },
  { key: 'wavePlayed', label: 'Waveform (played)', hint: 'Played part of waveforms' }
];

export const PRESETS = {
  'SoundCloud Dark': {
    accent: '#ff5500', accentText: '#ffffff', bg: '#121212', surface: '#1e1e1e', bar: '#181818',
    text: '#f2f2f2', muted: '#a0a0a0', wave: '#5c5c5c', wavePlayed: '#ff5500'
  },
  'SoundCloud Light': {
    accent: '#ff5500', accentText: '#ffffff', bg: '#f6f6f6', surface: '#ffffff', bar: '#ffffff',
    text: '#1a1a1a', muted: '#6b6b6b', wave: '#c4c4c4', wavePlayed: '#ff5500'
  },
  'Midnight': {
    accent: '#5b8cff', accentText: '#ffffff', bg: '#0d1117', surface: '#161b22', bar: '#10151c',
    text: '#e6edf3', muted: '#8b949e', wave: '#30363d', wavePlayed: '#5b8cff'
  },
  'Synthwave': {
    accent: '#ff2e97', accentText: '#ffffff', bg: '#140b24', surface: '#1f1235', bar: '#190e2d',
    text: '#f7e9ff', muted: '#a991c7', wave: '#3b2a5a', wavePlayed: '#2ee6ff'
  },
  'Forest': {
    accent: '#3ddc84', accentText: '#06210f', bg: '#0f1712', surface: '#17221b', bar: '#121c16',
    text: '#e4f1e8', muted: '#8aa594', wave: '#2c3d32', wavePlayed: '#3ddc84'
  },
  'Y2K': {
    accent: '#2f6fe0', accentText: '#ffffff', bg: '#ece9d8', surface: '#ffffff', bar: '#245edb',
    text: '#000000', muted: '#4d4d4d', wave: '#a9c3ef', wavePlayed: '#2f6fe0'
  },
  'Mono': {
    accent: '#ffffff', accentText: '#000000', bg: '#000000', surface: '#111111', bar: '#0a0a0a',
    text: '#ffffff', muted: '#8a8a8a', wave: '#333333', wavePlayed: '#ffffff'
  }
};

/**
 * Some presets also change shapes, fonts and textures, not just colors.
 * The style name becomes <html data-style="..."> and styles/themes/<name>.css does the rest.
 */
export const PRESET_STYLES = {
  'Y2K': 'y2k'
};

export const DEFAULT_THEME = { preset: 'SoundCloud Dark', colors: Object.assign({}, PRESETS['SoundCloud Dark']), radius: 10 };

export function getTheme() {
  const saved = safeParse(localStorage.getItem(THEME_KEY));
  const base = PRESETS[saved.preset] || DEFAULT_THEME.colors;
  const preset = saved.preset || DEFAULT_THEME.preset;
  return {
    preset,
    colors: Object.assign({}, base, saved.colors || {}),
    radius: typeof saved.radius === 'number' ? saved.radius : DEFAULT_THEME.radius,
    style: typeof saved.style === 'string' ? saved.style : (PRESET_STYLES[preset] || '')
  };
}

export function saveTheme(theme) {
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  applyTheme(theme);
}

/** Write the theme into CSS variables on <html> and recolor the window controls */
export function applyTheme(theme = getTheme()) {
  const root = document.documentElement.style;
  const c = theme.colors;
  root.setProperty('--accent', c.accent);
  root.setProperty('--accent-text', c.accentText);
  root.setProperty('--bg', c.bg);
  root.setProperty('--surface', c.surface);
  root.setProperty('--bar', c.bar);
  root.setProperty('--text', c.text);
  root.setProperty('--muted', c.muted);
  root.setProperty('--wave', c.wave);
  root.setProperty('--wave-played', c.wavePlayed);
  root.setProperty('--radius', theme.radius + 'px');
  document.documentElement.dataset.scheme = luminance(c.bg) > 0.5 ? 'light' : 'dark';
  const style = typeof theme.style === 'string' ? theme.style : (PRESET_STYLES[theme.preset] || '');
  if (style) document.documentElement.dataset.style = style;
  else delete document.documentElement.dataset.style;

  // window buttons need to stay readable on the bar, whatever the text color is
  if (window.native) window.native.setTitleBar(c.bar, luminance(c.bar) > 0.5 ? '#000000' : '#ffffff');
  document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}

/** Relative luminance 0..1 of a #rrggbb color */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value.padEnd(6, '0');
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) || 0);
}

/** Theme as a shareable JSON string */
export function exportTheme(theme = getTheme()) {
  return JSON.stringify({ name: theme.preset, colors: theme.colors, radius: theme.radius, style: theme.style || '' }, null, 2);
}

/** Parse a shared theme; throws if it isn't valid */
export function importTheme(text) {
  const data = JSON.parse(text);
  if (!data || typeof data.colors !== 'object') throw new Error('Not a Quantm theme');
  const colors = Object.assign({}, DEFAULT_THEME.colors);
  THEME_FIELDS.forEach(({ key }) => {
    if (/^#[0-9a-f]{6}$/i.test(data.colors[key] || '')) colors[key] = data.colors[key];
  });
  const style = Object.values(PRESET_STYLES).includes(data.style) ? data.style : '';
  return { preset: 'Custom', colors, radius: typeof data.radius === 'number' ? data.radius : DEFAULT_THEME.radius, style };
}
