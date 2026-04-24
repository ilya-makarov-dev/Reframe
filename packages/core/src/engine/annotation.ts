/**
 * Scene-level annotation model. Lives as a side-channel on SceneGraph —
 * ONE array per scene, NOT a per-INode field. Each AnnotationNode points
 * at any node in the tree via `targetNodeId`.
 *
 * Why side-channel, not per-node:
 *   - 99% of nodes have zero annotations; per-node array = bloat
 *   - `targetNodeId` makes embedding redundant (parent IS target)
 *   - Queries like "all annotations by author", "reorder by createdAt",
 *     "resolved=false filter" are natural array ops, not tree walks
 *
 * Position is NOT stored as absolute coordinates. The storage shape is
 * `{ targetNodeId, anchor, offsetX?, offsetY? }`. At render time the
 * exporter reads the target node's post-Yoga bbox, computes the anchor
 * point, applies the offset, and emits an absolute-positioned element.
 * Target-relative storage means annotations follow their node when
 * layout reflows (responsive resize, user drag, brand swap).
 *
 * Color is diagnostic, NOT brand-bound. The palette intentionally
 * stands out against scene brand to signal "this is meta, not content" —
 * a designer's note, a critic's finding, not part of the final design.
 */

// ── Core types ─────────────────────────────────────────────

export type AnnotationAnchor = 'nw' | 'ne' | 'sw' | 'se' | 'top' | 'bottom';
export type AnnotationStyle = 'caveat' | 'mono';
export type AnnotationSeverity = 'info' | 'suggestion' | 'warn';

export interface AnnotationNode {
  /** Stable id, generated at create time (format: `a:<base36>`). */
  id: string;
  /** Points at any node in SceneGraph — not restricted to leaf or root. */
  targetNodeId: string;
  /** Note body. No length cap enforced by the engine. */
  text: string;
  /** Corner / edge of target bbox the annotation attaches to. */
  anchor: AnnotationAnchor;
  /** Optional fine-tune from the default offset (px, signed). */
  offsetX?: number;
  offsetY?: number;
  /** Font family. Default 'caveat' (handwritten). Use 'mono' for code-like notes. */
  style?: AnnotationStyle;
  /** Semantic weight. Resolves default color when `color` is omitted. */
  severity?: AnnotationSeverity;
  /** Explicit CSS color. Overrides severity-default. */
  color?: string;
  /** Free-form — typically 'critic' / 'designer' / user initials. */
  author?: string;
  /** ISO 8601 timestamp. */
  createdAt?: string;
  /** When true, annotation is muted (exporters render at half opacity). */
  resolved?: boolean;
}

// ── Helpers ────────────────────────────────────────────────

let _annoIdCounter = 0;

/** Generate a fresh annotation id. Not cryptographic — just unique within a session. */
export function generateAnnotationId(): string {
  _annoIdCounter++;
  return `a:${Date.now().toString(36)}-${_annoIdCounter.toString(36)}`;
}

/**
 * Default color per severity. Intentionally a diagnostic palette —
 * blue/amber/red maps to info/suggestion/warn the same way Chrome
 * DevTools, linters, CI dashboards do. Recognizable-at-a-glance.
 */
export function defaultColorForSeverity(severity?: AnnotationSeverity): string {
  switch (severity ?? 'info') {
    case 'info': return '#4a90e2';
    case 'suggestion': return '#f5a623';
    case 'warn': return '#d0021b';
  }
}

/** Resolved final color — explicit > severity default > info default. */
export function resolveAnnotationColor(a: AnnotationNode): string {
  return a.color ?? defaultColorForSeverity(a.severity);
}

export function resolveAnnotationStyle(a: AnnotationNode): AnnotationStyle {
  return a.style ?? 'caveat';
}

/**
 * Default offset per anchor — applied when offsetX/offsetY are not
 * explicitly set. Chosen so the annotation sits just OUTSIDE the target
 * bbox corner so it reads as a note-about, not content-in.
 *
 * Units = pixels in scene coordinate space (same as node.x/y).
 */
export const DEFAULT_ANCHOR_OFFSETS: Record<AnnotationAnchor, { x: number; y: number }> = {
  nw: { x: -20, y: -20 },
  ne: { x: 20, y: -20 },
  sw: { x: -20, y: 20 },
  se: { x: 20, y: 20 },
  top: { x: 0, y: -40 },
  bottom: { x: 0, y: 40 },
};

/** Width/height of a target node expected to be post-Yoga resolved. */
export interface AnchorableNodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnchorPoint {
  /** Pixel coord in the same space as node.x / node.y (target-absolute). */
  x: number;
  y: number;
  /**
   * Which corner/edge the bracket decoration should point TOWARD. For
   * anchors 'nw' / 'ne' / 'sw' / 'se' this mirrors the anchor; for 'top'
   * / 'bottom' it defaults to 'top' / 'bottom' respectively. Exporter
   * uses this to rotate the corner-bracket pseudo-element.
   */
  bracketDirection: 'nw' | 'ne' | 'sw' | 'se' | 'top' | 'bottom';
}

/**
 * Resolve an annotation's absolute position given its target's
 * post-Yoga bbox. The returned (x, y) is where the annotation's top-left
 * corner should be placed. Exporters render a span at that coordinate.
 *
 * Both target bbox and returned point are in the SAME coordinate space
 * (typically target-absolute via computeAbsolutePosition, so the scene's
 * root-relative coord space).
 */
export function resolveAnchorPoint(
  a: AnnotationNode,
  targetBox: AnchorableNodeBox,
): AnchorPoint {
  const base = DEFAULT_ANCHOR_OFFSETS[a.anchor];
  const ox = a.offsetX ?? base.x;
  const oy = a.offsetY ?? base.y;

  let cx: number;
  let cy: number;
  switch (a.anchor) {
    case 'nw':
      cx = targetBox.x; cy = targetBox.y;
      break;
    case 'ne':
      cx = targetBox.x + targetBox.width; cy = targetBox.y;
      break;
    case 'sw':
      cx = targetBox.x; cy = targetBox.y + targetBox.height;
      break;
    case 'se':
      cx = targetBox.x + targetBox.width; cy = targetBox.y + targetBox.height;
      break;
    case 'top':
      cx = targetBox.x + targetBox.width / 2; cy = targetBox.y;
      break;
    case 'bottom':
      cx = targetBox.x + targetBox.width / 2; cy = targetBox.y + targetBox.height;
      break;
  }

  return {
    x: cx + ox,
    y: cy + oy,
    bracketDirection: a.anchor,
  };
}

/**
 * Called by `reframe_edit op=annotate` to construct a complete
 * AnnotationNode from partial input, filling defaults for the optional
 * fields. Does NOT validate targetNodeId — that's the op handler's job.
 */
export function createAnnotation(input: {
  targetNodeId: string;
  text: string;
  anchor: AnnotationAnchor;
  offsetX?: number;
  offsetY?: number;
  style?: AnnotationStyle;
  severity?: AnnotationSeverity;
  color?: string;
  author?: string;
}): AnnotationNode {
  return {
    id: generateAnnotationId(),
    targetNodeId: input.targetNodeId,
    text: input.text,
    anchor: input.anchor,
    offsetX: input.offsetX,
    offsetY: input.offsetY,
    style: input.style ?? 'caveat',
    severity: input.severity ?? 'info',
    color: input.color,
    author: input.author,
    createdAt: new Date().toISOString(),
    resolved: false,
  };
}
