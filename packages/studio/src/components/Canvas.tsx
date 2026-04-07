/**
 * Canvas — renders INode tree as HTML + selection overlay.
 *
 * The canvas IS the design. exportToHtml() output rendered by the browser.
 * data-id attributes on every element enable click-to-select.
 */

import { useRef, useCallback, useEffect, useState, memo, useMemo } from 'react';
import { useSceneStore } from '../store/scene';

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
/** Click position → coordinates inside the artboard (design px), accounting for viewport scale. */
function clientToDesignXY(
  e: { clientX: number; clientY: number },
  renderEl: HTMLElement,
  scale: number,
): { x: number; y: number } {
  const r = renderEl.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / scale,
    y: (e.clientY - r.top) / scale,
  };
}

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

export function Canvas() {
  const activeArtboardId = useSceneStore(s => s.activeArtboardId);
  const artboards = useSceneStore(s => s.artboards);
  const graphTop = useSceneStore(s => s.graph);
  const rootIdTop = useSceneStore(s => s.rootId);
  const renderedTop = useSceneStore(s => s.renderedHtml);
  const auditTop = useSceneStore(s => s.auditIssues);

  const ab = artboards.find(a => a.id === activeArtboardId);
  // Per-tab document: do not fall back to top-level graph when this artboard row is empty (fixes
  // “only last MCP scene shows” — top-level often still holds the previous load).
  const graph = ab ? ab.graph : graphTop;
  const rootId = ab ? ab.rootId : rootIdTop;
  const renderedHtml =
    ab && ab.graph && ab.rootId ? (ab.renderedHtml ?? '') : ab ? '' : renderedTop;
  const auditIssues = ab ? (ab.auditIssues ?? []) : auditTop;

  const selectedIds = useSceneStore(s => s.selectedIds);
  const hoveredId = useSceneStore(s => s.hoveredId);
  const select = useSceneStore(s => s.select);
  const hover = useSceneStore(s => s.hover);
  const updateNode = useSceneStore(s => s.updateNode);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  /** Sync with drag threshold — hover() is skipped while true to avoid zustand thrash + innerHTML churn during drag. */
  const isDraggingRef = useRef(false);
  /** Bumped each drag rAF so selection overlay re-measures (getBoundingClientRect includes CSS transform). */
  const [, setDragOverlayRev] = useState(0);
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const dragState = useRef<DragState | null>(null);
  /** During drag: one transform apply per frame (no exportToHtml until mouseup). */
  const dragRafRef = useRef(0);
  const pendingDragPosRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);
  const dragGestureActiveRef = useRef(false);

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

  // Click → find data-id → select (only if not dragging); insert tools add on root/empty
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isDragging) return;
    if (!renderRef.current || !rootId) return;
    const target = e.target as HTMLElement;
    const el = target.closest('[data-id]') as HTMLElement | null;
    const { canvasTool, addCanvasShape } = useSceneStore.getState();

    if (canvasTool === 'frame' || canvasTool === 'rect' || canvasTool === 'text') {
      const hitId = el?.getAttribute('data-id');
      if (!hitId || hitId === rootId) {
        const { x, y } = clientToDesignXY(e, renderRef.current, view.scale);
        const kind = canvasTool === 'frame' ? 'frame' : canvasTool === 'rect' ? 'rect' : 'text';
        addCanvasShape(kind, x, y);
        return;
      }
    }

    if (el) {
      const id = el.getAttribute('data-id')!;
      select(e.shiftKey ? [...selectedIds, id] : [id]);
    } else {
      select([]);
    }
  }, [select, selectedIds, isDragging, rootId, view.scale]);

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

    // Left click on a node → start drag-to-move
    if (e.button === 0 && graph && rootId) {
      const target = e.target as HTMLElement;
      const el = target.closest('[data-id]') as HTMLElement | null;
      if (el) {
        const nodeId = el.getAttribute('data-id')!;
        // Don't drag the root node
        if (nodeId === rootId) return;
        const node = graph.getNode(nodeId);
        if (node) {
          dragGestureActiveRef.current = false;
          pendingDragPosRef.current = null;
          select([nodeId]);
          useSceneStore.setState({ canvasPointerDragNodeId: nodeId });
          let nodeStartX = node.x;
          let nodeStartY = node.y;
          // Flex/grid flow children ignore x/y in HTML export — pin to absolute using on-screen placement
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

      // Drag-to-move
      const ds = dragState.current;
      if (ds) {
        const scale = view.scale;
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
      useSceneStore.setState({ canvasPointerDragNodeId: null });
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (dragRafRef.current) cancelAnimationFrame(dragRafRef.current);
      isDraggingRef.current = false;
      useSceneStore.setState({ canvasPointerDragNodeId: null });
    };
  }, [isPanning, view.scale]);

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
      style={{ cursor: isPanning ? 'grabbing' : isDragging ? 'move' : 'default' }}
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
            return (
              <div key={id}>
                <div className="selection-box" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} />
                {node && <div className="node-label" style={{ left: rect.left, top: rect.top }}>{node.name}</div>}
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
