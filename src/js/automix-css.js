// Shared, cheap CSS clock. autoMixStatus does analysis; never call it per frame.
let activeStop;
// --beat changes every frame, and a variable on <html> restyles the whole page: only the themes
// that read it get it (at most 30 times a second). Add a style id here when a theme uses var(--beat).
const BEAT_STYLES = new Set(['blueprint', 'chrome', 'glitch', 'holo-card', 'rave-flyer', 'risograph', 'vapor-mall']);
const BEAT_MS = 1000 / 30;
const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const validGrid = grid => grid && Number.isFinite(grid.period) && grid.period > 0 && Number.isFinite(grid.offset);

/** Start once from app.js. Returns the same disposal function exposed for tests below. */
export function startAutoMixCss(player) {
  stopAutoMixCss();
  const html = document.documentElement;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let request = null;
  let stopped = false;
  let status = {};
  let sampledAt = -Infinity;
  let sampledAudio;
  let grid;
  let beatAt = -Infinity;
  const off = [];
  const mark = (key, value) => { if (html.dataset[key] !== value) html.dataset[key] = value; };
  const motion = () => html.dataset.themeMotion !== 'off' &&
    !(html.dataset.themeMotion !== 'on' && reduced?.matches);

  function reset() {
    mark('automix', 'off');
    mark('lock', 'none');
    delete html.dataset.swap;
    if (motion() || !html.dataset.beat) mark('beat', 'a');
    for (const key of ['--mix', '--beat', '--bpm']) html.style.setProperty(key, '0');
  }

  function paint(now) {
    // A track change also changes audio elements during a mix. Do not reuse its old grid.
    if (now - sampledAt >= 250 || sampledAudio !== player.audio) {
      status = player.autoMixStatus();
      sampledAt = now;
      sampledAudio = player.audio;
      const plan = player.mixPlan;
      const planned = plan && (plan.loadId == null || plan.loadId === player.loadId) ? plan.grid : null;
      const candidates = [player.fading && player.lock?.match?.gridIn, planned, status.live, status.structure?.grid];
      grid = candidates.find(validGrid);
    }
    const fading = player.fading;
    const mixing = !!fading;
    let progress = status.mix?.progress;
    // Web Audio's clock gives smooth, pause-correct progress between status snapshots.
    if (fading && Number.isFinite(fading.progress)) {
      progress = fading.progress;
      if (fading.startedAt != null && player.normalizer?.ctx && fading.seconds > 0) {
        progress += Math.max(0, player.normalizer.ctx.currentTime - fading.startedAt) / fading.seconds;
      }
    }
    progress = mixing ? clamp(progress) : 0;
    mark('automix', mixing ? 'mixing' : 'on');
    html.style.setProperty('--mix', String(progress));
    if (mixing) mark('swap', progress < 0.5 ? 'before' : 'after');
    else delete html.dataset.swap;
    // Match Settings' green threshold; an active controller alone does not mean in phase.
    mark('lock', mixing && status.lock?.active && Number.isFinite(status.lock.errorMs) &&
      Math.abs(status.lock.errorMs) < 12 ? 'locked' : 'none');
    const rate = player.audio?.playbackRate || 1;
    const bpm = grid ? (Number.isFinite(grid.bpm) && grid.bpm > 0 ? grid.bpm : 60 / grid.period) * rate : 0;
    html.style.setProperty('--bpm', String(bpm));
    const beats = grid && Number.isFinite(player.audio?.currentTime) ?
      (player.audio.currentTime - grid.offset) / grid.period : 0;
    if (BEAT_STYLES.has(html.dataset.style) || BEAT_STYLES.has(html.dataset.baseStyle)) {
      if (beatAt === -1 || now < beatAt || now - beatAt >= BEAT_MS) { beatAt = now; html.style.setProperty('--beat', String(((beats % 1) + 1) % 1)); }
    } else if (beatAt !== -1) { beatAt = -1; html.style.setProperty('--beat', '0'); }
    if (motion()) mark('beat', Math.abs(Math.floor(beats) % 2) === 0 ? 'a' : 'b');
    else if (!html.dataset.beat) mark('beat', 'a');
  }

  function tick(now) {
    request = null;
    sync(now);
  }
  function sync(now = performance.now()) {
    if (stopped) return;
    if (!player.playing || !player.autoMix) {
      if (request !== null) cancelAnimationFrame(request);
      request = null;
      sampledAt = -Infinity;
      grid = null;
      reset();
      return;
    }
    paint(now);
    if (request === null) request = requestAnimationFrame(tick);
  }
  // timeupdate also wakes the clock after Auto mix is enabled in Settings while playing.
  // No interval or animation frame is left running while paused or disabled.
  for (const event of ['state', 'time', 'track', 'automix', 'modes', 'transition', 'speed', 'timeline']) {
    off.push(player.on(event, () => sync()));
  }
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (request !== null) cancelAnimationFrame(request);
    request = null;
    off.forEach(fn => fn());
    reset();
    if (activeStop === stop) activeStop = null;
  };
  activeStop = stop;
  sync();
  return stop;
}

/** Stop the startup clock and release all player listeners (also useful to isolated tests). */
export function stopAutoMixCss() { activeStop?.(); }
