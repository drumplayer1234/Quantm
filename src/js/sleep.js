// Timer logic has no browser imports, so formatting and lifecycle can be tested directly.
export function formatRemaining(milliseconds) {
  const seconds = Number.isFinite(milliseconds) ? Math.max(0, Math.ceil(milliseconds / 1000)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export class SleepTimer {
  constructor(player, notify = () => {}, clock = () => Date.now()) {
    this.player = player;
    this.notify = notify;
    this.clock = clock;
    this.listeners = new Set();
    this.mode = null;
    this.deadline = 0;
    this.firing = false;
    player.on('sleepend', () => { if (this.mode === 'track') this.finish(); });
    player.on('time', (time, duration) => {
      if (this.mode !== 'track' || !player.playing || !duration) return;
      const left = (duration - time) / player.rate;
      if (left > 8 && this.firing) {
        player.normalizer.restoreSleepVolume();
        this.firing = false;
      }
      if (left <= 8 && left > 0 && !this.firing) this.fade(left);
    });
    const resetFade = () => {
      if (this.mode !== 'track') return;
      player.normalizer.restoreSleepVolume();
      this.firing = false;
    };
    player.on('state', resetFade);
    player.on('speed', resetFade);
    player.on('timeline', resetFade);
    player.on('track', () => {
      if (this.mode === 'track' && this.track !== player.current) this.cancel();
    });
  }

  on(event, fn) {
    if (event === 'change') this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  change() { this.listeners.forEach(fn => fn()); }
  get remaining() { return Math.max(0, this.deadline - this.clock()); }

  start(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.clear();
    this.mode = 'time';
    this.deadline = this.clock() + minutes * 60000;
    this.interval = setInterval(() => this.tick(), 250);
    this.notify(`Sleep timer: ${minutes} minutes`);
    this.change();
  }

  startEndOfTrack() {
    if (!this.player.current) return;
    this.clear();
    this.mode = 'track';
    this.track = this.player.current;
    this.player.stopAtTrackEnd = true;
    this.notify('Sleep timer: end of this track');
    this.change();
  }

  tick() {
    if (this.mode !== 'time') return;
    if (this.remaining <= 0) { this.finish(); return; }
    if (this.remaining <= 8000 && !this.firing) this.fade(this.remaining / 1000);
    this.change();
  }

  fade(seconds) {
    this.firing = true;
    this.player.normalizer.fadeForSleep(seconds);
    // Track mode follows media events, including pauses and changes of playback speed.
    if (this.mode === 'time') this.change();
  }

  clear() {
    clearInterval(this.interval);
    this.player.stopAtTrackEnd = false;
    this.player.normalizer.restoreSleepVolume();
    this.mode = null;
    this.deadline = 0;
    this.firing = false;
  }

  cancel() {
    const active = this.mode;
    this.clear();
    if (active) this.notify('Sleep timer cancelled');
    this.change();
  }

  finish() {
    this.player.pause();
    this.clear();
    this.notify('Sleep timer: playback paused');
    this.change();
  }
}

let timer;
export function getSleepTimer(player, notify) {
  if (!timer) timer = new SleepTimer(player, notify);
  return timer;
}
