import { type INode, NodeType } from '../../host';

/** Figma: `.parent` on a removed tree node can throw `get_parent: node does not exist`. */
export function safeGetParent(n: INode | null): INode | null {
  if (!n) return null;
  try {
    return n.parent;
  } catch {
    return null;
  }
}

export function collectAllDescendants(node: INode, out: INode[] = []): INode[] {
  if (node.removed) return out;
  out.push(node);
  if (node.children) {
    for (const child of node.children) {
      collectAllDescendants(child, out);
    }
  }
  return out;
}

/** True if subtree has nodes that are almost never a pure backdrop (text, instances, components). */
export function subtreeHasNonBackgroundContentSignals(node: INode): boolean {
  for (const d of collectAllDescendants(node)) {
    const t = d.type;
    if (t === NodeType.Text || t === NodeType.Instance || t === NodeType.Component) return true;
  }
  return false;
}

/**
 * [Production Sacred] Checks if the node or its children contain "meaningful" design:
 * images, text, or complex vector objects.
 */
export function nodeHasDesignContent(node: INode): boolean {
  if (node.type === NodeType.Text || node.type === NodeType.Instance || node.type === NodeType.Component) return true;
  if ('fills' in node && Array.isArray(node.fills)) {
    for (const f of node.fills) {
      if (f.type === 'IMAGE' || f.type === 'GRADIENT_LINEAR' || f.type === 'GRADIENT_RADIAL') return true;
      if (f.type === 'SOLID') {
        const c = (f as any).color;
        /**
         * [Production Rule] Pure white (1,1,1) without transparency is often a technical
         * backdrop/background in master. Black (0,0,0) or colored — that's design (button rects).
         */
        const isWhite = c.r > 0.98 && c.g > 0.98 && c.b > 0.98;
        const op = (f as any).opacity ?? 1;
        if (!isWhite && op > 0.1) return true;
      }
    }
  }
  return false;
}

export function subtreeHasDesignContent(node: INode): boolean {
  for (const d of collectAllDescendants(node)) {
    if (nodeHasDesignContent(d)) return true;
  }
  return false;
}

/**
 * Names like "1080×1920", "Frame 1080 x 1920", "1000_500" (export / dimension wrappers).
 * Single source of truth for post-process exact-session + session-slots hoisting.
 */
export const DIMENSION_LIKE_NAME_PATTERN = /\d+\s*[\u00D7xх*._\-/]\s*\d+/i;

export function isDimensionLikeName(name: string): boolean {
  return DIMENSION_LIKE_NAME_PATTERN.test((name || '').trim());
}

/** Figma/Sketch export labels and empty "Group" shells — not designer semantics. */
export function isTechnicalLabelName(name: string): boolean {
  const n = (name || '').trim().toLowerCase();
  if (n === 'group') return true;
  if (n === 'group 1') return true;
  if (n.includes('(resized)')) return true;
  if (n.includes('clip path group')) return true;
  if (n === 'clip group') return true;
  return false;
}

/** Dimension-style name OR a technical export label (post-process must not re-parse these ad hoc). */
export function isTechnicalArtifactName(name: string): boolean {
  return isDimensionLikeName(name) || isTechnicalLabelName(name);
}

/**
 * FRAME/GROUP that looks like a technical shell and carries no design content in subtree.
 * Used to align "dissolve" behavior with semantic classification (no duplicate heuristics).
 */
export function isMeaninglessWrapper(node: INode): boolean {
  if (node.type !== NodeType.Frame && node.type !== NodeType.Group) return false;
  if (subtreeHasDesignContent(node)) return false;
  return isTechnicalArtifactName(node.name);
}

/**
 * Rect in frame coordinates with area many times larger than frame — often a "runaway"
 * group bbox after letterbox/hoist while slots are already lifted. Such nodes shouldn't be kept
 * on the "has content" branch (see runaway GROUP in bs-log: tens of megapixels on a 1080^2 frame).
 */
export function isRunawayBoundsVersusFrame(
  b: { w: number; h: number },
  frameW: number,
  frameH: number,
  /** Node area > threshold * frame area -> runaway */
  areaRatioThreshold = 24
): boolean {
  const fa = Math.max(frameW * frameH, 1);
  const ba = Math.max(b.w * b.h, 1);
  return ba > fa * areaRatioThreshold;
}

/**
 * Intersection of node bbox (in frame coords) with the frame rect [0,frameW)×[0,frameH).
 */
export function frameIntersectionArea(
  b: { x: number; y: number; w: number; h: number },
  frameW: number,
  frameH: number
): number {
  const ix0 = Math.max(0, b.x);
  const iy0 = Math.max(0, b.y);
  const ix1 = Math.min(frameW, b.x + b.w);
  const iy1 = Math.min(frameH, b.y + b.h);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  return iw * ih;
}

/**
 * After hoist/letterbox, a duplicate group can sit barely inside the frame on one axis but extend
 * almost entirely past the opposite edge (bs-log-universal: GROUP at x≈1078, w≈1039 on 1081-wide frame).
 * `isOutside` misses that because x < frameW. Purge when overlap area is a tiny fraction of the node.
 */
