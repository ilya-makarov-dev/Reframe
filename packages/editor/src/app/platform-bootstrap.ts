/**
 * Platform Bootstrap — DOM canvas only.
 *
 * As of 2026-04-22 reframe ships the DOM canvas (iframe + HTML exporter
 * + CSS 3D transforms) as its ONLY editor backend. The legacy
 * `@open-pencil/core` / CanvasKit / Skia path was deprecated after Phase
 * 2 + 2c + Phase 3 shipped, then removed wholesale in the same release
 * to stop maintaining two code paths (see Fix log entry
 * 2026-04-22 `architecture/op-removal-B-C`).
 *
 * This file now has one responsibility: mount the DOM canvas into the
 * `/platform/project/:slug` page's `#canvas-area` grid cell and bridge
 * its selection events out to the Platform UI (LAYERS rail, right
 * panel, bottom chat). The actual scene rendering, zoom/pan, selection
 * overlay, drag-to-move/resize, inline text editing, incremental DOM
 * patch, and present mode all live in `canvas-dom/`.
 */

import { createDOMCanvas } from '../canvas-dom/index.js';

let domCanvas: ReturnType<typeof createDOMCanvas> | null = null;

/**
 * Mount the DOM canvas. Entry point called by `/platform/viewport.js`
 * (see `packages/mcp/src/platform/router.ts` — the 2-line bootstrap
 * script that runs on every editor page load).
 */
export async function initPlatformViewport(): Promise<void> {
  const canvasEl = document.getElementById('reframe-viewport');
  const container = canvasEl?.parentElement;
  if (!container) return;

  // Hide the legacy <canvas id="reframe-viewport"> — other scripts
  // may query for it by id, so we leave the element in the DOM but
  // make it non-rendering. The host page keeps its grid dimensions via
  // the surrounding `#canvas-area` container.
  if (canvasEl) (canvasEl as HTMLElement).style.display = 'none';

  // Pre-Phase-2 the editor shell shipped a `#loading` overlay (z-index:
  // 100) that waited for the OP editor's `reframe:ready` event before
  // hiding. That event's sender is gone; hide the loader synchronously.
  const loader = document.getElementById('loading');
  if (loader) loader.style.display = 'none';

  const sceneId = (canvasEl as HTMLElement | null)?.dataset?.session
    ?? new URL(window.location.href).pathname.split('/').pop()
    ?? '';

  domCanvas = createDOMCanvas({
    container,
    sceneId,
    onSelect: (ids) => {
      // Right-panel `/api/node/get` handler takes a single node id;
      // pass the PRIMARY (first-clicked) node. Multi-select is signalled
      // via the `multi` flag so LAYERS + chip row can render a badge
      // without fetching per-node data for each.
      const primary = ids.length > 0 ? ids[0] : null;
      window.dispatchEvent(new CustomEvent('reframe:canvas-select', {
        detail: { nodeId: primary, multi: ids.length > 1 },
      }));
      if (primary) {
        window.dispatchEvent(new CustomEvent('reframe:ui-state-changed', {
          detail: { selectedNodeIds: ids },
        }));
      }
    },
  });

  // LAYERS rail click → canvas selection. Same bridge OP used.
  window.addEventListener('reframe:layer-select', ((evt: CustomEvent) => {
    const nodeId = evt.detail?.nodeId;
    if (nodeId && domCanvas) domCanvas.select(nodeId);
  }) as EventListener);

  // Expose for devtools + `reframe_ui probe` scripts (the MCP UI
  // automation that Platform-UI tests use). Same shape as the prior
  // `window.__reframeDOMCanvas` from the dual-path era; alias
  // `__reframeEditor` kept for QA scripts that predate the split.
  (window as any).__reframeDOMCanvas = domCanvas;
  (window as any).__reframeEditor = domCanvas;
}

/** Legacy getter retained for backward compat; returns the DOM canvas. */
export function getEditorShell(): ReturnType<typeof createDOMCanvas> | null {
  return domCanvas;
}
