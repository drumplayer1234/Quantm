// Keeping Quantm light, especially while gaming:
// - while minimized: pause every animation and drawing loop, and drop image caches
// - Performance mode: no blur, animations, transitions or visualizer at all
import { store, settings } from './store.js';

let trimTimer = null;

function applyPerformanceMode() {
  document.documentElement.toggleAttribute('data-perf', !!settings.performanceMode);
  document.dispatchEvent(new CustomEvent('appvisibility'));
}

function setHidden(hidden) {
  const root = document.documentElement;
  const pause = hidden && settings.pauseWhenHidden !== false;
  root.toggleAttribute('data-hidden', pause);
  document.dispatchEvent(new CustomEvent('appvisibility'));
  clearTimeout(trimTimer);
  // once it has stayed minimized for a moment, free decoded images and caches
  if (pause) trimTimer = setTimeout(() => window.native.trimMemory(), 2000);
}

export function initPerformance() {
  applyPerformanceMode();
  window.native.onVisibility(setHidden);
  store.on('settings', applyPerformanceMode);
}
