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
import { installLegacyGlobalShim, getFocusedCanvas } from '../canvas-dom/registry.js';
import { mountCompositionRenderer, type CompositionRendererHandle } from '../canvas-dom/composition-renderer.js';
import { mountFlowRenderer, type FlowRendererHandle } from '../canvas-dom/flow-renderer.js';
import { mountSamplerRenderer, type SamplerRendererHandle } from '../canvas-dom/sampler-renderer.js';
import { mountOverlayRenderer, type OverlayRendererHandle } from '../canvas-dom/overlay-renderer.js';

let domCanvas: ReturnType<typeof createDOMCanvas> | null = null;
let compositionHandle: CompositionRendererHandle | null = null;
let flowHandle: FlowRendererHandle | null = null;
let samplerHandle: SamplerRendererHandle | null = null;
let overlayHandle: OverlayRendererHandle | null = null;

/**
 * Mount the DOM canvas. Entry point called by `/platform/viewport.js`
 * (see `packages/mcp/src/platform/router.ts` — the 2-line bootstrap
 * script that runs on every editor page load).
 */
export async function initPlatformViewport(): Promise<void> {
  // Install legacy global shim before any canvas mounts. After this
  // `window.__reframeDOMCanvas` / `__reframeEditor` are lazy getters
  // pointing at the focused canvas in the registry — 9 platform UI JS
  // files (zoom-pill, tweaks-panel, toolbar, widgets, inline-popover,
  // init, etc.) read these globals unchanged. New code should use
  // registry.getFocusedCanvas() / getCanvas(hostId) directly.
  installLegacyGlobalShim();

  const canvasEl = document.getElementById('reframe-viewport');
  const container = canvasEl?.parentElement;
  if (!container) return;

  // T3 #12 — paper-frame editor-mode body class. Scopes the desk-
  // surface background (off-white + soft radial gradients) to the
  // editor view only. Dashboard / project-list / other Platform UI
  // surfaces don't reach this bootstrap path, so they keep their own
  // background. The class drives the body.reframe-editor-mode rule
  // in platform-ui.css.
  document.body.classList.add('reframe-editor-mode');

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

  // Variants URL param: `?variants=a,b,c` mounts a CompositionRenderer
  // over pre-existing scene ids instead of a single DOMCanvas. The
  // caller is responsible for having compiled those scenes beforehand;
  // unknown scene ids render as empty iframes in their column (404 from
  // /preview fetch is non-fatal — the column stays visible as a
  // placeholder). Demo mode for Week 1 exit criteria.
  const urlParams = new URL(window.location.href).searchParams;
  const variantsParam = urlParams.get('variants');
  const rawVariantIds = variantsParam
    ? variantsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  // Duplicate-id guard. `?variants=hero,hero,hero` (typo, bad paste, or
  // naive attack) would, without this, register two canvases under the
  // same hostId — registry.ts warns and the second mount clobbers the
  // first, orphaning iframes and leaking listeners. Same class of bug
  // we throw on in variants-compile (compile.variants.duplicate_name).
  // Dedupe + warn here instead of throw — URL params are user-typed, not
  // API calls; a soft fallback beats a hard crash on a typo.
  const variantSceneIds = Array.from(new Set(rawVariantIds));
  if (variantSceneIds.length !== rawVariantIds.length) {
    console.warn(
      '[platform-bootstrap] ?variants contained duplicate sceneIds; deduped to ' +
      JSON.stringify(variantSceneIds),
    );
  }

  // Shared onSelect bridge — same event shape for single-scene and
  // variants modes. Right-panel inspector + LAYERS rail listen for the
  // canvas-select event; they don't care which DOMCanvas fired it because
  // the registry's focused-canvas shim keeps the globals pointing at the
  // right instance.
  const dispatchCanvasSelect = (ids: string[]) => {
    const primary = ids.length > 0 ? ids[0] : null;
    window.dispatchEvent(new CustomEvent('reframe:canvas-select', {
      detail: { nodeId: primary, multi: ids.length > 1 },
    }));
    if (primary) {
      window.dispatchEvent(new CustomEvent('reframe:ui-state-changed', {
        detail: { selectedNodeIds: ids },
      }));
    }
  };

  // Flow URL: ?flow=<flowId>&step=<n> — mount a flow composition by
  // fetching its spec from the server, then render all step scenes with
  // CSS display-gated switching. Flow wins over variants when both
  // present (they're mutually exclusive composition kinds; unlikely
  // combo but deterministic winner avoids ambiguity).
  const flowParam = urlParams.get('flow');
  if (flowParam) {
    const stepParam = urlParams.get('step');
    const initialStep = stepParam ? Math.max(0, parseInt(stepParam, 10) || 0) : 0;
    try {
      const resp = await fetch(`/platform/api/flow/${encodeURIComponent(flowParam)}`);
      if (resp.ok) {
        const { spec } = await resp.json() as { spec: {
          flowId: string;
          stepSceneIds: string[];
          transitions: Array<{ from: number; to: number; label?: string }>;
        } };
        if (spec?.stepSceneIds?.length >= 2) {
          flowHandle = mountFlowRenderer({
            host: container,
            flowId: spec.flowId,
            steps: spec.stepSceneIds.map((sceneId) => ({ sceneId })),
            transitions: spec.transitions,
            initialStep,
            onCanvasSelect: (sceneId, ids) => {
              const focused = getFocusedCanvas();
              const selfCanvas = flowHandle?.canvases.get(sceneId);
              if (focused === selfCanvas) dispatchCanvasSelect(ids);
            },
            onStepChange: async (_index, _sceneId) => {
              // Persist step position server-side so refresh restores it.
              try {
                await fetch(`/platform/api/flow/${encodeURIComponent(flowParam)}/transition`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ to: _index }),
                });
              } catch (err) {
                console.warn('[platform-bootstrap] flow transition persist failed', err);
              }
            },
          });
          // Keep LAYERS rail handler reachable; skip single-scene branch.
          window.addEventListener('reframe:layer-select', ((evt: CustomEvent) => {
            const nodeId = evt.detail?.nodeId;
            if (!nodeId) return;
            const target = getFocusedCanvas();
            if (target) target.select(nodeId);
          }) as EventListener);
          installCompositionFocusSubscriber();
          return;
        }
      }
      console.warn(`[platform-bootstrap] flow "${flowParam}" not found or malformed — falling through to single-scene mode`);
    } catch (err) {
      console.warn('[platform-bootstrap] flow fetch failed — falling through', err);
    }
  }

  // Sampler URL: ?sampler=<samplerId> — mount a sampler composition by
  // fetching its spec + cell envelopes from the server, then rendering
  // each cell as an SVG skeleton (upgrade-on-click via SamplerRenderer).
  // Sampler wins over variants when both present, falls through to
  // single-scene if spec not found or empty.
  const samplerParam = urlParams.get('sampler');
  if (samplerParam) {
    try {
      const [specResp, cellsResp] = await Promise.all([
        fetch(`/platform/api/sampler/${encodeURIComponent(samplerParam)}`),
        fetch(`/platform/api/sampler/${encodeURIComponent(samplerParam)}/cells`),
      ]);
      if (specResp.ok && cellsResp.ok) {
        const { spec } = await specResp.json() as { spec: {
          samplerId: string;
          cellSceneIds: string[];
          grid: { columns: number; rows?: number; gap?: number; cellWidth?: number; cellHeight?: number; labels?: string[] };
        } };
        const { cells } = await cellsResp.json() as { cells: Array<{
          index: number;
          slug: string;
          envelope: any;
          skeletonSvg: string | null;
        }> };
        if (spec?.cellSceneIds?.length >= 4 && cells?.length === spec.cellSceneIds.length) {
          // Skeleton SVG was rendered server-side — see sampler-api.ts
          // for the rationale. Client just paints what arrives. Empty /
          // failed cell falls back to a neutral placeholder rect.
          const cellDescriptors = cells.map((c) => ({
            sceneId: c.slug,
            label: spec.grid.labels?.[c.index],
            skeletonSvg:
              c.skeletonSvg ??
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f0f0f0"/><text x="50" y="55" text-anchor="middle" font-size="10" fill="#a0a0a0">missing</text></svg>',
          }));
          samplerHandle = mountSamplerRenderer({
            host: container,
            samplerId: spec.samplerId,
            cells: cellDescriptors,
            grid: spec.grid,
            onCanvasSelect: (sceneId, ids) => {
              const focused = getFocusedCanvas();
              const selfCanvas = samplerHandle?.canvases.get(`${spec.samplerId}-cell-${spec.cellSceneIds.indexOf(sceneId)}`);
              if (focused === selfCanvas) dispatchCanvasSelect(ids);
            },
          });
          window.addEventListener('reframe:layer-select', ((evt: CustomEvent) => {
            const nodeId = evt.detail?.nodeId;
            if (!nodeId) return;
            const target = getFocusedCanvas();
            if (target) target.select(nodeId);
          }) as EventListener);
          installCompositionFocusSubscriber();
          return;
        }
      }
      console.warn(`[platform-bootstrap] sampler "${samplerParam}" not found or malformed — falling through to single-scene mode`);
    } catch (err) {
      console.warn('[platform-bootstrap] sampler fetch failed — falling through', err);
    }
  }

  // Overlay URL: ?overlay=<overlayId> — mount a base scene iframe + N
  // peer-element <canvas> layers driven by RAF. The renderer fetches
  // its own spec + runtime source from /platform/api/overlay/:id, so
  // we just hand it the host element and let it build.
  const overlayParam = urlParams.get('overlay');
  if (overlayParam) {
    try {
      overlayHandle = await mountOverlayRenderer({
        host: container,
        overlayId: overlayParam,
      });
      installCompositionFocusSubscriber();
      return;
    } catch (err) {
      console.warn(`[platform-bootstrap] overlay "${overlayParam}" mount failed — falling through to single-scene`, err);
    }
  }

  if (variantSceneIds.length >= 2) {
    // Variants mode — mount N full DOMCanvases via CompositionRenderer.
    // Labels default to the sceneIds themselves; host can override via
    // future query param or page data-attribute.
    compositionHandle = mountCompositionRenderer({
      host: container,
      composition: {
        kind: 'variants',
        sceneIds: variantSceneIds,
        labels: variantSceneIds.map((id) => id),
      },
      onCanvasSelect: (_sceneId, ids) => {
        // Only forward selection from the currently-focused variant to
        // avoid inspector flicker on background re-layouts.
        const focused = getFocusedCanvas();
        const selfCanvas = compositionHandle?.canvases.get(_sceneId);
        if (focused === selfCanvas) dispatchCanvasSelect(ids);
      },
      // onFocus imperative callback is no longer needed — the window
      // event `reframe:composition-focus` is dispatched by registry.setFocused
      // with full detail (hostId + sceneId + brand + compositionKind),
      // and installCompositionFocusSubscriber() below listens for it.
      // Leaving onFocus undefined avoids a double-fire.
    });
  } else {
    // Single-scene mode — unchanged from pre-multi-mount behavior.
    domCanvas = createDOMCanvas({
      container,
      sceneId,
      onSelect: dispatchCanvasSelect,
    });
  }

  // LAYERS rail click → canvas selection. Routes to the focused canvas
  // in multi-mount mode (registry shim resolves __reframeDOMCanvas to
  // focused). Falls back to the single-scene handle in single mode.
  window.addEventListener('reframe:layer-select', ((evt: CustomEvent) => {
    const nodeId = evt.detail?.nodeId;
    if (!nodeId) return;
    const target = getFocusedCanvas() ?? domCanvas;
    if (target) target.select(nodeId);
  }) as EventListener);

  installCompositionFocusSubscriber();

  // Legacy globals are served by the shim installed above — `window
  // .__reframeDOMCanvas` and `window.__reframeEditor` are configured as
  // lazy getters that return the focused canvas from the registry. No
  // direct assignment needed here (used to be two writes; now the
  // registry is the single source of truth, which matters when N
  // canvases mount for variants/flow/sampler compositions).
}

