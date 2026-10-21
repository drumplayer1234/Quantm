'use strict';

// Windows gives transparent (see-through) windows no Aero Snap, so Quantm snaps them itself:
// drop the window with the pointer at the top edge to maximize, at the left or right edge for half
// the screen, or in a corner for a quarter. Dragging a snapped window away restores its old size.

const EDGE = 4;     // px from the work area edge that count as "at the edge"
const CORNER = 24;  // px along an edge that count as its corner

/** Where a window should snap when dropped with the pointer at `point` ({x, y}), or null */
function snapTarget(point, workArea) {
  const { x, y, width, height } = workArea;
  const atLeft = point.x <= x + EDGE;
  const atRight = point.x >= x + width - 1 - EDGE;
  const atTop = point.y <= y + EDGE;
  const nearTop = point.y <= y + CORNER;
  const nearBottom = point.y >= y + height - 1 - CORNER;
  const halfW = Math.floor(width / 2);
  const halfH = Math.floor(height / 2);

  if ((atLeft || atRight) && (nearTop || nearBottom)) {
    return {
      kind: 'quarter',
      bounds: { x: atLeft ? x : x + halfW, y: nearTop ? y : y + halfH, width: atLeft ? halfW : width - halfW, height: nearTop ? halfH : height - halfH }
    };
  }
  if (atTop) return { kind: 'maximize' };
  if (atLeft) return { kind: 'half', bounds: { x, y, width: halfW, height } };
  if (atRight) return { kind: 'half', bounds: { x: x + halfW, y, width: width - halfW, height } };
  return null;
}

/** Bounds for a snapped window being dragged away: its old size, kept under the pointer */
function restoreBounds(point, current, previous) {
  const ratio = current.width > 0 ? (point.x - current.x) / current.width : 0.5;
  const width = previous.width;
  return {
    x: Math.round(point.x - width * Math.min(1, Math.max(0, ratio))),
    y: Math.max(current.y, point.y - 20),
    width,
    height: previous.height
  };
}

/** Wire snapping onto a BrowserWindow (Windows, see-through windows only) */
function enableSnapping(win, screen) {
  let snapped = null;   // bounds from before the window was snapped
  let restoring = false;

  win.on('will-move', () => {
    if (!snapped || restoring) return;
    // dragging a snapped window away: give it its old size back, under the pointer
    restoring = true;
    const previous = snapped;
    snapped = null;
    win.setBounds(restoreBounds(screen.getCursorScreenPoint(), win.getBounds(), previous));
    setTimeout(() => { restoring = false; }, 50);
  });

  win.on('moved', () => {
    if (restoring || win.isMaximized() || win.isFullScreen()) return;
    const point = screen.getCursorScreenPoint();
    const target = snapTarget(point, screen.getDisplayNearestPoint(point).workArea);
    if (!target) return;
    const before = win.getBounds();
    if (target.kind === 'maximize') {
      win.maximize();
      return;
    }
    snapped = before;
    win.setBounds(target.bounds);
  });

  // a maximized see-through window doesn't restore when dragged; do what Windows would
  win.on('will-move', (event) => {
    if (!win.isMaximized()) return;
    event.preventDefault();
    const point = screen.getCursorScreenPoint();
    const full = win.getBounds();
    win.unmaximize();
    const normal = win.getNormalBounds();
    win.setBounds(restoreBounds(point, full, normal));
  });
}

module.exports = { snapTarget, restoreBounds, enableSnapping };
