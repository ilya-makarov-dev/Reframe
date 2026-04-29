/**
 * DOM canvas orchestrator — Phase 2 + 3 editor foundation.
 *
 * Composes: iframe renderer + zoom/pan + selection overlay + pointer
 * hit-test + drag writeback (move / resize) + multi-select + inline
 * text edit + incremental patch + Phase 3 present-mode toggle.
 *
 * Key design calls — committed here:
 *   1. Iframe `srcdoc` for CSS isolation + true 1:1 with HTML export.
 *   2. Incremental DOM patch on SSE `scene:session-changed` with a
 *      matching `data-reframe-inode` → local style mutation; full
 *      reload only on structural events (add/delete/reparent).
 *   3. Selection overlay in a transform-synced sibling so bbox+handles
 *      track zoom/pan perfectly.
 *   4. Mutations → POST `/platform/api/node/edit` — same path as OP
 *      canvas. Server runs `ensureSceneLayout`, SSE broadcasts, we
 *      incremental-patch. One-way data flow.
 *   5. Present mode (Phase 3) wraps the existing iframe in CSS 3D
 *      perspective transforms + filter stack — no renderer swap.
 *      Keybind `P` toggles; Escape exits; arrow keys rotate; 1-5
 *      switch camera presets.
 */

import { createSceneRenderer } from './renderer.js';
import { createZoomPan, ZOOM_LEVELS, type ZoomPanState } from './zoom-pan.js';
import { createSelectionOverlay, type SelectionRect, type HandlePosition } from './overlay.js';
import { hitTest } from './pointer.js';
import { createPresentMode, type PresentModeController } from './present.js';
import { registerCanvas, setFocused, isFocused, type DOMCanvasHandle, type CompositionKind } from './registry.js';
import {
  createSelectionState,
  setSelection as stateSetSelection,
  toggleInSelection,
  addToSelection,
  clearSelection as stateClearSelection,
  setHovered,
  applyMarqueeResult,
  selectionAsArray,
  type NodeId,
} from './selection-state.js';
import { createMarqueeSelector } from './marquee-select.js';
import { attachKeyboardNav } from './keyboard-nav.js';
import { createInlineTextEditor, isLeafTextElement } from './inline-text-edit.js';
import { createMiniToolbar } from './mini-toolbar.js';

export interface DOMCanvasOptions {
  container: HTMLElement;
  sceneId: string;
  projectSlug?: string;
  onSelect?: (ids: string[]) => void;
  /**
   * Unique key in the multi-mount registry. Defaults to sceneId, which
   * works unless two canvases in one page show the same scene (variants
   * / flow of the same scene — rare, but the option is here for it).
   * Global listeners (P-key, Space pan, parallax) gate on
   * isFocused(hostId) so keypresses route to one instance, not all.
   */
  hostId?: string;
  /**
   * Composition kind this canvas participates in. Propagated to the
   * registry and into the reframe:composition-focus event detail so
   * shell subscribers can route UI by kind. Defaults to 'single'.
   */
  compositionKind?: CompositionKind;
  /** Optional brand slug for the scene. Appears in focus event detail. */
  brand?: string;
}

