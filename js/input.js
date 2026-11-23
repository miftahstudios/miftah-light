// Swipe + keyboard input.
// A swipe fires as soon as the finger travels 20px, once per touch (checked up, left, right, down in that order).
const PIXEL_DIST_TO_DETECT = 20;
const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };

export function bindInput(target, onSwipe) {
  let start = null;
  target.addEventListener('pointerdown', e => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
  target.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y; // screen y grows downward
    let dir = null;
    if (dy <= -PIXEL_DIST_TO_DETECT) dir = 'up';
    else if (dx <= -PIXEL_DIST_TO_DETECT) dir = 'left';
    else if (dx >= PIXEL_DIST_TO_DETECT) dir = 'right';
    else if (dy >= PIXEL_DIST_TO_DETECT) dir = 'down';
    if (dir) { start = null; onSwipe(dir); }
  });
  const end = () => { start = null; };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    const dir = KEYS[e.code];
    if (dir) { e.preventDefault(); onSwipe(dir); }
  });
}
