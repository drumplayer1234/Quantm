export const COMMANDS = ['play', 'pause', 'next', 'prev', 'like', 'go', 'search', 'shuffle likes', 'help'];
export const WINDOWS = ['home', 'feed', 'library', 'stats', 'trending', 'settings'];

export function parseCommand(value) {
  const [name = '', ...rest] = value.trim().split(/\s+/);
  return { name: name.toLowerCase(), argument: rest.join(' ') };
}

export function completeCommand(value) {
  const prefix = value.trimStart().toLowerCase();
  if (prefix.startsWith('go ')) return WINDOWS.map(name => `go ${name}`).filter(name => name.startsWith(prefix));
  return COMMANDS.filter(name => name.startsWith(prefix));
}

export function paneSize(value, fallback = 60) {
  return Number.isFinite(value) ? Math.max(25, Math.min(75, value)) : fallback;
}

export function logLine(message, date = new Date()) {
  const stamp = [date.getHours(), date.getMinutes(), date.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  return `${stamp} │ ${String(message).replace(/[\r\n\t]+/g, ' ')}`;
}

export function spectrumText({ bass = 0, mid = 0, treble = 0, level = 0, playing = false } = {}) {
  const unit = n => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const bands = [bass, mid, treble].map(n => playing ? unit(n) : 0);
  const heights = Array.from({ length: 24 }, (_, i) => Math.round(bands[Math.floor(i / 8)] * (5 - (i % 4) * 0.5)));
  const rows = Array.from({ length: 5 }, (_, row) => heights.map(n => n >= 5 - row ? '█' : ' ').join(''));
  const vu = Math.round((playing ? unit(level) : 0) * 20);
  return [...rows, '────────────────────────', ' BASS    MID     TREBLE', `VU [${'▓'.repeat(vu)}${'░'.repeat(20 - vu)}]`].join('\n');
}
