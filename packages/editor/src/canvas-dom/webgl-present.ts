/**
 * Phase 3 — WebGL-composed "present mode" scaffold.
 *
 * Long-term plan (not implemented yet, flagged for when Chromium stabilizes
 * the `texElementImage2D` / `canvas-draw-element` API out of experimental):
 *
 *   DOM edit mode      →  Phase 2 (this package, iframe + overlays)
 *   Present / cinema   →  Phase 3 (this file) — wraps the Phase 2 iframe
 *                         into a WebGL canvas via `gl.texElementImage2D`,
 *                         lifting the DOM onto a textured quad so shaders
 *                         (flash-through-white, film-grain, 3D camera,
 *                         depth-of-field, chromatic aberration) composite
 *                         on top without breaking the underlying edit surface.
 *   Stable ship        →  Phase 4, when the API lands without a flag.
 *
 * Reference: https://github.com/fimbox/html-in-canvas — that repo is a
 * bug-repro for PlayCanvas + soft-body-physics; THIS file is our own
 * independent integration of the same underlying Chromium API, targeted
 * at reframe's present-mode without the PlayCanvas / Ammo stack. Unlike
 * the reference, we don't need physics — just a textured quad, camera
 * transform, and transition shaders.
 *
 * Current file: detection only. Feature-flagged so the rest of Phase 2
 * doesn't depend on it. `isTexElementAvailable()` returns false today
 * on every shipping Chrome without the flag, which is the correct
 * default — users must enable `chrome://flags/#canvas-draw-element`
 * (or we wait for stable) before any 3D present mode turns on.
 */

/**
 * Returns true when the current WebGL context exposes
 * `texElementImage2D` — the browser-hosted DOM→texture API.
 * As of 2026-04, Chromium ships this behind a flag only.
 */
export function isTexElementAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') as any;
    if (!gl) return false;
    return typeof gl.texElementImage2D === 'function'
      || typeof gl.texElementImage === 'function';
  } catch {
    return false;
  }
}

/**
 * Stub signal: when the API is available, return the function handle so
 * callers can go through the Phase-3 pipeline. Returning null → callers
 * must fall back to Phase 2's plain iframe rendering (the default today).
 */
export function getTexElementFunction(): ((target: number, level: number, element: Element) => void) | null {
  if (!isTexElementAvailable()) return null;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') as any;
    const fn: Function | undefined = gl.texElementImage2D ?? gl.texElementImage;
    return fn ? fn.bind(gl) : null;
  } catch {
    return null;
  }
}

/**
 * Architectural placeholder for the eventual `createPresentMode` factory.
 * Not implemented — callers should check `isTexElementAvailable()` first
 * and gracefully degrade.
 *
 * When Phase 3 is built out, the factory will:
 *   1. Take the Phase 2 iframe + DOM canvas as input
 *   2. Create a WebGL2 canvas sibling in the viewport
 *   3. Each frame: `gl.texElementImage2D(GL_TEXTURE_2D, 0, iframeElement)`
 *   4. Render the textured quad with a configurable camera matrix
 *      and an optional shader (transition, grain, CRT, depth blur)
 *   5. Toggle visibility between the edit iframe and the WebGL quad
 *      so user can flip between edit / present with one key.
 */
export function createPresentMode(_opts: unknown): null {
  // Intentionally no-op. See long-term plan above.
  return null;
}
