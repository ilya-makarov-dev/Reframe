/**
 * CompositionRenderer — orchestrates 1..N full editor instances for a
 * SceneComposition. v1 handles 'single' and 'variants' kinds.
 *
 * Each column mounts a full createDOMCanvas (not a view-only iframe), so
 * every variant gets the same editor surface a stand-alone scene gets:
 * selection, drag-to-move, resize handles, inline text edit, zoom/pan,
 * present mode, per-scene Ctrl+Z via server-side history. Multi-mount
 * safety is provided by the canvas-dom registry (registry.ts) — each
 * DOMCanvas registers under its sceneId and global listeners (P-key,
 * Space-for-pan, parallax mousemove) gate on isFocused(hostId) so key
 * presses route to one instance, not all.
 *
 * Layout:
 *   kind='single'   → one DOMCanvas, fills host
 *   kind='variants' → N DOMCanvases in horizontal row, gap between, each
 *                     with its label above (when labels provided)
 *
 * Focus routing: each createDOMCanvas attaches a capture-phase click
 * listener inside its iframe (dom-canvas.ts) that promotes itself to
 * focused. We subscribe to the registry's onFocusChange and forward the
 * new sceneId to opts.onFocus — but ONLY when the focused host belongs
 * to this composition (ignoring focus events from canvases outside).
 *
 * Selection → inspector: each DOMCanvas fires opts.onCanvasSelect(sceneId,
 * ids) when its selection changes. The host wires this to the right-panel
 * inspector fetch. Because only the focused canvas drives the shared
 * inspector view, callers typically read the focused-scene's selection
 * from the last onCanvasSelect for that scene.
 */

import type { SceneRenderer, SceneRendererHandle } from './scene-renderer.js';
import { iframeSceneRenderer } from './scene-renderer.js';
import { createDOMCanvas } from './dom-canvas.js';
import { onFocusChange, type HostId } from './registry.js';

// Re-export the view-only iframe renderer for consumers (future galleries,
// thumbnails, non-editor preview surfaces) that don't need the full editor.
// Variants / flow / sampler use the full editor via createDOMCanvas below.
export { iframeSceneRenderer };
export type { SceneRenderer, SceneRendererHandle };

export interface CompositionDescriptor {
  kind: 'single' | 'variants';
  /** sceneIds to render. For 'single': length 1. For 'variants': length ≥ 2.
   *  Same value may repeat across cells (storage-backed variants render
   *  the same base scene N times across an axis Cartesian product). */
  sceneIds: string[];
  /** Optional per-cell host identifiers for the registry. When omitted,
   *  hostId === sceneId (legacy CSV mode). When provided, must be unique
   *  per cell — required for storage-backed variants where every cell
   *  shares one base sceneId so the registry doesn't collapse them.
   *  Must have the same length as sceneIds. */
  hostIds?: string[];
  /** Optional labels shown above each scene in 'variants' mode. */
  labels?: string[];
}

export interface CompositionRendererOptions {
  host: HTMLElement;
  composition: CompositionDescriptor;
  /** Gap between variants in pixels. Ignored for 'single'. */
  gap?: number;
  /**
   * Called when the registry's focused host changes to one of this
   * composition's scenes. External focus events (other canvases on the
   * page, if any) are filtered out before this fires.
   */
  onFocus?: (sceneId: string) => void;
  /**
   * Called when any variant's selection changes. Host wires this into the
   * shared right-panel inspector — typically the handler ignores events
   * from non-focused scenes, or uses the focused sceneId to decide which
   * scene's selection drives the current inspector view.
   */
  onCanvasSelect?: (sceneId: string, ids: string[]) => void;
}

export interface CompositionRendererHandle {
  /** sceneId → DOMCanvas returned by createDOMCanvas. */
  readonly canvases: ReadonlyMap<string, ReturnType<typeof createDOMCanvas>>;
  destroy(): void;
}

const DEFAULT_GAP = 40;

