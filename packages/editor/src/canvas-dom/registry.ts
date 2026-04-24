/**
 * Multi-mount canvas registry.
 *
 * The DOM canvas was single-slot for months — window.__reframeDOMCanvas
 * lived as one global, the P-key listener was global, Space-for-pan was
 * global. That's fine when exactly one canvas mounts per page, which was
 * true until composition primitives (variants / flow / sampler / overlay)
 * started requiring N parallel editor instances on one page.
 *
 * This registry lets N DOMCanvas instances coexist:
 *   - Each instance registers under a unique hostId (the scene id).
 *   - The registry tracks which hostId is "focused" (last-clicked).
 *   - Global listeners (P-key, Space, parallax) check isFocused(hostId)
 *     before acting, so a keypress routes to one instance, not all.
 *   - Legacy globals (__reframeDOMCanvas, __reframeEditor) keep working
 *     as lazy getters pointing at the focused instance — 9 platform-UI
 *     JS files read them, and rewriting each is out of scope for Week 1.
 *     The shim is installed by platform-bootstrap.ts once.
 *
 * Ownership contract:
 *   - registerCanvas() returns an unregister function; callers MUST
 *     call it on destroy to avoid leaking references.
 *   - The first-registered hostId becomes focused by default.
 *   - Unregistering the focused host promotes the next available host
 *     to focus (Map iteration order = insertion order).
 */

// Minimal shape we need from createDOMCanvas's return type. Kept as a
// structural interface so the registry doesn't pull in the full
// createDOMCanvas typing (which would create a circular import). Type-
// only import of PresentModeController avoids runtime circular — TS
// erases type-only imports after checking.
import type { PresentModeController } from './present.js';

export interface DOMCanvasHandle {
  reload: () => void | Promise<void>;
  select: (ids: string | string[] | null) => void;
  present: PresentModeController;
  zoom: {
    getZoom: () => number;
    setZoom: (z: number) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    zoomTo100: () => void;
    zoomToFit: () => void;
    onChange: (fn: (z: number) => void) => () => void;
    levels: readonly number[];
  };
  postToIframe: (message: unknown) => boolean;
  destroy: () => void;
}

export type HostId = string;

/** Composition kind the canvas is mounted under. 'single' for stand-alone
 *  scene pages; non-'single' kinds come from CompositionRenderer. Shell
 *  subscribers can use this to differentiate UI per kind (step-panel for
 *  flow, column-panel for variants, etc.) or ignore 'single' if their
 *  legacy URL-based path already covers it. */
export type CompositionKind = 'single' | 'variants' | 'flow' | 'sampler' | 'overlay' | 'component';

export interface RegisterOptions {
  sceneId?: string;
  brand?: string;
  compositionKind?: CompositionKind;
}

interface Entry {
  hostId: HostId;
  canvas: DOMCanvasHandle;
  sceneId: string;
  brand: string | null;
  compositionKind: CompositionKind;
}

const instances = new Map<HostId, Entry>();
let focusedHostId: HostId | null = null;
const focusSubscribers = new Set<(hostId: HostId | null) => void>();

/**
 * Register a canvas under the given hostId. Returns an unregister
 * function. If no canvas is currently focused, the newly-registered
 * one becomes focused.
 *
 * Metadata (sceneId, brand, compositionKind) rides with the handle so
 * setFocused() can put it on the reframe:composition-focus event detail
 * — shell subscribers re-fetch scene data without a second lookup.
 */
export function registerCanvas(
  hostId: HostId,
  canvas: DOMCanvasHandle,
  meta: RegisterOptions = {},
): () => void {
  if (instances.has(hostId)) {
    console.warn(`[canvas-dom/registry] overwriting existing canvas for hostId="${hostId}"`);
  }
  instances.set(hostId, {
    hostId,
    canvas,
    sceneId: meta.sceneId ?? hostId,
    brand: meta.brand ?? null,
    compositionKind: meta.compositionKind ?? 'single',
  });
  if (focusedHostId === null) {
    focusedHostId = hostId;
    notifyFocus();
  }
  return () => unregisterCanvas(hostId);
}

