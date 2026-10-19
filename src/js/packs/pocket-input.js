/** Shortest signed turn, including when the pointer crosses the -PI/PI seam. */
export function angleDelta(previous, next) {
  return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
}

/** Retain partial turns so slow drags and quick drags produce the same steps. */
export function wheelSteps(remainder, delta, threshold = Math.PI / 12) {
  const total = remainder + delta;
  const steps = Math.trunc(total / threshold);
  return { steps, remainder: total - steps * threshold };
}

export function moveSelection(index, delta, length) {
  return Math.max(0, Math.min(Math.max(0, length - 1), index + delta));
}

export function feedItems(items) {
  const seen = new Set();
  return items.map(item => item.track || item.playlist).filter(item => {
    if (!item?.id || seen.has(`${item.kind}:${item.id}`)) return false;
    seen.add(`${item.kind}:${item.id}`);
    return true;
  });
}
