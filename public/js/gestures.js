// Spring physics and swipe-down-to-dismiss for sheets, the player and detail pages.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Critically-damped-ish spring from `from` to `to`, calling onFrame(x) every frame.
 * Resolves when settled. Defaults roughly match iOS sheet physics.
 */
export function spring({ from, to, velocity = 0, stiffness = 260, damping = 28, mass = 1, onFrame }) {
  return new Promise((resolve) => {
    if (reduced()) {
      onFrame(to);
      return resolve();
    }
    let x = from, v = velocity, last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const force = -stiffness * (x - to) - damping * v;
      v += (force / mass) * dt;
      x += v * dt;
      onFrame(x);
      if (Math.abs(v) < 2 && Math.abs(x - to) < 0.5) {
        onFrame(to);
        resolve();
      } else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Drag an element down to dismiss it. Rubber-bands upward, flings with velocity,
 * springs back when released short of the threshold.
 */
export function dragDismiss(el, { onDismiss, canStart = () => true, ignore = 'input, .scrub, [data-no-drag]', scale = true, threshold = 130 }) {
  if (!el || el.dataset.drag) return () => {};
  el.dataset.drag = '1';
  let startY = 0, startX = 0, dy = 0, tracking = false, decided = false, samples = [];

  const apply = (y) => {
    const p = Math.max(0, y) / innerHeight;
    el.style.transform = `translate3d(0, ${y}px, 0)${scale ? ` scale(${1 - p * 0.12})` : ''}`;
    el.style.borderRadius = scale ? `${Math.min(36, p * 160)}px` : '';
    el.style.setProperty('--drag', p.toFixed(3));
  };

  const down = (e) => {
    if (e.touches.length !== 1 || e.target.closest(ignore) || !canStart()) return;
    tracking = true;
    decided = false;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    dy = 0;
    samples = [{ y: startY, t: performance.now() }];
  };
  const move = (e) => {
    if (!tracking) return;
    const y = e.touches[0].clientY, x = e.touches[0].clientX;
    if (!decided) {
      if (Math.abs(y - startY) < 8 && Math.abs(x - startX) < 8) return;
      decided = true;
      // Only claim mostly-vertical downward drags.
      if (y - startY <= 0 || Math.abs(x - startX) > Math.abs(y - startY)) return (tracking = false);
      el.style.transition = 'none';
      el.style.willChange = 'transform';
    }
    e.preventDefault();
    const raw = y - startY;
    dy = raw > 0 ? raw * 0.9 : raw * 0.2; // rubber-band upward
    apply(dy);
    samples.push({ y, t: performance.now() });
    if (samples.length > 5) samples.shift();
  };
  const up = async () => {
    if (!tracking) return;
    tracking = false;
    if (!decided) return;
    const a = samples[0], b = samples[samples.length - 1];
    const v = b && a && b.t > a.t ? ((b.y - a.y) / (b.t - a.t)) * 1000 : 0; // px/s
    if (dy > threshold || v > 900) {
      try { navigator.vibrate?.(10); } catch {}
      await spring({ from: dy, to: innerHeight, velocity: Math.max(v, 1200), stiffness: 180, damping: 26, onFrame: apply });
      onDismiss();
    } else {
      await spring({ from: dy, to: 0, velocity: v, onFrame: apply });
      el.style.transform = el.style.borderRadius = el.style.willChange = '';
    }
  };

  el.addEventListener('touchstart', down, { passive: true });
  el.addEventListener('touchmove', move, { passive: false });
  el.addEventListener('touchend', up);
  el.addEventListener('touchcancel', up);
  return () => {
    el.removeEventListener('touchstart', down);
    el.removeEventListener('touchmove', move);
    el.removeEventListener('touchend', up);
    el.removeEventListener('touchcancel', up);
    delete el.dataset.drag;
  };
}
