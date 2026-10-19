// Pack ids are style ids, so custom presets can reuse a pack.
export const PACKS = {
  'listening-room': { layout: 'stage', load: () => import('./packs/listening-room.js') },
  ...((typeof window !== 'undefined' && window.QUANTM_LOCAL_THEMES?.packs) || {})
};

export const packFor = styleId => Object.hasOwn(PACKS, styleId) ? PACKS[styleId] : null;
export const listPacks = () => Object.keys(PACKS);
