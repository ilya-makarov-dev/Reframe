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
import { createZoomPan, type ZoomPanState } from './zoom-pan.js';
import { createSelectionOverlay, type SelectionRect, type HandlePosition } from './overlay.js';
import { hitTest } from './pointer.js';
import { createPresentMode, type PresentModeController } from './present.js';

export interface DOMCanvasOptions {
  container: HTMLElement;
  sceneId: string;
  projectSlug?: string;
  onSelect?: (ids: string[]) => void;
}

export function createDOMCanvas(opts: DOMCanvasOptions): {
  reload: () => void;
  select: (ids: string | string[] | null) => void;
  present: PresentModeController;
  destroy: () => void;
} {
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
  // Multi-select: an array of INode ids. Shift+click adds/removes;
  // plain click replaces. Overlay shows the UNION bbox; drag moves
  // every selected node simultaneously.
  let selection: string[] = [];
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

  const zoomPan = createZoomPan({
    wrapper,
    viewport,
    onChange: (state) => {
      currentZoom = state;
      overlay.syncTransform(state.zoom, state.panX, state.panY);
    },
  });

  const presentMode = createPresentMode({
    iframe: renderer.iframe,
    viewport,
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

    // Click → select. Shift+click → toggle. Empty space → clear.
    doc.addEventListener('click', (e) => {
      const shift = (e as any).shiftKey === true;
      const result = hitTest(doc, e.clientX, e.clientY);
      if (!result) {
        if (!shift) setSelection([]);
        return;
      }
      if (shift) toggleSelection(result.nodeId);
      else setSelection([result.nodeId]);
    }, { capture: true });

    // Double-click text → inline edit (contenteditable in iframe).
    doc.addEventListener('dblclick', (e) => {
      const target = e.target as HTMLElement;
      const host = findInodeAnchor(target);
      if (!host) return;
      const isTextNode = host.tagName === 'P' || host.tagName === 'H1' || host.tagName === 'H2'
        || host.tagName === 'H3' || host.tagName === 'H4' || host.tagName === 'H5'
        || host.tagName === 'H6' || host.tagName === 'SPAN' || host.tagName === 'BUTTON';
      if (!isTextNode) return;
      e.preventDefault();
      startInlineTextEdit(host);
    });

    // Escape inside iframe clears selection.
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setSelection([]);
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
      if (!nodeId || !selection.includes(nodeId)) return;
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

  const setSelection = (ids: string[]) => {
    selection = ids;
    refreshSelectionOverlay();
    opts.onSelect?.(selection);
  };

  const toggleSelection = (id: string) => {
    if (selection.includes(id)) setSelection(selection.filter(x => x !== id));
    else setSelection([...selection, id]);
  };

  const refreshSelectionOverlay = () => {
    if (selection.length === 0 || presentMode.isActive()) {
      overlay.setSelection(null);
      return;
    }
    const iframe = renderer.iframe;
    const doc = iframe.contentDocument;
    if (!doc) return;
    // Union bbox for multi-select.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const iframeOrigin = doc.body.getBoundingClientRect();
    for (const id of selection) {
      const el = doc.querySelector(`[data-reframe-inode="${id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const x = r.left - iframeOrigin.left;
      const y = r.top - iframeOrigin.top;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + r.width > maxX) maxX = x + r.width;
      if (y + r.height > maxY) maxY = y + r.height;
    }
    if (minX === Infinity) { overlay.setSelection(null); return; }
    const rect: SelectionRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    overlay.setSelection(rect);
  };

  // ── Drag to move ───────────────────────────────────────────

  const startMoveDrag = (e: MouseEvent, leadNodeId: string) => {
    const doc = renderer.iframe.contentDocument;
    if (!doc) return;
    void leadNodeId;
    const starts: Array<{ id: string; x: number; y: number; w: number; h: number; el: HTMLElement }> = [];
    const iframeOrigin = doc.body.getBoundingClientRect();
    const rootEl = doc.body.firstElementChild;
    for (const id of selection) {
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
      for (const id of selection) {
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

  let editingEl: HTMLElement | null = null;
  let editingNodeId: string | null = null;

  const startInlineTextEdit = (host: HTMLElement) => {
    if (editingEl) finishInlineTextEdit(true);
    const nodeId = host.getAttribute('data-reframe-inode');
    if (!nodeId) return;
    editingEl = host;
    editingNodeId = nodeId;
    host.setAttribute('contenteditable', 'true');
    host.style.outline = '2px solid #2b74ff';
    host.focus();
    // Select all text on enter.
    const doc = host.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(host);
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const onBlur = () => finishInlineTextEdit(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishInlineTextEdit(true); }
      if (e.key === 'Escape') { e.preventDefault(); finishInlineTextEdit(false); }
    };
    host.addEventListener('blur', onBlur, { once: true });
    host.addEventListener('keydown', onKey, { once: false });
  };

  const finishInlineTextEdit = async (commit: boolean) => {
    const el = editingEl; const nodeId = editingNodeId;
    editingEl = null; editingNodeId = null;
    if (!el) return;
    el.removeAttribute('contenteditable');
    el.style.outline = '';
    if (!commit || !nodeId) return;
    const newText = el.textContent ?? '';
    await postEdit(nodeId, { 'text-content': newText });
  };

  // ── Server writeback ───────────────────────────────────────

  const postEdit = async (nodeId: string, props: Record<string, unknown>) => {
    try {
      await fetch('/platform/api/node/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId: opts.sceneId, nodeId, props }),
      });
      // Server SSE broadcasts scene:session-changed → renderer.reload
      // auto-refreshes the iframe. No explicit reload needed here.
    } catch (err) {
      console.warn('[canvas-dom] postEdit failed', err);
    }
  };

  // ── Present mode keybind (global) ──────────────────────────

  const onGlobalKey = (e: KeyboardEvent) => {
    if (e.key === 'p' && (e.ctrlKey || e.metaKey) === false && !e.shiftKey && !e.altKey) {
      if (editingEl) return; // don't hijack while typing in inline edit
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      presentMode.toggle();
    }
  };
  window.addEventListener('keydown', onGlobalKey);

  // ── Public API ─────────────────────────────────────────────

  return {
    reload: () => renderer.reload(),
    select: (ids) => {
      if (ids == null) setSelection([]);
      else if (typeof ids === 'string') setSelection([ids]);
      else setSelection(ids);
    },
    present: presentMode,
    destroy: () => {
      window.removeEventListener('keydown', onGlobalKey);
      presentMode.destroy();
      overlay.destroy();
      zoomPan.destroy();
      renderer.destroy();
      viewport.remove();
      void sceneRootBbox;
    },
  };
}
