// Auto mix taste learning. Each transition tries a small random variation of the
// learned mix settings; keeping the new song nudges the settings toward it,
// skipping nudges them away. Learned per tempo bucket and kept in localStorage.
const KEY = 'quantm.mixlearn';
const RATE = 0.1;
const FIELDS = ['length', 'dj', 'stretch'];
const BUCKETS = ['slow', 'mid', 'fast', 'faster', 'nobeat'];
// How far a try may stray from the learned value (either direction).
const VARIATION = Object.freeze({ length: 0.12, dj: 0.15, stretch: 0.008 });

export const DEFAULTS = Object.freeze({ length: 1, dj: 1, stretch: 0.08 });
export const LIMITS = Object.freeze({ length: [0.5, 1.5], dj: [0, 1], stretch: [0.02, 0.08] });

let data = null; // { [bucket]: { length, dj, stretch, good, bad } }, loaded on first use

function clamp(field, value) {
  const [lo, hi] = LIMITS[field];
  return Math.max(lo, Math.min(hi, value));
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function count(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function fresh() {
  return { ...DEFAULTS, good: 0, bad: 0 };
}

// Clean up one stored bucket: clamp the numbers, fall back to defaults.
function sanitize(raw) {
  const entry = fresh();
  if (!raw || typeof raw !== 'object') return entry;
  for (const field of FIELDS) {
    const n = typeof raw[field] === 'number' ? raw[field] : NaN;
    entry[field] = Number.isFinite(n) ? round(clamp(field, n)) : DEFAULTS[field];
  }
  entry.good = count(raw.good);
  entry.bad = count(raw.bad);
  if (raw.styles && typeof raw.styles === 'object') {
    entry.styles = {};
    for (const style of ['blend', 'dropcut']) entry.styles[style] = {
      good: count(raw.styles[style]?.good), bad: count(raw.styles[style]?.bad)
    };
  }
  return entry;
}

function load() {
  if (data) return data;
  data = {};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    const buckets = saved && saved.version === 1 && saved.buckets;
    if (buckets && typeof buckets === 'object') {
      for (const bucket of BUCKETS) {
        if (Object.hasOwn(buckets, bucket)) data[bucket] = sanitize(buckets[bucket]);
      }
    }
  } catch { /* corrupt or unavailable storage: start from defaults */ }
  return data;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, buckets: load() }));
  } catch { /* storage full or blocked: keep what we have in memory */ }
}

/** Tempo bucket for a transition: 'slow' (< 100 BPM), 'mid' (100–<130), 'fast' (130–<160), 'faster' (>= 160), 'nobeat' (bpm null/invalid). */
export function bucketFor(bpm) {
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) return 'nobeat';
  if (bpm < 100) return 'slow';
  if (bpm < 130) return 'mid';
  if (bpm < 160) return 'fast';
  return 'faster';
}

/** Parameters for the next transition in this bucket: the learned values plus a small random variation (length ±0.12, dj ±0.15, stretch ±0.008, uniform), clamped to LIMITS. Returns { bucket, base: {...learned}, params: {...tried} }. random is injectable for tests (defaults to Math.random). */
export function choose(bucket, random = Math.random) {
  if (!BUCKETS.includes(bucket)) bucket = 'nobeat';
  const learned = load()[bucket] || DEFAULTS;
  const base = {};
  const params = {};
  for (const field of FIELDS) {
    base[field] = learned[field];
    params[field] = round(clamp(field, learned[field] + (random() * 2 - 1) * VARIATION[field]));
  }
  return { bucket, base, params };
}

/** Learn from how a transition went. outcome: 'good' (the new song kept playing) or 'bad' (skipped during or soon after the mix). Moves the bucket's learned values by rate 0.1: good → base + 0.1·(params − base); bad → base − 0.1·(params − base). Clamp to LIMITS, count it, save. Ignores unknown outcomes / malformed choices. */
export function record(choice, outcome) {
  if (outcome !== 'good' && outcome !== 'bad') return;
  if (!choice || !BUCKETS.includes(choice.bucket)) return;
  const { base, params } = choice;
  for (const field of FIELDS) {
    if (!Number.isFinite(base?.[field]) || !Number.isFinite(params?.[field])) return;
  }
  const buckets = load();
  const entry = buckets[choice.bucket] || (buckets[choice.bucket] = fresh());
  if (['blend', 'dropcut'].includes(choice.style)) {
    entry.styles ||= { blend: { good: 0, bad: 0 }, dropcut: { good: 0, bad: 0 } };
    entry.styles[choice.style][outcome]++;
  }
  const sign = outcome === 'good' ? 1 : -1;
  for (const field of FIELDS) {
    // Step by the variation that was tried, applied to what is learned now.
    const step = choice.style === 'dropcut' ? 0 : sign * RATE * (params[field] - base[field]);
    entry[field] = round(clamp(field, entry[field] + step));
  }
  entry[outcome] += 1;
  save();
}

/** A skipped drop cut makes Auto prefer blends in this tempo bucket. Explicit choices still work. */
export function avoidsDropCut(bucket) {
  const outcomes = load()[bucket]?.styles?.dropcut;
  return !!outcomes && outcomes.bad > outcomes.good;
}

/** What has been learned, for the settings screen: { transitions (total recorded), buckets: { [bucket]: { length, dj, stretch, good, bad } } } (only buckets with data). */
export function stats() {
  const out = { transitions: 0, buckets: {} };
  for (const [bucket, entry] of Object.entries(load())) {
    if (entry.good + entry.bad === 0) continue;
    out.buckets[bucket] = { ...entry };
    out.transitions += entry.good + entry.bad;
  }
  return out;
}

/** Forget everything learned. */
export function reset() {
  data = {};
  save();
}
