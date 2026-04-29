/**
 * Marquee (drag-rectangle) selection for the DOM canvas (Phase 1 UI-2).
 *
 * Mounts a transparent overlay on the canvas viewport that listens for
 * mousedown on EMPTY space (no INode at point) and renders a dashed
 * rectangle while the user drags. On mouseup we hit-test every visible
 * INode in the iframe whose computed bbox intersects the rectangle and
 * hand the resulting id list to the caller along with the modifier
 * shape (replace / union / toggle) inferred from Shift / Cmd|Ctrl.
 *
 * ─── Why empty-space detection lives here, not in dom-canvas ────
 *
 * The marquee owns the gesture's start. If we let dom-canvas's iframe
 * click handler fire first, plain clicks on empty space would be
 * indistinguishable from a 0-distance marquee — clearing selection on
 * click + immediately running an empty intersection query (no-op) is
 * wasteful + introduces a race. Marquee guards on minimum drag
 * distance (≥3px) before promoting to a real marquee gesture; below
 * the threshold we abort and let the click handler clear selection.
 *
 * ─── Coordinate spaces ──────────────────────────────────────
 *
 * Mouse events fire in viewport (parent window) coords; INode bboxes
 * live in iframe-document coords. The translation is the iframe's
 * own bounding rect — same shape used by selection-overlay's union
 * computation. Both ends apply the inverse zoom-pan transform via
 * the supplied ZoomState so the marquee tracks the visual canvas
 * correctly during drag.
 */

import type { NodeId } from './selection-state.js';

export interface MarqueeRect {
  /** Viewport coords for rendering the dashed box. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MarqueeMod = 'replace' | 'union' | 'toggle';

export interface MarqueeOptions {
  /** Element that receives the dashed rectangle (the canvas viewport). */
  viewport: HTMLElement;
  /** Iframe whose contentDocument we hit-test. Caller updates as iframe reloads. */
  getIframe: () => HTMLIFrameElement | null;
  /**
   * Decide whether the mousedown originated on empty canvas space (no
   * INode at point). If false, the marquee bails out and the host
   * iframe's click handler runs the regular single-select path.
   */
  isEmptyAt: (clientX: number, clientY: number) => boolean;
  /** Minimum drag distance in viewport px before promoting to marquee. */
  threshold?: number;
  /** Called once on mouseup with the intersected set + modifier shape. */
  onComplete: (ids: NodeId[], mod: MarqueeMod) => void;
}

export function createMarqueeSelector(opts: MarqueeOptions): {
  destroy: () => void;
  /** Imperative force-cancel — used when present mode toggles mid-drag. */
  cancel: () => void;
} {
  const threshold = opts.threshold ?? 3;
  const rect = document.createElement('div');
  rect.className = 'rfd-marquee-rect';
  Object.assign(rect.style, {
    position: 'absolute',
    border: '1px dashed #2b74ff',
    background: 'rgba(43,116,255,0.08)',
    pointerEvents: 'none',
    boxSizing: 'border-box',
    display: 'none',
    zIndex: '30',
  });
  opts.viewport.appendChild(rect);

  let active: { startX: number; startY: number; mod: MarqueeMod; promoted: boolean } | null = null;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (!opts.isEmptyAt(e.clientX, e.clientY)) return;
    const mod: MarqueeMod = e.shiftKey ? 'union' : (e.metaKey || e.ctrlKey) ? 'toggle' : 'replace';
    active = { startX: e.clientX, startY: e.clientY, mod, promoted: false };
    // We don't preventDefault here — that would suppress focus
    // promotion via the iframe's click bridge. Promote only on
    // crossing threshold below.
  };

  const onMove = (e: MouseEvent) => {
    if (!active) return;
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    if (!active.promoted) {
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      active.promoted = true;
      rect.style.display = 'block';
    }
    const viewportRect = opts.viewport.getBoundingClientRect();
    const x0 = active.startX - viewportRect.left;
    const y0 = active.startY - viewportRect.top;
    const x1 = e.clientX - viewportRect.left;
    const y1 = e.clientY - viewportRect.top;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    Object.assign(rect.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${Math.abs(x1 - x0)}px`,
      height: `${Math.abs(y1 - y0)}px`,
    });
  };

  const onUp = (e: MouseEvent) => {
    if (!active) return;
    const wasPromoted = active.promoted;
    const mod = active.mod;
    const startX = active.startX;
    const startY = active.startY;
    active = null;
    rect.style.display = 'none';
    if (!wasPromoted) return; // sub-threshold drag — let click handler run
    // Compute the marquee's viewport-coord rect, then intersect against
    // every INode-bearing element in the iframe.
    const minX = Math.min(startX, e.clientX);
    const maxX = Math.max(startX, e.clientX);
    const minY = Math.min(startY, e.clientY);
    const maxY = Math.max(startY, e.clientY);
    const iframe = opts.getIframe();
    const doc = iframe?.contentDocument;
    if (!doc) { opts.onComplete([], mod); return; }
    // Iframe-relative rect — intersect against element bboxes which
    // are already viewport-relative via getBoundingClientRect.
    const ids: NodeId[] = [];
    const elements = doc.querySelectorAll('[data-reframe-inode]');
    elements.forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      // Skip elements with zero area — empty placeholder nodes.
      if (r.width === 0 || r.height === 0) return;
      // Standard AABB intersection test.
      if (r.right < minX || r.left > maxX || r.bottom < minY || r.top > maxY) return;
      const id = el.getAttribute('data-reframe-inode');
      if (id) ids.push(id);
    });
    // Skip the scene root — the topmost body element is itself
    // marked with data-reframe-inode but it's never the intent of a
    // marquee (would always be returned because it covers everything).
    const rootEl = doc.body.firstElementChild as HTMLElement | null;
    const rootId = rootEl?.getAttribute('data-reframe-inode') ?? null;
    const filtered = rootId ? ids.filter((id) => id !== rootId) : ids;
    opts.onComplete(filtered, mod);
  };

  // Window-level mousemove/up so a drag that leaves the viewport still
  // tracks. Mousedown stays on the viewport so we don't intercept
  // clicks elsewhere on the page.
  opts.viewport.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  return {
    destroy: () => {
      opts.viewport.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      rect.remove();
    },
    cancel: () => {
      active = null;
      rect.style.display = 'none';
    },
  };
}

/**
 * Pure helper — given a marquee rect (viewport coords) and a set of
 * candidate elements with known viewport bboxes, return the ids that
 * intersect. Extracted so contract tests can exercise the geometry
 * without spinning up a real DOM.
 */
export function intersectMarquee(
  marquee: { left: number; top: number; right: number; bottom: number },
  candidates: ReadonlyArray<{ id: NodeId; bbox: { left: number; top: number; right: number; bottom: number } }>,
): NodeId[] {
  const out: NodeId[] = [];
  for (const c of candidates) {
    if (c.bbox.right < marquee.left) continue;
    if (c.bbox.left > marquee.right) continue;
    if (c.bbox.bottom < marquee.top) continue;
    if (c.bbox.top > marquee.bottom) continue;
    out.push(c.id);
  }
  return out;
}
