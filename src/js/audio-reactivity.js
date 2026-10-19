// Pure signal helpers; no analyser configuration is changed here.

/** settings.themeEffects: 'auto' follows the system's reduce-motion setting; older saves stored true/false */
export function effectsMode(value) {
  return value === false || value === 'off' ? 'off' : value === 'on' ? 'on' : 'auto';
}

export function effectsAllowed(value, reducedMotion) {
  const mode = effectsMode(value);
  return mode === 'on' || (mode === 'auto' && !reducedMotion);
}

/** Whether theme motion may run right now (media is a prefers-reduced-motion MediaQueryList) */
export function motionAllowed(settings, media) {
  const root = document.documentElement;
  return !document.hidden && !root.hasAttribute('data-perf') && !root.hasAttribute('data-hidden') &&
    effectsAllowed(settings.themeEffects, !!(media && media.matches));
}

export function bandsFrom(bytes, sampleRate, fftSize) {
  const sums = [0, 0, 0];
  const counts = [0, 0, 0];
  for (let i = 0; i < bytes.length; i++) {
    const hz = i * sampleRate / fftSize;
    if (hz < 20 || hz > 16000) continue;
    const band = hz < 250 ? 0 : hz < 2000 ? 1 : 2;
    sums[band] += (bytes[i] / 255) ** 2;
    counts[band]++;
  }
  const values = sums.map((sum, i) => Math.sqrt(sum / (counts[i] || 1)));
  return { bass: values[0], mid: values[1], treble: values[2] };
}

export function smooth(prev, next, attack = 0.45, release = 0.12) {
  return prev + (next - prev) * Math.max(0, Math.min(1, next > prev ? attack : release));
}

export function onsetStep(prev = { average: 0, pulse: 0, cooldown: 0 }, energy, dt = 1 / 30) {
  const cooldown = Math.max(0, prev.cooldown - dt);
  const hit = cooldown === 0 && energy > 0.09 && energy > prev.average * 1.45 + 0.035;
  return {
    average: smooth(prev.average, energy, 0.12, 0.07),
    pulse: hit ? 1 : prev.pulse * Math.exp(-dt * 5),
    cooldown: hit ? 0.24 : cooldown
  };
}

/** One scheduler shared by all packs. Dependencies come from the shell runtime. */
export function createAudioReactivity(player, store, settings) {
  const subscribers = new Set();
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raf = null;
  let last = null;
  let freq, wave;
  let values = { level: 0, bass: 0, mid: 0, treble: 0 };
  let onset;
  const blocked = () => !motionAllowed(settings, media);
  function emit(frame) {
    for (const fn of subscribers) {
      try { fn(frame); } catch (error) { console.error('Theme frame failed', error); }
    }
  }
  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    last = null;
    values = { level: 0, bass: 0, mid: 0, treble: 0 };
    onset = undefined;
  }
  function sync() {
    if (!subscribers.size || blocked() || !player.playing) {
      stop();
      if (subscribers.size) emit({ time: performance.now(), dt: 0, playing: false, ...values, pulse: 0 });
    } else if (raf === null) raf = requestAnimationFrame(tick);
  }
  function tick(time) {
    raf = null;
    if (blocked() || !player.playing || !subscribers.size) { sync(); return; }
    if (last === null || time - last >= 1000 / 30) {
      const dt = last === null ? 1 / 30 : Math.min(0.2, (time - last) / 1000);
      last = time;
      const analyser = player.normalizer.visual;
      let next = { level: 0, bass: 0, mid: 0, treble: 0 };
      if (analyser) {
        if (!freq || freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount);
        if (!wave || wave.length !== analyser.fftSize) wave = new Uint8Array(analyser.fftSize);
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(wave);
        let sum = 0;
        for (const byte of wave) sum += ((byte - 128) / 128) ** 2;
        next = { ...bandsFrom(freq, analyser.context.sampleRate, analyser.fftSize), level: Math.min(1, Math.sqrt(sum / wave.length)) };
      }
      for (const key of Object.keys(values)) values[key] = smooth(values[key], next[key]);
      onset = onsetStep(onset, next.bass * 0.65 + next.level * 0.35, dt);
      emit({ time, dt, playing: true, ...values, pulse: onset.pulse });
    }
    if (subscribers.size && !blocked() && player.playing) raf = requestAnimationFrame(tick);
    else sync();
  }
  const offState = player.on('state', sync);
  const offSettings = store.on('settings', sync);
  document.addEventListener('appvisibility', sync);
  document.addEventListener('visibilitychange', sync);
  media.addEventListener('change', sync);
  return {
    subscribe(fn) {
      subscribers.add(fn);
      sync();
      return () => { subscribers.delete(fn); sync(); };
    },
    destroy() {
      subscribers.clear(); stop(); offState(); offSettings();
      document.removeEventListener('appvisibility', sync);
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', sync);
    }
  };
}
