/**
 * Canvas — renders INode tree as HTML + selection overlay.
 *
 * The canvas IS the design. exportToHtml() output rendered by the browser.
 * data-id attributes on every element enable click-to-select.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { useSceneStore, getActiveArtboard } from '../store/scene';

const RESIZABLE_NODE_TYPES = new Set(['FRAME', 'RECTANGLE', 'TEXT']);

interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

interface DragState {
  nodeId: string;
  startX: number;
  startY: number;
  nodeStartX: number;
  nodeStartY: number;
}

/** Position vs graph parent frame, in design px (matches exportToHtml absolute children). */
function readNodeOffsetInParent(
  renderRoot: HTMLElement,
  nodeId: string,
  parentId: string,
  viewScale: number,
): { x: number; y: number } | null {
  try {
    const el = renderRoot.querySelector(`[data-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null;
    const pel = renderRoot.querySelector(`[data-id="${CSS.escape(parentId)}"]`) as HTMLElement | null;
    if (!el || !pel || viewScale <= 0) return null;
    const er = el.getBoundingClientRect();
    const pr = pel.getBoundingClientRect();
    return {
      x: Math.round((er.left - pr.left) / viewScale),
      y: Math.round((er.top - pr.top) / viewScale),
    };
  } catch {
    return null;
  }
}

/**
 * Drag preview transform: parent-space translate first (matches left/top delta), then rotate/flip
 * like exportToHtml — avoids clearing export transform during drag / on mouseup before HTML swaps.
 */
function buildDragTransformCss(
  node: { rotation: number; flipX: boolean; flipY: boolean } | null | undefined,
  tx: number,
  ty: number,
): string {
  const parts: string[] = [`translate(${tx}px, ${ty}px)`];
  if (node) {
    const r = node.rotation ?? 0;
    if (r !== 0) parts.push(`rotate(${Math.round(r * 1000) / 1000}deg)`);
    if (node.flipX) parts.push('scaleX(-1)');
    if (node.flipY) parts.push('scaleY(-1)');
  }
  return parts.join(' ');
}

/** Topmost layer under point inside artboard DOM (paint order). */
function hitLayerIdAtPoint(clientX: number, clientY: number, renderRoot: HTMLElement | null): string | null {
  if (!renderRoot) return null;
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const node of stack) {
    if (!(node instanceof Element)) continue;
    if (!renderRoot.contains(node)) continue;
    const idEl = node.closest('[data-id]');
    if (!idEl || !renderRoot.contains(idEl)) continue;
    const id = idEl.getAttribute('data-id');
    if (id) return id;
  }
  return null;
}

function clientRectsIntersect(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function collectIdsInMarqueeClientRect(
  renderRoot: HTMLElement,
  rootId: string,
  marquee: { left: number; top: number; right: number; bottom: number },
): string[] {
  const ids: string[] = [];
  const els = renderRoot.querySelectorAll('[data-id]');
  for (const hel of els) {
    if (!(hel instanceof HTMLElement)) continue;
    const id = hel.getAttribute('data-id');
    if (!id || id === rootId) continue;
    const r = hel.getBoundingClientRect();
    const br = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    if (clientRectsIntersect(marquee, br)) ids.push(id);
  }
  return ids;
}

export function Canvas() {
  const ab = useSceneStore(s => getActiveArtboard(s));
  const graph = ab?.graph ?? null;
  const rootId = ab?.rootId ?? null;
  const renderedHtml =
    ab?.graph && ab.rootId ? (ab.renderedHtml ?? '') : '';
  const auditIssues = ab?.auditIssues ?? [];

  const selectedIds = useSceneStore(s => s.selectedIds);
  const hoveredId = useSceneStore(s => s.hoveredId);
  const select = useSceneStore(s => s.select);
  const hover = useSceneStore(s => s.hover);
  const updateNode = useSceneStore(s => s.updateNode);
  const commitHistoryFrame = useSceneStore(s => s.commitHistoryFrame);
  const canvasFitNodeId = useSceneStore(s => s.canvasFitNodeId);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  /** Sync with drag threshold — hover() is skipped while true to avoid zustand thrash + innerHTML churn during drag. */
  const isDraggingRef = useRef(false);
  /** Bumped each drag rAF so selection overlay re-measures (getBoundingClientRect includes CSS transform). */
  const [, setDragOverlayRev] = useState(0);
  /** Keep latest scale for window drag handler without re-subscribing on every zoom. */
  const viewScaleRef = useRef(view.scale);
  viewScaleRef.current = view.scale;
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const dragState = useRef<DragState | null>(null);
  /** During drag: one transform apply per frame (no exportToHtml until mouseup). */
  const dragRafRef = useRef(0);
  const pendingDragPosRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);
  const dragGestureActiveRef = useRef(false);
  /** After placement via pointerup, skip the following click (same gesture). */
  const justPlacedRef = useRef(false);
  /** Select tool: drag矩形 on empty / root background. */
  const marqueeActiveRef = useRef<null | { sx: number; sy: number; shiftKey: boolean }>(null);
  const marqueeEndRef = useRef({ x: 0, y: 0 });
  const [marqueeBox, setMarqueeBox] = useState<null | { left: number; top: number; width: number; height: number }>(null);
  const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);

  const hasCanvasContent = !!(renderedHtml && graph && rootId);

  // Center canvas when scene loads (container ref exists every frame — see single outer .canvas-area)
  useEffect(() => {
    if (!graph || !rootId || !containerRef.current) return;
    const root = graph.getNode(rootId);
    if (!root) return;
    const rect = containerRef.current.getBoundingClientRect();
    const scale = Math.min(
      (rect.width - 80) / root.width,
      (rect.height - 80) / root.height,
      1,
    );
    setView({
      scale,
      x: (rect.width - root.width * scale) / 2,
      y: (rect.height - root.height * scale) / 2,
    });
  }, [graph, rootId]);

  // After placing a frame/rect/text: zoom & center on it (Figma-like), then clear one-shot id from store.
  useEffect(() => {
    if (!canvasFitNodeId || !graph || !rootId || !containerRef.current) return;
    const node = graph.getNode(canvasFitNodeId);
    if (!node) {
      useSceneStore.setState({ canvasFitNodeId: null });
      return;
    }
    const raf = requestAnimationFrame(() => {
      useSceneStore.setState({ canvasFitNodeId: null });
      if (!containerRef.current) return;
      const cw = containerRef.current.clientWidth;
      const ch = containerRef.current.clientHeight;
      const pad = 72;
      const nw = Math.max(1, node.width);
      const nh = Math.max(1, node.height);
      let newScale = Math.min((cw - 2 * pad) / nw, (ch - 2 * pad) / nh, 4);
      newScale = Math.max(0.2, Math.min(5, newScale));
      const ncx = node.x + nw / 2;
      const ncy = node.y + nh / 2;
      setView({
        scale: newScale,
        x: cw / 2 - ncx * newScale,
        y: ch / 2 - ncy * newScale,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [canvasFitNodeId, graph, rootId]);

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent, nodeId: string) => {
      e.stopPropagation();
      e.preventDefault();
      const n = graph?.getNode(nodeId);
      if (!n) return;
      const scale = viewScaleRef.current;
      const start = { cx: e.clientX, cy: e.clientY, w: n.width, h: n.height, id: nodeId };
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - start.cx) / scale;
        const dy = (ev.clientY - start.cy) / scale;
        updateNode(
          start.id,
          {
            width: Math.round(Math.max(24, start.w + dx)),
            height: Math.round(Math.max(24, start.h + dy)),
          },
          { recordHistory: false },
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        commitHistoryFrame('Resize');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [graph, updateNode, commitHistoryFrame],
  );

  // Placement tools: pointerup (not click — drops after drag / some children).
  // Hit target is often .canvas-area (grey grid), not .canvas-render — never use renderRef.contains(target).
  const handlePointerUpCapture = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const st = useSceneStore.getState();
      const tool = st.canvasTool;
      if (tool !== 'frame' && tool !== 'rect' && tool !== 'text') return;
      if (!renderRef.current || !containerRef.current || !graph || !rootId) return;
      if (!containerRef.current.contains(e.target as Node)) return;
      if (isDraggingRef.current || dragGestureActiveRef.current || dragState.current) return;

      const rootNode = graph.getNode(rootId);
      if (!rootNode) return;

      const r = renderRef.current.getBoundingClientRect();
      const s = view.scale;
      let x = (e.clientX - r.left) / s;
      let y = (e.clientY - r.top) / s;
      x = Math.max(0, Math.min(rootNode.width, x));
      y = Math.max(0, Math.min(rootNode.height, y));

      const kind = tool === 'frame' ? 'frame' : tool === 'rect' ? 'rect' : 'text';
      st.addCanvasShape(kind, x, y);
      justPlacedRef.current = true;
    },
    [rootId, view.scale, graph],
  );

  // Click → select only (placement uses pointerup above).
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (justPlacedRef.current) {
        justPlacedRef.current = false;
        return;
      }
      const st = useSceneStore.getState();
      if (st.canvasSuppressNextClick) {
        useSceneStore.setState({ canvasSuppressNextClick: false });
        return;
      }
      if (!renderRef.current || !rootId) return;
      const target = e.target as HTMLElement;
      const el = target.closest('[data-id]') as HTMLElement | null;

      if (el) {
        const id = el.getAttribute('data-id')!;
        select(e.shiftKey ? [...selectedIds, id] : [id]);
      } else {
        select([]);
      }
    },
    [select, selectedIds, rootId],
  );

  // Hover → find data-id (skip while dragging — hover() re-renders the whole store subscription path)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning || isDraggingRef.current) return;
    const target = e.target as HTMLElement;
    const el = target.closest('[data-id]') as HTMLElement | null;
    hover(el ? el.getAttribute('data-id') : null);
  }, [hover, isPanning]);

  // Pan (middle mouse or alt+drag) / Drag-to-move (left click on node)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      return;
    }

    // Left click: select tool → marquee on empty / root background, else drag layer
    if (e.button === 0 && graph && rootId) {
      justPlacedRef.current = false;
      const tool = useSceneStore.getState().canvasTool;
      if (tool !== 'select') {
        useSceneStore.setState({ canvasSuppressNextClick: false });
        return;
      }
      const hitId = hitLayerIdAtPoint(e.clientX, e.clientY, renderRef.current);
      if (!hitId || hitId === rootId) {
        marqueeActiveRef.current = { sx: e.clientX, sy: e.clientY, shiftKey: e.shiftKey };
        marqueeEndRef.current = { x: e.clientX, y: e.clientY };
        setMarqueeBox(null);
        setIsMarqueeDragging(true);
        return;
      }
      const nodeId = hitId;
      const node = graph.getNode(nodeId);
      if (node) {
        dragGestureActiveRef.current = false;
        pendingDragPosRef.current = null;
        select([nodeId]);
        useSceneStore.setState({ canvasPointerDragNodeId: nodeId });
        let nodeStartX = node.x;
        let nodeStartY = node.y;
        if (node.parentId && node.layoutPositioning !== 'ABSOLUTE' && renderRef.current) {
          const off = readNodeOffsetInParent(renderRef.current, nodeId, node.parentId, view.scale);
          if (off) {
            nodeStartX = off.x;
            nodeStartY = off.y;
            updateNode(
              nodeId,
              {
                layoutPositioning: 'ABSOLUTE',
                x: nodeStartX,
                y: nodeStartY,
              } as any,
              { dragInternal: true },
            );
          }
        }
        dragState.current = {
          nodeId,
          startX: e.clientX,
          startY: e.clientY,
          nodeStartX,
          nodeStartY,
        };
      }
    }
  }, [view, graph, rootId, select, updateNode]);

  // Global mouse handlers for pan and drag-to-move
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      // Pan
      if (isPanning) {
        setView(v => ({
          ...v,
          x: panStart.current.vx + (e.clientX - panStart.current.x),
          y: panStart.current.vy + (e.clientY - panStart.current.y),
        }));
        return;
      }

      const mq = marqueeActiveRef.current;
      if (mq && renderRef.current) {
        marqueeEndRef.current = { x: e.clientX, y: e.clientY };
        const r = renderRef.current.getBoundingClientRect();
        const s = viewScaleRef.current;
        const ex = e.clientX;
        const ey = e.clientY;
        const left = (Math.min(mq.sx, ex) - r.left) / s;
        const top = (Math.min(mq.sy, ey) - r.top) / s;
        const width = Math.abs(ex - mq.sx) / s;
        const height = Math.abs(ey - mq.sy) / s;
        setMarqueeBox({ left, top, width, height });
        return;
      }

      // Drag-to-move
      const ds = dragState.current;
      if (ds) {
        const scale = viewScaleRef.current;
        const dx = (e.clientX - ds.startX) / scale;
        const dy = (e.clientY - ds.startY) / scale;
        if (Math.abs(dx) + Math.abs(dy) > 3) {
          isDraggingRef.current = true;
          setIsDragging(true);
          dragGestureActiveRef.current = true;
          const x = Math.round(ds.nodeStartX + dx);
          const y = Math.round(ds.nodeStartY + dy);
          pendingDragPosRef.current = { nodeId: ds.nodeId, x, y };
          if (!dragRafRef.current) {
            dragRafRef.current = requestAnimationFrame(() => {
              dragRafRef.current = 0;
              const p = pendingDragPosRef.current;
              const dgs = dragState.current;
              if (!p || !dgs || p.nodeId !== dgs.nodeId || !renderRef.current) return;
              const el = renderRef.current.querySelector(`[data-id="${CSS.escape(p.nodeId)}"]`) as HTMLElement | null;
              if (el) {
                const tx = p.x - dgs.nodeStartX;
                const ty = p.y - dgs.nodeStartY;
                const node = useSceneStore.getState().getNode(p.nodeId);
                el.style.transform = buildDragTransformCss(node, tx, ty);
                el.style.willChange = 'transform';
                setDragOverlayRev(v => v + 1);
              }
            });
          }
        }
      }
    };

    const handleUp = () => {
      const mq = marqueeActiveRef.current;
      const rid = getActiveArtboard(useSceneStore.getState())?.rootId ?? null;
      if (mq && renderRef.current && rid) {
        marqueeActiveRef.current = null;
        setMarqueeBox(null);
        setIsMarqueeDragging(false);
        const ex = marqueeEndRef.current.x;
        const ey = marqueeEndRef.current.y;
        const dx = Math.abs(ex - mq.sx);
        const dy = Math.abs(ey - mq.sy);
        const st = useSceneStore.getState();
        if (dx + dy < 5) {
          const h = hitLayerIdAtPoint(mq.sx, mq.sy, renderRef.current);
          if (h === rid) st.select([rid]);
          else st.select([]);
        } else {
          const rect = {
            left: Math.min(mq.sx, ex),
            top: Math.min(mq.sy, ey),
            right: Math.max(mq.sx, ex),
            bottom: Math.max(mq.sy, ey),
          };
          const ids = collectIdsInMarqueeClientRect(renderRef.current, rid, rect);
          if (mq.shiftKey) {
            const prev = st.selectedIds;
            st.select([...new Set([...prev, ...ids])]);
          } else {
            st.select(ids);
          }
        }
        useSceneStore.setState({ canvasSuppressNextClick: true });
      }

      const suppressNextClick = dragGestureActiveRef.current;
      setIsPanning(false);
      if (dragRafRef.current) {
        cancelAnimationFrame(dragRafRef.current);
        dragRafRef.current = 0;
      }
      const pending = pendingDragPosRef.current;
      pendingDragPosRef.current = null;
      const dsEnd = dragState.current;
      // If rAF was cancelled, apply final transform once so we don't flash stale HTML coords
      // before innerHTML replaces the tree. Do NOT clear transform here — that snaps back to
      // old left/top for a frame and feels like a teleport.
      if (pending && dsEnd && pending.nodeId === dsEnd.nodeId && renderRef.current) {
        const el = renderRef.current.querySelector(`[data-id="${CSS.escape(pending.nodeId)}"]`) as HTMLElement | null;
        if (el) {
          const tx = pending.x - dsEnd.nodeStartX;
          const ty = pending.y - dsEnd.nodeStartY;
          const node = useSceneStore.getState().getNode(pending.nodeId);
          el.style.transform = buildDragTransformCss(node, tx, ty);
        }
      }
      if (pending) {
        useSceneStore.getState().updateNode(
          pending.nodeId,
          { x: pending.x, y: pending.y },
          { recordHistory: false, dragInternal: true },
        );
      }
      if (dragGestureActiveRef.current) {
        useSceneStore.getState().commitHistoryFrame('Move');
        dragGestureActiveRef.current = false;
      }
      if (dragState.current) {
        dragState.current = null;
        setIsDragging(false);
      }
      isDraggingRef.current = false;
      useSceneStore.setState({
        canvasPointerDragNodeId: null,
        ...(suppressNextClick ? { canvasSuppressNextClick: true } : {}),
      });
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = 0;
      dragState.current = null;
      pendingDragPosRef.current = null;
      dragGestureActiveRef.current = false;
      isDraggingRef.current = false;
      setIsDragging(false);
      useSceneStore.setState({
        canvasPointerDragNodeId: null,
        canvasSuppressNextClick: false,
      });
      marqueeActiveRef.current = null;
      setMarqueeBox(null);
      setIsMarqueeDragging(false);
    };
  }, [isPanning]);

  // Zoom (native non-passive listener; re-attach when canvas mounts — ref was missing on first paint if scene loaded later)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!hasCanvasContent) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      // Normalize line-based deltas (Windows mouse wheels)
      const dy =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-dy * 0.0018);
      setView(v => {
        const newScale = Math.max(0.1, Math.min(5, v.scale * factor));
        return {
          scale: newScale,
          x: mx - (mx - v.x) * (newScale / v.scale),
          y: my - (my - v.y) * (newScale / v.scale),
        };
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [hasCanvasContent]);

  // Selection overlay boxes
  const getNodeRect = useCallback((nodeId: string) => {
    try {
      if (!renderRef.current || !nodeId) return null;
      const el = renderRef.current.querySelector(`[data-id="${CSS.escape(nodeId)}"]`) as HTMLElement | null;
      if (!el) return null;
      const renderRect = renderRef.current.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      return {
        left: (elRect.left - renderRect.left) / view.scale,
        top: (elRect.top - renderRect.top) / view.scale,
        width: elRect.width / view.scale,
        height: elRect.height / view.scale,
      };
    } catch { return null; }
  }, [view.scale]);

  const root = rootId && graph ? graph.getNode(rootId) : undefined;

  if (!renderedHtml) {
    return (
      <div
        className="canvas-area"
        ref={containerRef}
        style={{ cursor: 'default' }}
      >
        <div className="empty-state">
          <div className="empty-state__title">reframe studio</div>
          <div className="empty-state__hint">
            Import HTML or use the agent chat to create a design.
            The canvas renders your INode tree in real time.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="canvas-area"
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onPointerUpCapture={handlePointerUpCapture}
      style={{
        cursor: isPanning ? 'grabbing' : isDragging ? 'move' : isMarqueeDragging ? 'crosshair' : 'default',
      }}
    >
      <div
        className="canvas-viewport"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {/* Rendered design */}
        <div
          className="canvas-render"
          ref={renderRef}
          onClick={handleClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => hover(null)}
          style={{
            width: root?.width ?? 0,
            height: root?.height ?? 0,
            pointerEvents: (isPanning || isDragging) ? 'none' : 'auto',
          }}
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />

        {/* Selection overlay */}
        <div className="canvas-overlay" style={{ pointerEvents: 'none' }}>
          {marqueeBox && marqueeBox.width + marqueeBox.height > 0 && (
            <div
              className="canvas-marquee"
              style={{
                left: marqueeBox.left,
                top: marqueeBox.top,
                width: marqueeBox.width,
                height: marqueeBox.height,
              }}
            />
          )}
          {hoveredId && !selectedIds.includes(hoveredId) && (() => {
            const rect = getNodeRect(hoveredId);
            if (!rect) return null;
            const node = graph?.getNode(hoveredId);
            return (
              <>
                <div className="hover-box" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
                {node && <div className="node-label" style={{ left: rect.left, top: rect.top }}>{node.name}</div>}
              </>
            );
          })()}
          {selectedIds.map(id => {
            const rect = getNodeRect(id);
            if (!rect) return null;
            const node = graph?.getNode(id);
            const showResize =
              selectedIds.length === 1 &&
              rootId != null &&
              id !== rootId &&
              node &&
              RESIZABLE_NODE_TYPES.has(node.type);
            return (
              <div key={id}>
                <div className="selection-box" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
                {node && <div className="node-label" style={{ left: rect.left, top: rect.top }}>{node.name}</div>}
                {showResize && (
                  <div
                    className="canvas-resize-handle"
                    style={{ left: rect.left + rect.width, top: rect.top + rect.height }}
                    onPointerDown={ev => handleResizePointerDown(ev, id)}
                  />
                )}
              </div>
            );
          })}

          {/* Audit issue markers */}
          {auditIssues.map((issue, i) => {
            if (!issue.nodeId) return null;
            const rect = getNodeRect(issue.nodeId);
            if (!rect) return null;
            const isError = issue.severity === 'error';
            return (
              <div key={`audit-${i}`} style={{
                position: 'absolute',
                left: rect.left + rect.width - 4,
                top: rect.top - 4,
                width: 8, height: 8,
                borderRadius: '50%',
                background: isError ? 'var(--error)' : 'var(--warning)',
                border: '1px solid rgba(0,0,0,0.3)',
                pointerEvents: 'none',
              }} title={`${issue.rule}: ${issue.message}`} />
            );
          })}
        </div>
      </div>

      {/* Zoom indicator */}
      <div style={{
        position: 'absolute', bottom: 12, right: 16,
        fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
      }}>
        {Math.round(view.scale * 100)}%
      </div>
    </div>
  );
}