export function isNegligibleOverlapWithFrame(
  b: { x: number; y: number; w: number; h: number },
  frameW: number,
  frameH: number,
  opts?: { minAreaRatio?: number; minNodeArea?: number }
): boolean {
  const minRatio = opts?.minAreaRatio ?? 0.06;
  const minNodeArea = opts?.minNodeArea ?? 2500;
  const nodeArea = Math.max(b.w * b.h, 1);
  const inter = frameIntersectionArea(b, frameW, frameH);
  if (inter === 0) return true;
  if (nodeArea < minNodeArea) return false;
  return inter / nodeArea < minRatio;
}

export function getBoundsInFrame(node: INode, frame: INode): { x: number; y: number; w: number; h: number } {
  /**
   * Like oLD: `absoluteTransform` is the most reliable way to get nested layer coordinates
   * relative to banner, ignoring intermediate group/wrapper offsets.
   */
  if (!node.absoluteTransform || !frame.absoluteTransform) {
    return { x: node.x, y: node.y, w: node.width, h: node.height };
  }
  return {
    x: node.absoluteTransform[0][2] - frame.absoluteTransform[0][2],
    y: node.absoluteTransform[1][2] - frame.absoluteTransform[1][2],
    w: node.width,
    h: node.height
  };
}

export function getLayoutBoundsInFrame(node: INode, frame: INode): { x: number; y: number; w: number; h: number } {
  try {
    if (node.removed) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
    /**
     * For Auto Layout nodes with absolute positioning (or simply nested in Auto Layout)
     * `absoluteTransform` is required, otherwise `node.x/y` returns 0 or false values.
     */
    return getBoundsInFrame(node, frame);
  } catch {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
}

/**
 * Force-neutralize any Figma auto-layout or constraints that might fight manual positioning.
 */
export function neutralizeFigmaLayoutInterference(node: INode, parent: any): void {
  try {
    if (node.removed) return;

    /**
     * [Production Guard] Always force ABSOLUTE for nodes inside Auto Layout frames.
     * Without this, Figma may "reorder" the node right after appendChild before setPosition is called.
     */
    if (node.layoutPositioning !== undefined && parent && parent.layoutMode !== undefined && parent.layoutMode !== 'NONE') {
      node.layoutPositioning = 'ABSOLUTE';
    }

    /**
     * Like oLD: force MIN/MIN so that when parent aspect (group/frame) changes,
     * the layer doesn't "fly away" right/down due to scaling or SCALE constraint.
     */
    if (node.constraints !== undefined) {
      // Cannot change constraints inside instances or boolean operations
      if (parent && parent.type !== NodeType.Instance && (parent.type as string) !== 'BOOLEAN_OPERATION') {
        node.constraints = { horizontal: 'MIN', vertical: 'MIN' };
      }
    }
  } catch (_) {}
}


export function setPositionInFrame(node: INode, frame: INode, frameX: number, frameY: number): void {
  try {
    if (node.removed) return;
    const parent = node.parent;

    neutralizeFigmaLayoutInterference(node, parent);

    if (!parent || (parent.type as string) === 'PAGE' || parent === frame) {
      node.x = Math.round(frameX);
      node.y = Math.round(frameY);
      return;
    }

    if (parent.absoluteTransform && frame.absoluteTransform) {
      const parX = parent.absoluteTransform[0][2] - frame.absoluteTransform[0][2];
      const parY = parent.absoluteTransform[1][2] - frame.absoluteTransform[1][2];

      node.x = Math.round(frameX - parX);
      node.y = Math.round(frameY - parY);
    } else {
      node.x = Math.round(frameX);
      node.y = Math.round(frameY);
    }
  } catch {
    /* stale node / Remember — don't crash the plugin */
  }
}

/**
 * Verifies the node actually ended up at (frameX, frameY) in frame coordinates.
 * Used for [Positioning Guard] to counter "jumps" after Auto Layout or reparenting.
 */
export function verifyAbsolutePosition(node: INode, frame: INode, frameX: number, frameY: number): boolean {
  try {
    if (node.removed) return true;
    const b = getBoundsInFrame(node, frame);
    const dx = Math.abs(b.x - frameX);
    const dy = Math.abs(b.y - frameY);
    // 0.5px precision is usually enough for "snapping"
    return dx < 0.5 && dy < 0.5;
  } catch {
    return true; // if node disappeared — don't loop
  }
}
/**
 * Crawls up the tree from node to frame and sets clipsContent = false on all frames.
 * This prevents \"Letterbox Islands\" from hiding content that moved outside their initial area.
 */
export function ensureNoClippingOnPathToRoot(node: INode, frame: INode): void {
  try {
    let cur: INode | null = node.parent;
    while (cur && cur !== frame) {
      if (cur.type === NodeType.Frame || (cur.type as string) === 'SECTION') {
        if (cur.clipsContent !== undefined) {
          cur.clipsContent = false;
        }
      }
      cur = cur.parent;
    }
  } catch (_) {}
}
