/**
 * Point-origin click ripples (UI feedback, NFR: usability).
 *
 * One capture-phase listener on the document rather than a `<Pressable>` wrapper
 * around ninety call sites. A button is a button wherever it appears, and the
 * feedback should not depend on a developer having remembered to opt in — the
 * driver's check-in screen in particular has to answer a tap instantly, before
 * any network round trip (FR-D2, FR-D6).
 *
 * The ripple is drawn at the point actually pressed, which is the part a CSS-only
 * `:active` flash cannot do and the part that makes a tap feel located rather
 * than merely acknowledged. It inherits `currentColor`, so it reads correctly on
 * a dark primary button and a light ghost one with no per-variant styling.
 */

/** The classes that are buttons. `btn` itself never reaches the DOM: it is
 *  `@apply`-ed into each variant, so the variants have to be listed. */
const TARGETS = '.btn, .btn-primary, .btn-ghost, .btn-danger, .btn-tap, [data-ripple]';

/** Long enough to cover the 0.62s animation plus a frame of slack. */
const CLEANUP_MS = 700;

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function spawn(host, event) {
  const box = host.getBoundingClientRect();
  // Reach the far corner from wherever the press landed, so the ripple always
  // covers the whole control rather than stopping short on an edge tap.
  const size = Math.hypot(
    Math.max(event.clientX - box.left, box.right - event.clientX),
    Math.max(event.clientY - box.top, box.bottom - event.clientY),
  ) * 2;

  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.setProperty('--ripple-x', `${event.clientX - box.left}px`);
  ripple.style.setProperty('--ripple-y', `${event.clientY - box.top}px`);
  ripple.style.setProperty('--ripple-size', `${size}px`);

  host.appendChild(ripple);

  // `animationend` is the accurate signal, but a detached or display:none host
  // never fires it, so a timer backs it up. Both paths are idempotent.
  const drop = () => ripple.remove();
  ripple.addEventListener('animationend', drop, { once: true });
  setTimeout(drop, CLEANUP_MS);
}

/**
 * Starts listening. Returns a teardown so a test or a hot reload can detach.
 * Safe to call more than once only in the sense that each call adds a listener —
 * `main.jsx` calls it exactly once.
 */
export function installRipples(root = document) {
  if (typeof document === 'undefined') return () => {};

  const onPointerDown = (event) => {
    // Left button / touch / pen only: a right-click is not a press.
    if (event.button !== 0 || reduced()) return;

    const host = event.target?.closest?.(TARGETS);
    if (!host || host.disabled || host.getAttribute('aria-disabled') === 'true') return;

    spawn(host, event);
  };

  root.addEventListener('pointerdown', onPointerDown, { passive: true });
  return () => root.removeEventListener('pointerdown', onPointerDown);
}

export default installRipples;