export function createDOMCanvas(opts: DOMCanvasOptions): {
  reload: () => void;
  select: (ids: string | string[] | null) => void;
  present: PresentModeController;
  zoom: {
    /** Snapped to {@link ZOOM_LEVELS}. `1` = 100%. */
    getZoom: () => number;
    setZoom: (z: number) => void;
    zoomIn: () => void;
    zoomOut: () => void;
    zoomTo100: () => void;
    zoomToFit: () => void;
    /** Subscribe to zoom / pan updates. Returns unsubscribe. */
    onChange: (fn: (zoom: number) => void) => () => void;
    /** Snapping ticks the picker can round to (e.g. 0.25, 0.5, 1, 2, 4). */
    levels: readonly number[];
  };
  /**
   * Send an arbitrary message to the iframe's preview-inject script.
   * Used by live UX surfaces (tweak sliders, viewport mode switches) to
   * push state changes into the iframe without a full reload. The iframe
   * listens for `event.source === window.parent`; messages tagged with
   * `source: 'reframe-parent'` are routed by the inject's dispatcher.
   *
   * Returns true if the iframe was reachable; false on first paint when
   * the contentWindow isn't yet available (caller can queue + retry).
   */
  postToIframe: (message: unknown) => boolean;
  destroy: () => void;
} {
  const hostId = opts.hostId ?? opts.sceneId;

  const viewport = document.createElement('div');
  viewport.className = 'rfd-canvas-viewport';
  Object.assign(viewport.style, {
    position: 'relative',
    width: '100%', height: '100%',
    overflow: 'hidden',
    background: 'var(--surface-canvas, #e8e2d0)',
  });
  opts.container.appendChild(viewport);

  const wrapper = document.createElement('div');
  wrapper.className = 'rfd-canvas-wrapper';
  Object.assign(wrapper.style, {
    position: 'absolute',
    left: '0', top: '0',
    willChange: 'transform',
  });
  viewport.appendChild(wrapper);

  // ── Selection state ────────────────────────────────────────
  // Phase 1 UI-2: state is now a SelectionState container
  // (Set<NodeId> + primaryId + hoveredId). The legacy `selection`
  // array shape is recomputed via selectionAsArray for callers
  // (drag/resize loops, overlay union, postEdit fan-out) that still
  // expect array semantics.
  const selState = createSelectionState();

  // ── Server writeback (hoisted) ─────────────────────────────
  // Declared before consumer (inline editor) so the controller can
  // capture a stable reference at construction time. Pure closure;
  // no internal state besides opts.sceneId.
  const postEdit = async (nodeId: string, props: Record<string, unknown>) => {
    try {
      await fetch('/platform/api/node/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: opts.sceneId, nodeId, props }),
      });
    } catch (err) {
      console.warn('[canvas-dom] postEdit failed', err);
    }
  };
  let currentZoom: ZoomPanState = { zoom: 1, panX: 0, panY: 0 };

  // Track scene-root dims for zoom-to-fit + transform math.
  let sceneRootBbox: { w: number; h: number } | null = null;

  const overlay = createSelectionOverlay({
    container: viewport,
    onHandleDrag: (which, dx, dy, phase) => {
      handleResizeDrag(which, dx, dy, phase);
    },
  });

  const renderer = createSceneRenderer({
    container: wrapper,
    sceneId: opts.sceneId,
    onLoad: (iframe) => {
      const rootEl = iframe.contentDocument?.body.firstElementChild as HTMLElement | null;
      if (rootEl) {
        const bbox = rootEl.getBoundingClientRect();
        sceneRootBbox = { w: bbox.width, h: bbox.height };
        if (!initialFitDone) {
          zoomPan.zoomToFit(bbox.width, bbox.height);
          initialFitDone = true;
        }
      }
      attachIframeHandlers(iframe);
      // Re-sync overlay with whatever is selected (full reload case).
      refreshSelectionOverlay();
    },
  });

  let initialFitDone = false;

  // Subscribers added via the public `zoom.onChange` API — any external
  // UI (e.g. the floating zoom pill in the shell) that needs to reflect
  // zoom changes registers here and gets called after every transform.
  const zoomSubscribers = new Set<(z: number) => void>();
  const zoomPan = createZoomPan({
    wrapper,
    viewport,
    // Multi-mount gate: Space-for-pan is a window-global keydown; without
    // this predicate, holding Space would toggle pan mode on every mounted
    // canvas simultaneously. With it, only the focused instance responds.
    isFocused: () => isFocused(hostId),
    onChange: (state) => {
      currentZoom = state;
      overlay.syncTransform(state.zoom, state.panX, state.panY);
      for (const fn of zoomSubscribers) fn(state.zoom);
    },
  });

  // Phase 1 UI-2 — marquee selection. Mounted on the parent viewport
  // (not inside the iframe) so the dashed rectangle paints over the
  // canvas chrome cleanly. The empty-space gate forwards to hitTest
  // inside the iframe; cursor-on-INode → no marquee, single click runs.
  const marquee = createMarqueeSelector({
    viewport,
    getIframe: () => renderer.iframe,
    isEmptyAt: (clientX, clientY) => {
      const doc = renderer.iframe.contentDocument;
      if (!doc) return false;
      // Gate also bails out when present mode is active — marquee
      // doesn't make sense over a camera-animated scene.
      if (presentMode.isActive()) return false;
      const result = hitTest(doc, clientX, clientY);
      // Treat the scene root as "empty" so marquees that start over
      // the root frame (very common — body fills the canvas) still
      // work as expected.
      if (!result) return true;
      const rootEl = doc.body.firstElementChild as HTMLElement | null;
      const rootId = rootEl?.getAttribute('data-reframe-inode') ?? null;
      return result.nodeId === rootId;
    },
    onComplete: (ids, mod) => {
      applyMarqueeResult(selState, ids, mod);
      const next = selectionAsArray(selState);
      refreshSelectionOverlay();
      opts.onSelect?.(next);
    },
  });
  void marquee;

  const presentMode = createPresentMode({
    iframe: renderer.iframe,
    viewport,
    // Same multi-mount gate — parallax mousemove listens window-globally;
    // without this predicate the mouse moving over variant[0] would animate
    // variant[1]'s camera too.
    isFocused: () => isFocused(hostId),
    onModeChange: (on) => {
      // Hide selection overlay during present mode so it doesn't flash
      // over the camera-animated scene.
      if (on) overlay.setSelection(null);
      else refreshSelectionOverlay();
    },
  });

  // ── Iframe event wiring ────────────────────────────────────

  const attachIframeHandlers = (iframe: HTMLIFrameElement) => {
    const doc = iframe.contentDocument;
    if (!doc) return;

    // Focus bridge: any click inside this instance's iframe promotes it
    // to the focused canvas in the multi-mount registry. Mirrors the
    // existing {capture:true} selection path — set focus FIRST, then let
    // the selection handler run. Same event, two capture-phase listeners
    // in insertion order: focus → select.
    doc.addEventListener('click', () => setFocused(hostId), { capture: true });

    // Phase 1 UI-2 — click semantics:
    //   plain click           → replace with single
    //   Shift+click           → add to selection (idempotent)
    //   Cmd/Ctrl+click        → toggle membership
    //   click empty space     → clear (when no modifier held)
    //
    // Marquee selection runs in PARENT viewport space (separate
    // listener, see createMarqueeSelector wiring below) — its empty-
    // space gate prevents double-firing with this iframe click handler
    // because the marquee bails out when an INode is at the cursor.
    doc.addEventListener('click', (e) => {
      const shift = (e as any).shiftKey === true;
      const meta = (e as any).metaKey === true || (e as any).ctrlKey === true;
      const result = hitTest(doc, e.clientX, e.clientY);
      if (!result) {
        if (!shift && !meta) commitSelection([]);
        return;
      }
      if (meta) {
        toggleInSelection(selState, result.nodeId);
        commitSelection(selectionAsArray(selState));
      } else if (shift) {
        addToSelection(selState, result.nodeId);
        commitSelection(selectionAsArray(selState));
      } else {
        commitSelection([result.nodeId]);
      }
    }, { capture: true });

    // Phase 1 UI-2 — hover preview. Mousemove on the iframe paints a
    // thin outline on the hovered INode (skipped when it's already
    // selected — the heavier selected outline wins). Mouseleave clears.
    doc.addEventListener('mousemove', (e) => {
      const target = e.target as HTMLElement | null;
      const host = findInodeAnchor(target);
      const id = host?.getAttribute('data-reframe-inode') ?? null;
      if (id === selState.hoveredId) return;
      setHovered(selState, id);
      refreshHoverOverlay();
    });
    doc.addEventListener('mouseleave', () => {
      if (selState.hoveredId !== null) {
        setHovered(selState, null);
        refreshHoverOverlay();
      }
    });

    // Double-click text → inline edit. Tag gate + dblclick handler live
    // inside `inline-text-edit.ts`; bind it to the live document. The
    // module rebinds itself on each iframe load via this call.
    inlineEditor.attachToDocument(doc);

    // Escape inside iframe clears selection. (Window-level keyboard-nav
    // intercepts Escape FIRST when there's a parent to navigate to;
    // this fallback handles the topmost level where parent walk halts.)
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') commitSelection([]);
    });

    // Drag body of a selected element → move via /api/node/edit.
    //
    // SAFETY GUARD (learned 2026-04-22): the scene root is NOT a
    // draggable node from a user's perspective — it IS the frame. If
    // we let drag-move write x/y on it, a selected+dragged root ends up
    // with non-zero coords, which shifts every child visually (the
    // dashboard we accidentally broke had root at left:1667, top:-833
    // because of exactly this). Root is identified as the first body
    // child in the iframe; skip drag initiation when it's the target.
    doc.addEventListener('mousedown', (e) => {
      if ((e as MouseEvent).button !== 0) return;
      if (presentMode.isActive()) return;
      const target = e.target as HTMLElement;
      const host = findInodeAnchor(target);
      if (!host) return;
      const nodeId = host.getAttribute('data-reframe-inode');
      if (!nodeId || !selState.selectedIds.has(nodeId)) return;
      if ((target as any).isContentEditable) return;
      // Scene root guard — first body child is the root frame.
      if (host === doc.body.firstElementChild) return;
      startMoveDrag(e, nodeId);
    });
  };

  const findInodeAnchor = (el: HTMLElement | null): HTMLElement | null => {
    let cur: HTMLElement | null = el;
    while (cur && !cur.getAttribute?.('data-reframe-inode')) cur = cur.parentElement;
    return cur;
  };

  // ── Selection API ──────────────────────────────────────────
  //
  // commitSelection is the single mutation point — it pushes new ids
  // into the SelectionState container, refreshes the overlay (union
  // bbox + per-node thin outlines), and notifies subscribers via
  // opts.onSelect. Internal call sites (click, marquee, keyboard nav,
  // public select() API) all funnel through here so the SelectionState
  // never gets desynced from the rendered overlay.

  const commitSelection = (ids: NodeId[]) => {
    stateSetSelection(selState, ids);
    refreshSelectionOverlay();
    opts.onSelect?.(selectionAsArray(selState));
  };

  const computeRectForNode = (id: NodeId, doc: Document, iframeOrigin: DOMRect): SelectionRect | null => {
    const el = doc.querySelector(`[data-reframe-inode="${id.replace(/(["\\<>])/g, '\\$1')}"]`) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.left - iframeOrigin.left,
      y: r.top - iframeOrigin.top,
      width: r.width,
      height: r.height,
    };
  };

  const refreshSelectionOverlay = () => {
    const ids = selectionAsArray(selState);
    if (ids.length === 0 || presentMode.isActive()) {
      overlay.setSelection(null);
      overlay.setMultiSelectOutlines([]);
      refreshHoverOverlay();
      return;
    }
    const iframe = renderer.iframe;
    const doc = iframe.contentDocument;
    if (!doc) return;
    // Per-node rects + union bbox.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const iframeOrigin = doc.body.getBoundingClientRect();
    const perNode: SelectionRect[] = [];
    for (const id of ids) {
      const r = computeRectForNode(id, doc, iframeOrigin);
      if (!r) continue;
      perNode.push(r);
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    if (minX === Infinity) {
      overlay.setSelection(null);
      overlay.setMultiSelectOutlines([]);
      refreshHoverOverlay();
      return;
    }
    overlay.setSelection({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    // Per-node thin outlines only when multi-select; single-node case
    // already gets the heavy outline + handles via setSelection.
    overlay.setMultiSelectOutlines(ids.length > 1 ? perNode : []);
    refreshHoverOverlay();
  };

  const refreshHoverOverlay = () => {
    const id = selState.hoveredId;
    if (!id || selState.selectedIds.has(id) || presentMode.isActive()) {
      overlay.setHover(null);
      return;
    }
    const doc = renderer.iframe.contentDocument;
    if (!doc) return;
    const iframeOrigin = doc.body.getBoundingClientRect();
    const r = computeRectForNode(id, doc, iframeOrigin);
    overlay.setHover(r);
  };

  // ── Drag to move ───────────────────────────────────────────

  const startMoveDrag = (e: MouseEvent, leadNodeId: string) => {
    const doc = renderer.iframe.contentDocument;
    if (!doc) return;
    void leadNodeId;
    const starts: Array<{ id: string; x: number; y: number; w: number; h: number; el: HTMLElement }> = [];
    const iframeOrigin = doc.body.getBoundingClientRect();
    const rootEl = doc.body.firstElementChild;
    for (const id of selectionAsArray(selState)) {
      const el = doc.querySelector(`[data-reframe-inode="${id}"]`) as HTMLElement | null;
      if (!el) continue;
      // Skip scene root — moving it shifts the whole frame, which is
      // never user intent (see mousedown-site guard for rationale).
      if (el === rootEl) continue;
      const r = el.getBoundingClientRect();
      starts.push({
        id, el,
        x: r.left - iframeOrigin.left,
        y: r.top - iframeOrigin.top,
        w: r.width, h: r.height,
      });
    }
    if (starts.length === 0) return;
    e.preventDefault();

    const startX = e.clientX, startY = e.clientY;
    let latestDX = 0, latestDY = 0;

    const onMove = (ev: MouseEvent) => {
      latestDX = (ev.clientX - startX) / currentZoom.zoom;
      latestDY = (ev.clientY - startY) / currentZoom.zoom;
      // Optimistic overlay preview while dragging.
      const first = starts[0];
      let minX = first.x + latestDX, minY = first.y + latestDY;
      let maxX = first.x + latestDX + first.w, maxY = first.y + latestDY + first.h;
      for (let i = 1; i < starts.length; i++) {
        const s = starts[i];
        if (s.x + latestDX < minX) minX = s.x + latestDX;
        if (s.y + latestDY < minY) minY = s.y + latestDY;
        if (s.x + latestDX + s.w > maxX) maxX = s.x + latestDX + s.w;
        if (s.y + latestDY + s.h > maxY) maxY = s.y + latestDY + s.h;
      }
      overlay.setSelection({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    };

    const onUp = async () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (latestDX === 0 && latestDY === 0) return;
      // Commit: POST /api/node/edit with new x/y for each selected node.
      // Server re-layouts + SSE broadcasts; renderer reloads the iframe
      // with new ground truth.
      // Clamp — defensive against any future zoom-math corruption.
      const clampDim = (v: number) => Math.max(-16384, Math.min(16384, v));
      for (const s of starts) {
        await postEdit(s.id, {
          x: clampDim(Math.round(s.x + latestDX)),
          y: clampDim(Math.round(s.y + latestDY)),
        });
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Drag to resize ─────────────────────────────────────────

  let resizeState: {
    starts: Array<{ id: string; x: number; y: number; w: number; h: number }>;
    which: HandlePosition;
  } | null = null;

  const handleResizeDrag = (which: HandlePosition, dx: number, dy: number, phase: 'start' | 'move' | 'end') => {
    const doc = renderer.iframe.contentDocument;
    if (!doc) return;
    if (phase === 'start') {
      const iframeOrigin = doc.body.getBoundingClientRect();
      const rootEl = doc.body.firstElementChild;
      const starts: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
      for (const id of selectionAsArray(selState)) {
        const el = doc.querySelector(`[data-reframe-inode="${id}"]`) as HTMLElement | null;
        if (!el) continue;
        // Scene root skipped — resize writeback would set explicit
        // width/height on the frame, fighting the server's layout pass.
        // Root sizing happens via reframe_project resize / reframe_edit
        // op=resize at the scene level.
        if (el === rootEl) continue;
        const r = el.getBoundingClientRect();
        starts.push({ id, x: r.left - iframeOrigin.left, y: r.top - iframeOrigin.top, w: r.width, h: r.height });
      }
      resizeState = { starts, which };
      return;
    }
    if (!resizeState) return;
    // Guard: zoom can be small (0.25 = at min preset); `dx / zoom` = 4x,
    // fine. But a corrupted state or future zoom < 0.01 would blow the
    // coord math (we once saved h=209794428 this way). Clamp defensively.
    const z = Math.max(0.05, currentZoom.zoom);
    const sDX = dx / z;
    const sDY = dy / z;
    // Additional sanity ceiling: no single drag should move more than
    // 16384px in scene space (matches engine's dim clamp). Stops any
    // runaway before it hits the server.
    const clamp = (v: number) => Math.max(-16384, Math.min(16384, v));
    // Live overlay feedback (multi-select uses union of deltas; server
    // applies per-node).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of resizeState.starts) {
      const t = computeResizedBox(s, resizeState.which, sDX, sDY);
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x + t.w > maxX) maxX = t.x + t.w;
      if (t.y + t.h > maxY) maxY = t.y + t.h;
    }
    overlay.setSelection({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

    if (phase === 'end') {
      (async () => {
        for (const s of resizeState!.starts) {
          const t = computeResizedBox(s, resizeState!.which, sDX, sDY);
          await postEdit(s.id, {
            x: clamp(Math.round(t.x)),
            y: clamp(Math.round(t.y)),
            width: Math.max(1, Math.min(16384, Math.round(t.w))),
            height: Math.max(1, Math.min(16384, Math.round(t.h))),
          });
        }
        resizeState = null;
      })();
    }
  };

  const computeResizedBox = (
    s: { x: number; y: number; w: number; h: number },
    which: HandlePosition,
    dx: number,
    dy: number,
  ): { x: number; y: number; w: number; h: number } => {
    let { x, y, w, h } = s;
    if (which.includes('e')) w += dx;
    if (which.includes('w')) { x += dx; w -= dx; }
    if (which.includes('s')) h += dy;
    if (which.includes('n')) { y += dy; h -= dy; }
    return { x, y, w, h };
  };

  // ── Inline text edit ───────────────────────────────────────
  //
  // Phase 1 UI-5a: extracted to `inline-text-edit.ts` (controller +
  // expanded EDITABLE_TAGS + isLeafTextElement heuristic) and paired
  // with `mini-toolbar.ts` for floating Bold/Italic/Link.
  //
  // Lifecycle: controller is module-scope (one per canvas instance).
  // Doc-level dblclick is rebound per iframe load via attachToDocument.
  // Window-level Enter/F2 multi-modal entry is routed through
  // tryEnterFromKey() in onGlobalKey below — single key listener,
  // gated by isFocused(hostId).
  const miniToolbar = createMiniToolbar({
    parentDoc: document,
    iframe: renderer.iframe,
  });
  const inlineEditor = createInlineTextEditor({
    sceneId: opts.sceneId,
    postEdit,
    onEditStart: (host) => {
      // Phase 1 UI-6a Pin #2 — inline-edit promotes selection.
      // Multi-selected {A,B,C} + dblclick on B → selection becomes [B]
      // (Figma behavior: entering edit mode collapses to single-target).
      // Already-single-selected B → no-op (commitSelection idempotent).
      // Inspector + LAYERS rail follow the new selection via the usual
      // event path — no extra wiring needed.
      const id = host.getAttribute('data-reframe-inode');
      if (id) {
        const current = selectionAsArray(selState);
        if (!(current.length === 1 && current[0] === id)) {
          commitSelection([id]);
        }
      }
      // Cmd+B/I/K hotkey listener installed on iframe doc only while
      // editing — execCommand needs focus inside the contenteditable.
      const doc = host.ownerDocument;
      doc.addEventListener('keydown', miniToolbarKeyHandler, { capture: true });
    },
    onEditEnd: () => {
      miniToolbar.hide();
      const doc = renderer.iframe.contentDocument;
      doc?.removeEventListener('keydown', miniToolbarKeyHandler, { capture: true } as EventListenerOptions);
    },
    onSelectionChange: (host, range) => {
      miniToolbar.onSelectionChanged(host, range);
    },
  });
  const miniToolbarKeyHandler = (e: KeyboardEvent) => {
    if (!inlineEditor.isEditing()) return;
    miniToolbar.handleHotkey(e);
  };

  // Reposition mini-toolbar on zoom/pan changes (it's anchored to a
  // viewport-coord position computed from the host's bbox).
  zoomSubscribers.add(() => miniToolbar.reposition());

  // ── Present mode keybind (window-global + focus-gated) ─────
  //
  // P-key is registered on window so it fires regardless of which element
  // has focus (iframe content, UI chrome, overlay). Every mounted canvas
  // installs its own listener — the isFocused(hostId) gate below ensures
  // only the focused instance toggles present mode. Without the gate,
  // pressing P with N canvases mounted would toggle all N simultaneously.
  const onGlobalKey = (e: KeyboardEvent) => {
    if (!isFocused(hostId)) return;
    if (e.key === 'p' && (e.ctrlKey || e.metaKey) === false && !e.shiftKey && !e.altKey) {
      if (inlineEditor.isEditing()) return; // don't hijack while typing in inline edit
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      presentMode.toggle();
      return;
    }
    // Phase 1 UI-5a Pin #2 — multi-modal edit entry. Enter (no mods)
    // or F2 with a single text-node selection enters edit mode. Skipped
    // when focus is in a real form input (don't steal Enter from the
    // inspector text fields).
    inlineEditor.tryEnterFromKey(e, () => {
      const id = selState.primaryId;
      if (!id) return null;
      const doc = renderer.iframe.contentDocument;
      if (!doc) return null;
      const host = doc.querySelector(`[data-reframe-inode="${id}"]`) as HTMLElement | null;
      if (!host) return null;
      return isLeafTextElement(host) ? host : null;
    });
  };
  window.addEventListener('keydown', onGlobalKey);

  // Phase 1 UI-2 — keyboard navigation (Tab/Enter/Esc/Cmd+A/Cmd+G/
  // Cmd+Shift+G). Window-global listener gated by isFocused so a
  // multi-mount page (variants/flow/sampler) routes keys to one
  // canvas. runEdit posts to the same /platform/api/edit surface
  // existing ops use; group + ungroup land as `op` strings the
  // mcp edit handler interprets via switch.
  const kbNav = attachKeyboardNav({
    isFocused: () => isFocused(hostId),
    getDocument: () => renderer.iframe.contentDocument,
    getPrimaryId: () => selState.primaryId,
    getSelectedIds: () => selectionAsArray(selState),
    setSelection: (ids) => commitSelection(ids),
    getSceneId: () => opts.sceneId,
    isEditingText: () => inlineEditor.isEditing(),
    runEdit: async (op) => {
      try {
        const path = op.type === 'group'
          ? '/platform/api/scene/group'
          : '/platform/api/scene/ungroup';
        const body = op.type === 'group'
          ? { sceneId: op.sceneId, nodeIds: op.nodeIds }
          : { sceneId: op.sceneId, nodeId: op.nodeId };
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          console.warn(`[dom-canvas] ${op.type} failed`, await res.text());
          return;
        }
        // Group returns the new frame id — promote it to selection so
        // the user sees the result of their gesture immediately, before
        // SSE round-trips back. SSE will then patch the iframe in.
        if (op.type === 'group') {
          try {
            const json = await res.json();
            if (json?.frameId) commitSelection([json.frameId]);
          } catch { /* best-effort */ }
        } else {
          try {
            const json = await res.json();
            if (Array.isArray(json?.promoted)) commitSelection(json.promoted);
          } catch { /* best-effort */ }
        }
      } catch (err) {
        console.warn('[dom-canvas] runEdit threw', err);
      }
    },
  });

  // ── Public API ─────────────────────────────────────────────

  const handle: DOMCanvasHandle = {
    reload: () => renderer.reload(),
    select: (ids) => {
      if (ids == null) commitSelection([]);
      else if (typeof ids === 'string') commitSelection([ids]);
      else commitSelection(ids);
    },
    present: presentMode,
    zoom: {
      getZoom: () => currentZoom.zoom,
      setZoom: (z) => zoomPan.setZoom(z),
      zoomIn: () => zoomPan.zoomIn(),
      zoomOut: () => zoomPan.zoomOut(),
      zoomTo100: () => zoomPan.zoomTo100(),
      // Fit uses the scene root bbox captured on renderer.onLoad. If the
      // bbox isn't known yet (very first paint race), fall back to 100%
      // so the button never silently no-ops.
      zoomToFit: () => {
        if (sceneRootBbox) zoomPan.zoomToFit(sceneRootBbox.w, sceneRootBbox.h);
        else zoomPan.zoomTo100();
      },
      onChange: (fn) => {
        zoomSubscribers.add(fn);
        // Immediate push so subscribers don't have to query getZoom() separately.
        fn(currentZoom.zoom);
        return () => { zoomSubscribers.delete(fn); };
      },
      levels: ZOOM_LEVELS,
    },
    postToIframe: (message) => {
      const win = renderer.iframe.contentWindow;
      if (!win) return false;
      try {
        win.postMessage({ source: 'reframe-parent', ...(message as object) }, '*');
        return true;
      } catch {
        return false;
      }
    },
    destroy: () => {
      unregister();
      window.removeEventListener('keydown', onGlobalKey);
      kbNav.destroy();
      marquee.destroy();
      zoomSubscribers.clear();
      presentMode.destroy();
      overlay.destroy();
      zoomPan.destroy();
      renderer.destroy();
      viewport.remove();
      void sceneRootBbox;
    },
  };

  // Register AFTER the handle object is fully constructed so the registry
  // exposes the complete API (legacy __reframeDOMCanvas getter returns
  // something usable from frame 0). First register becomes focused by
  // default — subsequent instances promote themselves via the iframe click
  // bridge installed inside attachIframeHandlers.
  const unregister = registerCanvas(hostId, handle, {
    sceneId: opts.sceneId,
    brand: opts.brand,
    compositionKind: opts.compositionKind ?? 'single',
  });

  return handle;
}