/** Legacy getter retained for backward compat; returns the DOM canvas. */
export function getEditorShell(): ReturnType<typeof createDOMCanvas> | null {
  return domCanvas;
}

/**
 * Composition focus → shell sync. Extracted so the flow branch can
 * install it on the early-return path. Single-scene and variants paths
 * also install it at the end of initPlatformViewport. Idempotent via
 * __reframeCompositionFocusInstalled guard — subsequent calls are no-op.
 *
 * When the focused scene/step/variant changes, update the legacy
 * [data-session] attribute + state globals that Platform UI reads to
 * fetch scene data. Every existing code path (right panel, layers rail,
 * toolbar, tweaks, bottom chat) reads:
 *
 *     state.currentSceneId || document.querySelector('[data-session]').getAttribute('data-session')
 *
 * Updating this single attribute makes them all resolve the focused
 * variant/step. Single-scene pages never fire this event (registry only
 * emits on actual focus CHANGE).
 */
function installCompositionFocusSubscriber(): void {
  const flag = '__reframeCompositionFocusInstalled';
  if ((window as any)[flag]) return;
  (window as any)[flag] = true;
  window.addEventListener('reframe:composition-focus', ((evt: CustomEvent) => {
    const detail = evt.detail;
    if (!detail?.sceneId) return;
    const canvasEl = document.getElementById('reframe-viewport');
    if (canvasEl) canvasEl.setAttribute('data-session', detail.sceneId);
    const stateGlobal = (window as any).state;
    if (stateGlobal) stateGlobal.currentSceneId = detail.sceneId;
    window.dispatchEvent(new CustomEvent('reframe:canvas-select', {
      detail: { nodeId: null, multi: false },
    }));
  }) as EventListener);
}
