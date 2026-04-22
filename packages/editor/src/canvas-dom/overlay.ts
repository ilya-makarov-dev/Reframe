/**
 * Selection overlay for the DOM canvas.
 *
 * Draws a bounding-box rectangle + 8 resize handles + 4 rotate corners over
 * the iframe. Lives in a transform-synced sibling div so it scales with
 * zoom/pan exactly.
 *
 * Does NOT own the drag/resize logic — emits `onHandleDrag(which, dx, dy)`
 * events and expects the host to translate them into INode mutations via
 * the existing `/api/node/edit` path. Same event shape the OP canvas uses
 * so the MCP Platform UI tooling (`reframe_ui probe` / `act`) keeps
 * working without changes.
 */

export type HandlePosition = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface SelectionRect {
  /** Scene-space coords (pre-transform), CSS px. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayOptions {
  container: HTMLElement;
  onHandleDrag?: (which: HandlePosition, dx: number, dy: number, phase: 'start' | 'move' | 'end') => void;
  onBodyDrag?: (dx: number, dy: number, phase: 'start' | 'move' | 'end') => void;
}

export function createSelectionOverlay(opts: OverlayOptions): {
  setSelection: (rect: SelectionRect | null) => void;
  syncTransform: (zoom: number, panX: number, panY: number) => void;
  destroy: () => void;
} {
  const wrapper = document.createElement('div');
  wrapper.className = 'rfd-overlay-root';
  Object.assign(wrapper.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none', // default: pass through to iframe
    transformOrigin: '0 0',
  });

  const bbox = document.createElement('div');
  bbox.className = 'rfd-overlay-bbox';
  Object.assign(bbox.style, {
    position: 'absolute',
    border: '1.5px solid #2b74ff',
    boxSizing: 'border-box',
    pointerEvents: 'none', // bbox itself is visual-only; body drag lives elsewhere
    display: 'none',
  });
  wrapper.appendChild(bbox);

  const handles: Record<HandlePosition, HTMLElement> = {} as any;
  const HANDLE_POSITIONS: HandlePosition[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const HANDLE_CURSORS: Record<HandlePosition, string> = {
    nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize',
    se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize',
  };
  for (const pos of HANDLE_POSITIONS) {
    const h = document.createElement('div');
    h.className = `rfd-handle rfd-handle-${pos}`;
    Object.assign(h.style, {
      position: 'absolute',
      width: '8px', height: '8px',
      background: '#ffffff',
      border: '1.5px solid #2b74ff',
      borderRadius: '1px',
      boxSizing: 'border-box',
      pointerEvents: 'auto', // handles receive events
      cursor: HANDLE_CURSORS[pos],
      display: 'none',
    });
    h.dataset.handle = pos;
    handles[pos] = h;
    wrapper.appendChild(h);
  }

  // Handle drag wiring.
  let active: { pos: HandlePosition; startX: number; startY: number } | null = null;
  const onDown = (e: MouseEvent) => {
    const el = e.target as HTMLElement;
    const pos = el?.dataset?.handle as HandlePosition | undefined;
    if (!pos) return;
    e.stopPropagation();
    e.preventDefault();
    active = { pos, startX: e.clientX, startY: e.clientY };
    opts.onHandleDrag?.(pos, 0, 0, 'start');
  };
  const onMove = (e: MouseEvent) => {
    if (!active) return;
    opts.onHandleDrag?.(active.pos, e.clientX - active.startX, e.clientY - active.startY, 'move');
  };
  const onUp = (e: MouseEvent) => {
    if (!active) return;
    opts.onHandleDrag?.(active.pos, e.clientX - active.startX, e.clientY - active.startY, 'end');
    active = null;
  };
  wrapper.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  opts.container.appendChild(wrapper);

  // Local pan/zoom cache — used by setSelection to position bbox+handles
  // in POST-transform coords (the wrapper is in transform-child space
  // because it's synced). Handles live at scene-space offsets.
  let zoom = 1, panX = 0, panY = 0;
  let currentRect: SelectionRect | null = null;
  const HANDLE_SIZE = 8;

  const redraw = () => {
    if (!currentRect) {
      bbox.style.display = 'none';
      for (const pos of HANDLE_POSITIONS) handles[pos].style.display = 'none';
      return;
    }
    const { x, y, width, height } = currentRect;
    bbox.style.display = 'block';
    // bbox drawn in SCENE coords; wrapper's transform takes care of scale/pan
    Object.assign(bbox.style, {
      left: `${x}px`, top: `${y}px`,
      width: `${width}px`, height: `${height}px`,
    });
    // Handles: 8px squares, positioned at corners/midpoints of bbox in
    // scene space BUT un-scaled (they should be ~8px on screen regardless
    // of zoom). We compute their size in scene units: HANDLE_SIZE / zoom.
    const hs = HANDLE_SIZE / zoom;
    const offs = hs / 2;
    const points: Record<HandlePosition, { x: number; y: number }> = {
      nw: { x: x - offs, y: y - offs },
      n:  { x: x + width / 2 - offs, y: y - offs },
      ne: { x: x + width - offs, y: y - offs },
      e:  { x: x + width - offs, y: y + height / 2 - offs },
      se: { x: x + width - offs, y: y + height - offs },
      s:  { x: x + width / 2 - offs, y: y + height - offs },
      sw: { x: x - offs, y: y + height - offs },
      w:  { x: x - offs, y: y + height / 2 - offs },
    };
    for (const pos of HANDLE_POSITIONS) {
      const p = points[pos];
      Object.assign(handles[pos].style, {
        display: 'block',
        left: `${p.x}px`, top: `${p.y}px`,
        width: `${hs}px`, height: `${hs}px`,
      });
    }
    // Also make bbox stroke scale-invariant via CSS variable.
    bbox.style.borderWidth = `${1.5 / zoom}px`;
  };

  return {
    setSelection: (rect) => { currentRect = rect; redraw(); },
    syncTransform: (z, px, py) => {
      zoom = z; panX = px; panY = py;
      wrapper.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
      redraw();
    },
    destroy: () => {
      wrapper.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      wrapper.remove();
    },
  };
}
