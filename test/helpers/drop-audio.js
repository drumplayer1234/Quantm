// Realistic low-end meter readings for a short quiet build followed by kick drums.
export function dropAudio(drop = 32, { sustained = true, constant = false } = {}) {
  return Array.from({ length: 2401 }, (_, i) => {
    const t = 20 + i / 100;
    const loud = t >= drop && (sustained || t < drop + 0.5);
    const pulse = constant ? 1 : Math.exp(-((t % 0.5) / 0.045));
    return { t, v: (loud ? 1 : 0.02) * pulse, f: loud ? 0.8 : 0.05, h: pulse };
  });
}
