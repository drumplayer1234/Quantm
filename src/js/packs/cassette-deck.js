import { h } from '../dom.js';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

/** The tape area, rather than its radius, is proportional to media position. */
export function tapeRadii(position) {
  const p = clamp(position);
  return [Math.sqrt(1 - p * 0.78), Math.sqrt(0.22 + p * 0.78)];
}

export function createCassette(track, side = 'A') {
  const title = h('div.cassette-written', track?.title || 'Your next favorite goes here');
  const artist = h('div.cassette-label-artist', track?.user?.username || 'Choose a track to start listening');
  const reels = ['left', 'right'].map(name => {
    const star = h('span.cassette-star', Array.from({ length: 6 }, (_, i) =>
      h('i', { style: { transform: `rotate(${i * 60}deg)` } })));
    return h(`div.cassette-reel.cassette-reel-${name}`, h('span.cassette-tape-roll'),
      h('span.cassette-hub', star, h('i.cassette-spindle')));
  });
  const shell = h('div.cassette-shell', { 'aria-hidden': 'true' },
    h('div.cassette-inner-ribs'),
    ...['tl', 'tr', 'bl', 'br'].map(corner => h(`i.cassette-screw.cassette-screw-${corner}`)),
    h('div.cassette-label', h('div.cassette-label-top', h('b', `SIDE ${side}`), h('span', 'STEREO / HIGH BIAS')),
      title, artist),
    h('div.cassette-window', h('span.cassette-tape-path'), ...reels),
    h('div.cassette-foot', h('i'), h('i'), h('span', 'MUSIC / IN GOOD HANDS'), h('i'), h('i')));
  return {
    shell,
    update(seconds, length, rotate = true) {
      const t = Math.max(0, Number(seconds) || 0);
      const [left, right] = tapeRadii(length > 0 ? t / length : 0);
      shell.style.setProperty('--tape-left', left.toFixed(5));
      shell.style.setProperty('--tape-right', right.toFixed(5));
      if (rotate) {
        // Deterministic media-time angles: pausing or seeking never introduces wall-clock drift.
        shell.style.setProperty('--reel-left', `${(t * 78 / left) % 360}deg`);
        shell.style.setProperty('--reel-right', `${(t * 78 / right) % 360}deg`);
      }
    }
  };
}

export function createMeter(channel) {
  const needle = h('i.cassette-needle');
  return {
    node: h('div.cassette-meter', { 'aria-hidden': 'true' },
      h('span.cassette-meter-name', `${channel} / VU`),
      h('div.cassette-meter-scale', h('span', '−20'), h('span', '−10'), h('span', '0'), h('span', '+3')),
      h('div.cassette-meter-arc'), needle, h('i.cassette-meter-pivot')),
    angle: -46, velocity: 0,
    step(energy, dt) {
      const target = -46 + clamp(energy) * 91;
      const elapsed = Math.min(0.1, Math.max(0, dt || 0));
      const steps = Math.max(1, Math.ceil(elapsed / 0.008));
      const step = elapsed / steps;
      // Underdamped spring gives a small mechanical overshoot without a CSS loop.
      for (let i = 0; i < steps; i++) {
        this.velocity += ((target - this.angle) * 170 - this.velocity * 14) * step;
        this.angle += this.velocity * step;
      }
      needle.style.transform = `rotate(${Math.max(-49, Math.min(49, this.angle))}deg)`;
    },
    reset() {
      this.angle = -46;
      this.velocity = 0;
      needle.style.transform = 'rotate(-46deg)';
    }
  };
}
