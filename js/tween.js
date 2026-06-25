// Promise-based rAF tween util shared across the 3D app. A global FAST flag
// (driven by window.__rmc.fastForward in tests) collapses every tween to an
// instant resolve so headless e2e is deterministic and quick.

export const easings = {
  linear: (t) => t,
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeOutBack: (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2,
  smooth: (t) => t * t * (3 - 2 * t),
};

export const FAST = { on: false };

export function wait(ms) {
  if (FAST.on) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

// tween({ ms, ease, onUpdate(v01), onComplete }) → Promise
export function tween({ ms = 400, ease = 'smooth', onUpdate, onComplete }) {
  const fn = typeof ease === 'function' ? ease : easings[ease] || easings.smooth;
  return new Promise((resolve) => {
    if (FAST.on || ms <= 0) {
      onUpdate?.(1);
      onComplete?.();
      resolve();
      return;
    }
    const start = performance.now();
    (function step(now) {
      const k = Math.min(1, (now - start) / ms);
      onUpdate?.(fn(k));
      if (k < 1) requestAnimationFrame(step);
      else { onComplete?.(); resolve(); }
    })(start);
  });
}

// Tween a Vector3 (or any {x,y,z}) from its current value to `to`.
export function tweenVec(vec, to, ms, ease = 'easeInOutQuad') {
  const from = { x: vec.x, y: vec.y, z: vec.z };
  return tween({
    ms, ease,
    onUpdate: (v) => {
      if (to.x !== undefined) vec.x = from.x + (to.x - from.x) * v;
      if (to.y !== undefined) vec.y = from.y + (to.y - from.y) * v;
      if (to.z !== undefined) vec.z = from.z + (to.z - from.z) * v;
    },
  });
}
