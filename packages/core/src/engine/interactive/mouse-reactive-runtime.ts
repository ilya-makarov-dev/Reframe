/**
 * Runtime source for mouse-reactive interactive behavior (T2 #27).
 *
 * Single IIFE inlined into html.ts exports + bundle exports. Walks
 * `[data-reframe-interactive]` elements at DOMContentLoaded, attaches
 * a single document-level mousemove handler (event delegation), and
 * runs one RAF loop interpolating per-element transforms + CSS vars.
 *
 * ─── Why a single IIFE per scene, not per-element handler ───
 *
 * One handler, N elements: O(1) per mousemove event (only the closest
 * interactive element is processed via .closest()). Per-element
 * handlers would multiply listener count linearly + duplicate state.
 *
 * ─── Why CSS var for transform, not direct style.transform ───
 *
 * Existing exporter emits `transform: rotate(<rotation>deg)` for nodes
 * with non-zero rotation. Setting el.style.transform from runtime would
 * stomp that. Instead, exporter emits
 *   `transform: <existing-transforms> var(--reframe-mouse-tilt, )`
 * and runtime updates the CSS var. Append-safe: rotation/flip survive,
 * tilt composes over them.
 *
 * ─── Why CSS var for glow, not redrawn gradient ───
 *
 * ::before pseudo-element with radial-gradient anchored at
 * `var(--mouse-x, 50%) var(--mouse-y, 50%)`. Runtime only updates the
 * vars — CSS engine repaints. Cheaper than computing gradient stops in
 * JS each frame and avoids extra canvas elements.
 *
 * ─── Determinism ────────────────────────────────────────────
 *
 * No random / Date — runtime state is derived from mouse position only.
 * Same mouse trajectory → identical CSS var sequence. Mounting the
 * same scene twice on a static page (no mouse) shows identical
 * neutral state.
 */

