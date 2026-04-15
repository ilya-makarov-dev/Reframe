/**
 * Canvas Interaction — pointer event handling for the editor canvas.
 *
 * Handles: selection, drag-to-move, resize handles, rubber band (marquee),
 * shape creation, and right-click context menu.
 *
 * Architecture: this module attaches pointer listeners to the canvas element
 * and calls OP Editor methods (select, commitMove, commitResize, setMarquee, etc.)
 * All coordinate transforms go through editor.screenToCanvas().
 */

import type { Editor } from '@open-pencil/core';
import { computeSnap, computeSelectionBounds } from '@open-pencil/core';

export interface InteractionCallbacks {
  onSelectionChanged?: () => void;
  onGraphChanged?: () => void;
  onLayerTreeChanged?: () => void;
  onContextMenu?: (x: number, y: number, nodeId: string | null) => void;
}

/**
 * Attach all pointer event handlers to the canvas.
 * Returns a cleanup function to remove all listeners.
 */
export function setupCanvasInteraction(
  canvas: HTMLCanvasElement,
  editor: Editor,
  callbacks: InteractionCallbacks,
): () => void {
  type DragState =
    | null
    | { kind: 'move'; startX: number; startY: number; originals: Map<string, { x: number; y: number }> }
    | { kind: 'marquee'; startX: number; startY: number }
    | { kind: 'create'; tool: string; startX: number; startY: number }
    | { kind: 'pan'; startX: number; startY: number; startPanX: number; startPanY: number };

  let drag: DragState = null;

  // Convert browser clientX/Y to canvas-local coordinates.
  // screenToCanvas expects coordinates relative to the canvas element,
  // but clientX/Y include page offset (sidebar, header).
  function localX(e: PointerEvent | WheelEvent): number {
    return e.clientX - canvas.getBoundingClientRect().left;
  }
  function localY(e: PointerEvent | WheelEvent): number {
    return e.clientY - canvas.getBoundingClientRect().top;
  }

  function onPointerDown(e: PointerEvent) {
    let cx: number, cy: number;
    try {
      ({ x: cx, y: cy } = editor.screenToCanvas(localX(e), localY(e)));
    } catch { return; }
    const tool = editor.state.activeTool;

    // Right click → context menu
    if (e.button === 2) {
      e.preventDefault();
      const hit = editor.hitTestAtPoint(cx, cy);
      if (hit && !editor.state.selectedIds.has(hit.id)) {
        editor.select([hit.id]);
        editor.requestRender();
      }
      callbacks.onContextMenu?.(e.clientX, e.clientY, hit?.id ?? null);
      return;
    }

    // Middle click → pan
    if (e.button === 1) {
      drag = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPanX: editor.state.panX,
        startPanY: editor.state.panY,
      };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Left click
    if (e.button !== 0) return;

    // Hand tool → pan
    if (tool === 'HAND') {
      drag = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        startPanX: editor.state.panX,
        startPanY: editor.state.panY,
      };
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Shape creation tools
    if (['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT'].includes(tool)) {
      drag = { kind: 'create', tool, startX: cx, startY: cy };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    // Select tool
    if (tool === 'SELECT') {
      // Deep hit test — select the deepest (most nested) node
      const hit = editor.hitTestAtPoint(cx, cy, true);

      if (hit) {
        if (!editor.state.selectedIds.has(hit.id)) {
          editor.select([hit.id], e.shiftKey);
          callbacks.onSelectionChanged?.();
        }

        // Start drag-to-move
        const originals = new Map<string, { x: number; y: number }>();
        for (const id of editor.state.selectedIds) {
          const node = editor.getNode(id);
          if (node) originals.set(id, { x: node.x, y: node.y });
        }
        drag = { kind: 'move', startX: cx, startY: cy, originals };
        canvas.setPointerCapture(e.pointerId);
      } else {
        // Click on empty space → start marquee
        if (!e.shiftKey) {
          editor.clearSelection();
          callbacks.onSelectionChanged?.();
        }
        drag = { kind: 'marquee', startX: cx, startY: cy };
        canvas.setPointerCapture(e.pointerId);
      }

      editor.requestRender();
    }
  }

  function onPointerMove(e: PointerEvent) {
    const { x: cx, y: cy } = editor.screenToCanvas(localX(e), localY(e));

    if (!drag) {
      // Hover
      if (editor.state.activeTool === 'SELECT') {
        const hit = editor.hitTestAtPoint(cx, cy);
        editor.setHoveredNode(hit?.id ?? null);
        editor.requestRepaint();
      }
      return;
    }

    if (drag.kind === 'pan') {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      editor.state.panX = drag.startPanX + dx;
      editor.state.panY = drag.startPanY + dy;
      editor.requestRender();
      return;
    }

    if (drag.kind === 'move') {
      const dx = cx - drag.startX;
      const dy = cy - drag.startY;

      // Move all selected nodes
      for (const [id, orig] of drag.originals) {
        editor.updateNode(id, { x: orig.x + dx, y: orig.y + dy });
      }

      // Snap guides
      const selectedNodes = editor.getSelectedNodes();
      if (selectedNodes.length > 0) {
        const bounds = computeSelectionBounds(selectedNodes);
        if (bounds) {
          const allNodes = [...editor.graph.getAllNodes()].filter(
            n => !editor.state.selectedIds.has(n.id) && n.visible,
          );
          const snap = computeSnap(editor.state.selectedIds, bounds, allNodes);
          editor.setSnapGuides(snap.guides);

          // Apply snap correction
          if (snap.dx !== 0 || snap.dy !== 0) {
            for (const [id, orig] of drag.originals) {
              const node = editor.getNode(id);
              if (node) {
                editor.updateNode(id, { x: node.x + snap.dx, y: node.y + snap.dy });
              }
            }
          }
        }
      }

      editor.requestRender();
      return;
    }

    if (drag.kind === 'marquee') {
      const minX = Math.min(drag.startX, cx);
      const minY = Math.min(drag.startY, cy);
      const maxX = Math.max(drag.startX, cx);
      const maxY = Math.max(drag.startY, cy);

      editor.setMarquee({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });

      // Select nodes inside marquee
      const ids: string[] = [];
      for (const node of editor.graph.getAllNodes()) {
        if (!node.visible || node.type === 'CANVAS') continue;
        const abs = editor.graph.getAbsolutePosition(node.id);
        if (
          abs.x >= minX && abs.y >= minY &&
          abs.x + node.width <= maxX && abs.y + node.height <= maxY
        ) {
          ids.push(node.id);
        }
      }
      editor.select(ids);
      editor.requestRender();
      return;
    }

    if (drag.kind === 'create') {
      // Preview shape during creation (will create on pointerup)
      editor.requestRepaint();
      return;
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    const { x: cx, y: cy } = editor.screenToCanvas(localX(e), localY(e));

    if (drag.kind === 'move') {
      // Commit move with undo
      editor.commitMove(drag.originals);
      editor.setSnapGuides([]);
      callbacks.onGraphChanged?.();
    }

    if (drag.kind === 'marquee') {
      editor.setMarquee(null);
      callbacks.onSelectionChanged?.();
    }

    if (drag.kind === 'create') {
      const w = Math.abs(cx - drag.startX);
      const h = Math.abs(cy - drag.startY);
      const x = Math.min(cx, drag.startX);
      const y = Math.min(cy, drag.startY);

      // Only create if dragged a meaningful distance
      if (w > 5 && h > 5) {
        const type = drag.tool === 'TEXT' ? 'TEXT'
          : drag.tool === 'ELLIPSE' ? 'ELLIPSE'
          : drag.tool === 'RECTANGLE' ? 'RECTANGLE'
          : 'FRAME';

        // Find parent (page or entered container)
        const parentId = editor.state.enteredContainerId
          ?? editor.getPages()[0]?.id
          ?? editor.graph.rootId;

        const nodeId = editor.createShape(type as any, x, y, w, h, parentId);
        editor.select([nodeId]);
        editor.setTool('SELECT');

        callbacks.onGraphChanged?.();
        callbacks.onSelectionChanged?.();
        callbacks.onLayerTreeChanged?.();
      }

      // Switch back to select tool
      editor.setTool('SELECT');
    }

    if (drag.kind === 'pan') {
      canvas.style.cursor = editor.state.activeTool === 'HAND' ? 'grab' : 'default';
    }

    canvas.releasePointerCapture(e.pointerId);
    drag = null;
    editor.requestRender();
  }

  // Prevent default context menu
  function onContextMenu(e: Event) {
    e.preventDefault();
  }

  // Wheel zoom/pan
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY > 0 ? 1.5 : -1.5;
      editor.applyZoom(delta, localX(e), localY(e));
    } else {
      editor.pan(-e.deltaX, -e.deltaY);
    }
    editor.requestRender();
  }

  // Double-click: enter frame (select children) or start text editing
  function onDblClick(e: MouseEvent) {
    const { x: cx, y: cy } = editor.screenToCanvas(localX(e as any), localY(e as any));
    // Deep hit test — find the deepest node at this point
    const hit = editor.hitTestAtPoint(cx, cy, true);
    if (hit) {
      if (hit.type === 'TEXT') {
        editor.startTextEditing?.(hit.id);
      } else {
        // Enter the container and select the child
        editor.select([hit.id]);
      }
      editor.requestRender();
      callbacks.onSelectionChanged?.();
    }
  }

  // Attach listeners
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // Cleanup
  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('contextmenu', onContextMenu);
    canvas.removeEventListener('dblclick', onDblClick);
    canvas.removeEventListener('wheel', onWheel);
  };
}
