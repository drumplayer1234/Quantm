// Pure EQ settings and presets. Gains and preamp are expressed in dB.
export const EQ_BANDS = [60, 230, 910, 3600, 14000];
export const EQ_PRESETS = Object.freeze(Object.fromEntries(Object.entries({
  Flat: [0, 0, 0, 0, 0],
  'Bass boost': [6, 3, 0, 0, 0],
  'Bass reducer': [-6, -3, 0, 0, 0],
  'Treble boost': [0, 0, 0, 3, 6],
  Vocal: [-2, 0, 4, 3, -1],
  Electronic: [5, 2, -2, 3, 4],
  'Hip-hop': [6, 3, 0, 1, 2],
  Rock: [4, 1, -2, 3, 4],
  Acoustic: [2, 1, 2, 2, 1],
  'Late night': [-4, -2, 1, -2, -4]
}).map(([name, gains]) => [name, Object.freeze(gains)])));

export function clampDb(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(-12, Math.min(12, n)) : 0;
}

export function presetFor(name) {
  return { preset: Object.hasOwn(EQ_PRESETS, name) ? name : 'Flat', preamp: 0,
    gains: [...(Object.hasOwn(EQ_PRESETS, name) ? EQ_PRESETS[name] : EQ_PRESETS.Flat)] };
}

export function matchingPreset(gains, preamp = 0) {
  if (!Array.isArray(gains) || gains.length !== 5 || preamp !== 0) return 'Custom';
  return Object.keys(EQ_PRESETS).find(name => EQ_PRESETS[name].every((v, i) => Math.abs(v - gains[i]) < 0.001)) || 'Custom';
}

export function normalizeEqualizer(eq = {}) {
  eq = eq || {};
  const gains = EQ_BANDS.map((_, i) => clampDb(eq.gains?.[i]));
  const preamp = clampDb(eq.preamp);
  return { enabled: eq.enabled === true, preamp, gains,
    preset: eq.preset === 'Custom' ? 'Custom' : matchingPreset(gains, preamp) };
}