export const MOUSE_REACTIVE_RUNTIME_SOURCE = `
(function() {
  if (window.__reframeMouseReactive) return;  // idempotent — guard against double-include in bundle/SPA shells
  window.__reframeMouseReactive = true;

  var TILT_DEFAULT = 8;
  var DAMPING_DEFAULT = 0.15;
  var PERSPECTIVE_DEFAULT = 800;
  var GLOW_COLOR_DEFAULT = 'rgba(255,255,255,0.1)';
  var GLOW_RADIUS_DEFAULT = 200;

  var states = [];     // parallel array of state objects (DOM order)
  var elements = [];   // parallel array of elements

  function attach(el) {
    var raw = el.getAttribute('data-reframe-interactive-config');
    var cfg = {};
    if (raw) {
      try { cfg = JSON.parse(raw); }
      catch (e) { console.warn('[reframe-interactive] failed to parse config on', el, e); }
    }
    var type = el.getAttribute('data-reframe-interactive') || 'mouse-tilt-glow';

    var state = {
      type: type,
      tiltStrength: typeof cfg.tiltStrength === 'number' ? cfg.tiltStrength : TILT_DEFAULT,
      damping: typeof cfg.tiltDamping === 'number' ? cfg.tiltDamping : DAMPING_DEFAULT,
      perspective: typeof cfg.perspective === 'number' ? cfg.perspective : PERSPECTIVE_DEFAULT,
      glowColor: typeof cfg.glowColor === 'string' ? cfg.glowColor : GLOW_COLOR_DEFAULT,
      glowRadius: typeof cfg.glowRadius === 'number' ? cfg.glowRadius : GLOW_RADIUS_DEFAULT,
      // current vs target position (0..1 normalized within element bbox)
      currentX: 0.5, currentY: 0.5,
      targetX: 0.5, targetY: 0.5,
      // hover flag — only animate toward (targetX,targetY); on leave, target snaps to 0.5
      hovered: false,
    };

    // Apply per-element CSS vars for glow color + radius (read by ::before rule).
    el.style.setProperty('--reframe-glow-color', state.glowColor);
    el.style.setProperty('--reframe-glow-radius', state.glowRadius + 'px');

    // Tilt requires perspective on the parent. Skip if parent already
    // declares perspective in its computed style — respect designer choice.
    if (state.type.indexOf('tilt') !== -1 && el.parentElement) {
      var parent = el.parentElement;
      var existing = getComputedStyle(parent).perspective;
      if (!existing || existing === 'none') {
        parent.style.perspective = state.perspective + 'px';
      }
    }

    states.push(state);
    elements.push(el);
  }

  function onMouseMove(e) {
    // Find the closest interactive element. Walk up from event target.
    var el = e.target && e.target.nodeType === 1 ? e.target.closest('[data-reframe-interactive]') : null;
    // Mark all elements as un-hovered first; we'll re-mark the matched one.
    for (var i = 0; i < states.length; i++) states[i].hovered = false;
    if (!el) return;
    var idx = elements.indexOf(el);
    if (idx === -1) return;
    var state = states[idx];
    state.hovered = true;
    var rect = el.getBoundingClientRect();
    state.targetX = (e.clientX - rect.left) / rect.width;
    state.targetY = (e.clientY - rect.top) / rect.height;
  }

  function onDocumentLeave() {
    // All elements relax toward neutral.
    for (var i = 0; i < states.length; i++) {
      states[i].hovered = false;
    }
  }

  function tick() {
    for (var i = 0; i < states.length; i++) {
      var state = states[i];
      var el = elements[i];
      // When not hovered, target snaps to 0.5 (neutral center). Damping
      // smooths the relaxation back.
      var tx = state.hovered ? state.targetX : 0.5;
      var ty = state.hovered ? state.targetY : 0.5;
      state.currentX += (tx - state.currentX) * state.damping;
      state.currentY += (ty - state.currentY) * state.damping;

      if (state.type.indexOf('tilt') !== -1) {
        var rotY = (state.currentX - 0.5) * 2 * state.tiltStrength;
        var rotX = -(state.currentY - 0.5) * 2 * state.tiltStrength;
        // CSS var append-safe — exporter emits
        //   transform: <existing> var(--reframe-mouse-tilt, );
        // so existing rotation/flip transforms survive.
        el.style.setProperty(
          '--reframe-mouse-tilt',
          'rotateX(' + rotX.toFixed(3) + 'deg) rotateY(' + rotY.toFixed(3) + 'deg)',
        );
      }

      if (state.type.indexOf('glow') !== -1) {
        el.style.setProperty('--reframe-mouse-x', (state.currentX * 100).toFixed(2) + '%');
        el.style.setProperty('--reframe-mouse-y', (state.currentY * 100).toFixed(2) + '%');
      }
    }
    requestAnimationFrame(tick);
  }

  function init() {
    var nodes = document.querySelectorAll('[data-reframe-interactive]');
    for (var i = 0; i < nodes.length; i++) attach(nodes[i]);
    if (states.length === 0) return;
    document.addEventListener('mousemove', onMouseMove);
    // capture-phase mouseleave on document so when cursor leaves the
    // window everything relaxes back. mouseleave bubbles only on the
    // direct target; capture lets us catch it at document level.
    document.addEventListener('mouseleave', onDocumentLeave, true);
    requestAnimationFrame(tick);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;

/**
 * CSS rules emitted once per scene that uses any interactive node.
 * Lives in a separate constant from BROWSER_SOURCE so the exporter can
 * inject it into the <style> block (CSS-in-JS at runtime would be
 * possible but adds complexity — static <style> is cleaner + cacheable).
 *
 * Glow rule uses ::before pseudo-element on the interactive node itself,
 * positioned absolutely with pointer-events:none so it doesn't block
 * clicks. The radial-gradient stops are tied to CSS vars set by the
 * runtime per-element.
 *
 * Tilt rule sets `transform: var(--reframe-mouse-tilt, none)` ONLY on
 * elements with no other transform — those are detected by the exporter
 * which emits inline transform on the element when needed (see exporter
 * note re append).
 */
export const MOUSE_REACTIVE_CSS = `
[data-reframe-interactive] {
  transition: none;
  transform-style: preserve-3d;
}
[data-reframe-interactive*="glow"] {
  position: relative;
  isolation: isolate;
}
[data-reframe-interactive*="glow"]::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle var(--reframe-glow-radius, 200px) at var(--reframe-mouse-x, 50%) var(--reframe-mouse-y, 50%),
    var(--reframe-glow-color, rgba(255,255,255,0.1)),
    transparent 70%
  );
  pointer-events: none;
  z-index: 1;
  border-radius: inherit;
}
`;

/** Allowed values for the data-reframe-interactive attribute — kept in lockstep with the InteractiveType union. */
export const KNOWN_INTERACTIVE_TYPES: ReadonlyArray<'mouse-tilt' | 'mouse-glow' | 'mouse-tilt-glow'> = [
  'mouse-tilt',
  'mouse-glow',
  'mouse-tilt-glow',
];

export function isKnownInteractiveType(s: string): s is 'mouse-tilt' | 'mouse-glow' | 'mouse-tilt-glow' {
  return KNOWN_INTERACTIVE_TYPES.indexOf(s as any) !== -1;
}
