/**
 * Phase 8 — Gesture geometry helpers.
 *
 * Pure functions used by the gesture substrate (Platform UI inlines
 * identical copies into its client-side JS template literal because the
 * browser needs them synchronously without a network hop). Keeping them
 * here gives us:
 *   1. Unit test coverage — the client-side copies are trivially kept in
 *      sync by diff, and the TS versions are the reference.
 *   2. Reuse when future clients (VS Code plugin, CLI) need the same
 *      hit-testing logic without duplicating ad-hoc.
 */

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Polygon = Array<[number, number]>;

export interface InodeMeasurement {
  inode: string;
  tag: string;
  bbox: BBox;
  /** Compact computed-style signature for resonance matching. */
  style?: {
    bg?: string;
    color?: string;
    fs?: string;
    fw?: string;
    ff?: string;
    br?: string;
    pad?: string;
    display?: string;
  };
  className?: string;
  role?: string;
  text?: string;
}

// ─── Polygon hit-testing ────────────────────────────────────

/**
 * Ray-casting point-in-polygon test. Polygon is a closed loop — the
 * last vertex is implicitly connected back to the first. Returns true
 * when (x, y) is strictly inside the polygon (or on-edge, depending on
 * the tie-breaking of the intersect test — good enough for lasso).
 */
export function pointInPolygon(x: number, y: number, polygon: Polygon): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Whether the CENTER of the bbox lies inside the polygon. Used by the
 *  Lasso tool — "contained" = center is enclosed. Fast and intuitive. */
export function bboxCenterInPolygon(bbox: BBox, polygon: Polygon): boolean {
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  return pointInPolygon(cx, cy, polygon);
}

// ─── BBox hit-testing ───────────────────────────────────────

/** Whether a point lies inside an axis-aligned bbox. */
export function pointInBBox(x: number, y: number, b: BBox): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/**
 * Given a point in iframe-document space and a list of measurements,
 * return the inode of the **innermost** (smallest-area) bbox that
 * contains the point. This mirrors DOM event targeting: when multiple
 * ancestors contain a click position, the smallest descendant wins.
 *
 * Returns null when no bbox contains the point.
 */
export function hitTestInnermost(
  x: number,
  y: number,
  measurements: Iterable<InodeMeasurement>,
): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const m of measurements) {
    const b = m.bbox;
    if (!pointInBBox(x, y, b)) continue;
    const area = b.w * b.h;
    if (area > 0 && area < bestArea) {
      best = m.inode;
      bestArea = area;
    }
  }
  return best;
}

// ─── Resonance matching ────────────────────────────────────

export type ResonanceAxis = 'tag' | 'class' | 'style' | 'role' | 'content' | 'position';

/**
 * Pure match predicate: does `candidate` match `seed` along EVERY axis
 * in the requested set? This is AND semantics — the user gets
 * progressively more restrictive results by enabling more axes.
 *
 * Axis definitions:
 *   tag      — same DOM tag name (button, div, p, …)
 *   class    — identical className string (exact match — substring
 *              matching is a future refinement)
 *   role     — identical data-role attribute
 *   style    — same computed background, font size, font weight
 *   content  — same textContent (trimmed, truncated to 60 chars)
 *   position — same display + same width (±5%) — structural rhythm
 */
export function matchesResonanceAxes(
  seed: InodeMeasurement,
  candidate: InodeMeasurement,
  axes: ResonanceAxis[],
): boolean {
  for (const axis of axes) {
    if (!matchesAxis(seed, candidate, axis)) return false;
  }
  return true;
}

function matchesAxis(
  seed: InodeMeasurement,
  candidate: InodeMeasurement,
  axis: ResonanceAxis,
): boolean {
  switch (axis) {
    case 'tag':
      return seed.tag === candidate.tag;
    case 'class':
      return (seed.className ?? '') === (candidate.className ?? '');
    case 'role':
      return (seed.role ?? '') === (candidate.role ?? '');
    case 'style': {
      const s = seed.style ?? {};
      const c = candidate.style ?? {};
      return s.bg === c.bg && s.fs === c.fs && s.fw === c.fw;
    }
    case 'content':
      return (seed.text ?? '') === (candidate.text ?? '');
    case 'position': {
      const s = seed.style ?? {};
      const c = candidate.style ?? {};
      if (s.display !== c.display) return false;
      const ws = seed.bbox.w;
      const wc = candidate.bbox.w;
      if (ws === 0 || wc === 0) return ws === wc;
      const ratio = Math.abs(ws - wc) / Math.max(ws, wc);
      return ratio <= 0.05;
    }
  }
}

/**
 * Apply the axis predicate across a list of candidates, skipping the
 * seed itself. Returns the inodes that matched.
 */
export function findResonanceMatches(
  seed: InodeMeasurement,
  candidates: Iterable<InodeMeasurement>,
  axes: ResonanceAxis[],
): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (c.inode === seed.inode) continue;
    if (matchesResonanceAxes(seed, c, axes)) out.push(c.inode);
  }
  return out;
}

// ─── Bbox utility for rendering ──────────────────────────

/**
 * Compute a bbox that encloses every bbox in the input. Used by the
 * brush-stroke renderer to position its label, and by resonance to
 * show a "bounding box of all matches" overlay.
 */
export function unionBBox(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