export function mountCompositionRenderer(
  opts: CompositionRendererOptions,
): CompositionRendererHandle {
  const { host, composition } = opts;
  const gap = opts.gap ?? DEFAULT_GAP;

  // Preserve the legacy #reframe-viewport element when we wipe the host.
  // Platform UI JS reads `document.querySelector('[data-session]')` as the
  // default way to find the active scene id (right panel, toolbar, tweaks
  // panel, bottom chat — 10+ readers). Destroying it would orphan every
  // one of those. Keep it invisible but attached, with its data-session
  // tracking the focused variant via the composition-focus subscriber.
  const preservedViewport = host.querySelector<HTMLElement>('#reframe-viewport');
  host.innerHTML = '';
  if (preservedViewport) {
    preservedViewport.style.display = 'none';
    host.appendChild(preservedViewport);
  }
  const rootStyle = host.style;
  rootStyle.display = 'flex';
  rootStyle.flexDirection = 'row';
  // 'stretch' so columns fill the canvas-area's full height — without
  // this, each column collapses to the height of its label (~23px) and
  // the scene host below the label gets 0 space, leaving iframes at the
  // browser default 150×270 with no scene content visible.
  rootStyle.alignItems = 'stretch';
  rootStyle.height = '100%';
  rootStyle.gap = `${gap}px`;

  const canvases = new Map<string, ReturnType<typeof createDOMCanvas>>();
  const ownedHostIds = new Set<HostId>();

  composition.sceneIds.forEach((sceneId, i) => {
    const column = document.createElement('div');
    column.className = 'rfd-composition-column';
    column.dataset.sceneId = sceneId;
    column.style.display = 'flex';
    column.style.flexDirection = 'column';
    column.style.gap = '8px';
    // Column fills available space proportionally when variant count > 1.
    // For single, caller's host sizing wins — the column sits naturally.
    column.style.flex = composition.kind === 'variants' ? '1 1 0' : '1 1 auto';
    column.style.minWidth = '0';

    if (composition.kind === 'variants' && composition.labels?.[i]) {
      const label = document.createElement('div');
      label.className = 'rfd-composition-label';
      label.textContent = composition.labels[i];
      label.style.font = "500 11px/1.4 'JetBrains Mono', ui-monospace, monospace";
      label.style.letterSpacing = '0.08em';
      label.style.textTransform = 'uppercase';
      label.style.color = 'var(--text-secondary, #6E6750)';
      column.appendChild(label);
    }

    const sceneHost = document.createElement('div');
    sceneHost.className = 'rfd-composition-scene-host';
    sceneHost.style.position = 'relative';
    sceneHost.style.flex = '1 1 auto';
    sceneHost.style.minHeight = '0';
    column.appendChild(sceneHost);
    host.appendChild(column);

    // Full editor per variant. Registry handles focus routing + global
    // listener gating automatically. hostId and sceneId can differ in
    // storage-backed variants (one base sceneId, N synthetic hostIds);
    // the iframe URL still loads the base scene via sceneId.
    const hostId = composition.hostIds?.[i] ?? sceneId;
    const canvas = createDOMCanvas({
      container: sceneHost,
      sceneId,
      hostId,
      compositionKind: composition.kind,
      onSelect: (ids) => opts.onCanvasSelect?.(sceneId, ids),
    });
    canvases.set(hostId, canvas);
    ownedHostIds.add(hostId);
  });

  // Forward focus events to the host only when they belong to this
  // composition. The registry is page-wide; another canvas somewhere else
  // might take focus, and we must not confuse the host with its sceneId.
  //
  // Note: the window-level reframe:composition-focus CustomEvent is
  // dispatched by registry.setFocused() itself — not here. That keeps the
  // invariant "focus changed → event fired" at a single code site and
  // covers every promote path (click bridge, future keyboard Tab, any
  // programmatic setFocused call). This local callback only bridges the
  // change into the CompositionRenderer's own onFocus option for hosts
  // that need it imperatively instead of via the window event.
  const unsubscribeFocus = onFocusChange((hostId) => {
    if (hostId !== null && ownedHostIds.has(hostId)) {
      opts.onFocus?.(hostId);
    }
  });

  return {
    canvases,
    destroy: () => {
      unsubscribeFocus();
      for (const canvas of canvases.values()) {
        try { canvas.destroy(); }
        catch (err) { console.warn('[composition-renderer] destroy threw', err); }
      }
      canvases.clear();
      ownedHostIds.clear();
      host.innerHTML = '';
    },
  };
}
