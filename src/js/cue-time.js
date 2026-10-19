// Cue times are media seconds, including for tracks longer than an hour.
export function formatCueTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) * 100) / 100);
  const minutes = Math.floor(total / 60);
  const rest = +(total - minutes * 60).toFixed(2);
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

/** Blank means inherit/clear (null); invalid or out-of-bounds means NaN. */
export function parseCueTime(value, durationMs) {
  const text = String(value).trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d+)?$/.test(text) && !/^\d+:\d{1,2}(?:\.\d+)?$/.test(text)) return NaN;
  const parts = text.split(':').map(Number);
  if (parts.length === 2 && parts[1] >= 60) return NaN;
  const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
  if (!Number.isFinite(seconds) || (Number.isFinite(durationMs) && durationMs > 0 && seconds > durationMs / 1000)) return NaN;
  return seconds;
}
