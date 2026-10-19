// Pack ids are style ids, so custom presets can reuse a pack.
export const PACKS = {
  'pocket': { layout: 'device', load: () => import('./packs/pocket.js') },
  'tmux': { layout: 'panes', load: () => import('./packs/tmux.js') },
  'listening-room': { layout: 'stage', load: () => import('./packs/listening-room.js') },
  ...((typeof window !== 'undefined' && window.QUANTM_LOCAL_THEMES?.packs) || {})
};

export const packFor = styleId => Object.hasOwn(PACKS, styleId) ? PACKS[styleId] : null;
export const listPacks = () => Object.keys(PACKS);