function unregisterCanvas(hostId: HostId): void {
  instances.delete(hostId);
  if (focusedHostId === hostId) {
    const next = instances.keys().next();
    focusedHostId = next.done ? null : next.value;
    notifyFocus();
  }
}

/** Promote a host to focused. Silent no-op if hostId not registered
 *  OR if already focused (prevents event storms from repeated clicks on
 *  the same canvas). Fires `reframe:composition-focus` on window with
 *  the focused entry's metadata for shell subscribers. Every focus-flip
 *  path (click bridge, future keyboard Tab, programmatic promote) goes
 *  through here, so the invariant "focus changed → event fired" holds
 *  at exactly one code site. */
export function setFocused(hostId: HostId): void {
  if (!instances.has(hostId)) return;
  if (focusedHostId === hostId) return;
  focusedHostId = hostId;
  notifyFocus();

  const entry = instances.get(hostId);
  if (entry) {
    try {
      window.dispatchEvent(
        new CustomEvent('reframe:composition-focus', {
          detail: {
            hostId: entry.hostId,
            sceneId: entry.sceneId,
            brand: entry.brand,
            compositionKind: entry.compositionKind,
          },
        }),
      );
    } catch (err) {
      // Non-browser environments (Node tests) don't have window; swallow.
      if (typeof window !== 'undefined') {
        console.warn('[canvas-dom/registry] composition-focus dispatch threw', err);
      }
    }
  }
}

export function getFocusedHostId(): HostId | null {
  return focusedHostId;
}

export function getFocusedCanvas(): DOMCanvasHandle | null {
  if (focusedHostId === null) return null;
  return instances.get(focusedHostId)?.canvas ?? null;
}

export function getCanvas(hostId: HostId): DOMCanvasHandle | null {
  return instances.get(hostId)?.canvas ?? null;
}

export function getAllCanvases(): DOMCanvasHandle[] {
  const out: DOMCanvasHandle[] = [];
  for (const { canvas } of instances.values()) out.push(canvas);
  return out;
}

/**
 * Predicate used by global listeners (P-key, Space, parallax) to gate
 * their effect. Keypress handled by every instance's listener, but only
 * the focused instance acts.
 */
export function isFocused(hostId: HostId): boolean {
  return focusedHostId === hostId;
}

/**
 * Subscribe to focus changes. Useful for the Platform UI shell to update
 * its "which variant is active" indicator without polling.
 */
export function onFocusChange(fn: (hostId: HostId | null) => void): () => void {
  focusSubscribers.add(fn);
  return () => { focusSubscribers.delete(fn); };
}

function notifyFocus(): void {
  for (const fn of focusSubscribers) {
    try { fn(focusedHostId); }
    catch (err) { console.warn('[canvas-dom/registry] focus subscriber threw', err); }
  }
}

/**
 * Install the legacy global shim once on page load. Called by
 * platform-bootstrap.ts before the first canvas mounts. After this,
 *   window.__reframeDOMCanvas  → focused canvas (read-only)
 *   window.__reframeEditor     → focused canvas (read-only; alias)
 * External JS (145-zoom-pill, 115-tweaks-panel, etc.) keeps working
 * unchanged as long as they only READ these globals. Any caller that
 * WROTE to them is a bug from before the multi-mount era and should
 * be fixed to use registerCanvas() instead.
 */
export function installLegacyGlobalShim(): void {
  const win = window as any;
  if (win.__reframe_shim_installed) return;
  win.__reframe_shim_installed = true;

  const descriptor: PropertyDescriptor = {
    get: () => getFocusedCanvas(),
    configurable: true,
    enumerable: false,
  };
  try {
    Object.defineProperty(win, '__reframeDOMCanvas', descriptor);
    Object.defineProperty(win, '__reframeEditor', descriptor);
  } catch (err) {
    // If another module already set these as non-configurable, fall back
    // to direct assignment of the current focused canvas. Lose the
    // lazy-focused behavior but keep backward-compat with the reads.
    console.warn('[canvas-dom/registry] legacy shim failed to install as getter', err);
    win.__reframeDOMCanvas = getFocusedCanvas();
    win.__reframeEditor = getFocusedCanvas();
  }
}
