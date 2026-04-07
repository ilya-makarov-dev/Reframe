/**
 * Constraint-Based Positioning
 *
 * Applies Figma-style constraints during layout adaptation.
 * When a parent frame resizes, child elements reposition based on their
 * horizontal/vertical constraints (MIN, CENTER, MAX, STRETCH, SCALE).
 *
 * This replaces naive uniform scaling with intelligent repositioning.
 */

import type { SceneGraph } from './scene-graph';
import type { ConstraintType } from './types';

export interface ConstraintContext {
  /** Original parent width before adaptation */
  srcWidth: number;
  /** Original parent height before adaptation */
  srcHeight: number;
  /** New parent width after adaptation */
  dstWidth: number;
  /** New parent height after adaptation */
  dstHeight: number;
}

interface NodeGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Apply constraint-based repositioning to all children of a node.
 *
 * Instead of uniformly scaling everything, this respects each child's
 * horizontal/vertical constraints to determine how it should move/resize.
 */
export function applyConstraints(
  graph: SceneGraph,
  parentId: string,
  ctx: ConstraintContext,
): void {
  const parent = graph.getNode(parentId);
  if (!parent) return;

  for (const childId of parent.childIds) {
    const child = graph.getNode(childId);
    if (!child) continue;

    // Skip nodes that are in auto-layout (constraints don't apply)
    if (child.layoutPositioning === 'AUTO' && parent.layoutMode !== 'NONE') continue;

    const original: NodeGeometry = {
      x: child.x,
      y: child.y,
      width: child.width,
      height: child.height,
    };

    const result = computeConstrainedPosition(
      original,
      child.horizontalConstraint || 'MIN',
      child.verticalConstraint || 'MIN',
      ctx,
    );

    graph.updateNode(childId, result);

    // Recursively apply constraints to children if this node also resized
    if (child.childIds.length > 0) {
      const childCtx: ConstraintContext = {
        srcWidth: original.width,
        srcHeight: original.height,
        dstWidth: result.width,
        dstHeight: result.height,
      };

      // Only recurse if the child actually changed size
      if (childCtx.srcWidth !== childCtx.dstWidth || childCtx.srcHeight !== childCtx.dstHeight) {
        applyConstraints(graph, childId, childCtx);
      }
    }
  }
}

/**
 * Compute new position and size for a single node given its constraints.
 */
export function computeConstrainedPosition(
  node: NodeGeometry,
  hConstraint: ConstraintType,
  vConstraint: ConstraintType,
  ctx: ConstraintContext,
): NodeGeometry {
  return {
    ...computeHorizontal(node, hConstraint, ctx),
    ...computeVertical(node, vConstraint, ctx),
  };
}

function computeHorizontal(
  node: NodeGeometry,
  constraint: ConstraintType,
  ctx: ConstraintContext,
): { x: number; width: number } {
  const { srcWidth, dstWidth } = ctx;

  switch (constraint) {
    case 'MIN':
      // Fixed distance from left edge — position and size unchanged
      return { x: node.x, width: node.width };

    case 'MAX': {
      // Fixed distance from right edge
      const distFromRight = srcWidth - (node.x + node.width);
      return { x: dstWidth - node.width - distFromRight, width: node.width };
    }

    case 'CENTER': {
      // Centered horizontally — maintain proportional center position
      const centerRatio = (node.x + node.width / 2) / srcWidth;
      const newCenter = centerRatio * dstWidth;
      return { x: newCenter - node.width / 2, width: node.width };
    }

    case 'STRETCH': {
      // Fixed distance from both edges — width changes
      const distFromLeft = node.x;
      const distFromRight = srcWidth - (node.x + node.width);
      const newWidth = Math.max(1, dstWidth - distFromLeft - distFromRight);
      return { x: distFromLeft, width: newWidth };
    }

    case 'SCALE': {
      // Scale proportionally with parent
      const scale = dstWidth / srcWidth;
      return { x: node.x * scale, width: node.width * scale };
    }

    default:
      return { x: node.x, width: node.width };
  }
}

function computeVertical(
  node: NodeGeometry,
  constraint: ConstraintType,
  ctx: ConstraintContext,
): { y: number; height: number } {
  const { srcHeight, dstHeight } = ctx;

  switch (constraint) {
    case 'MIN':
      return { y: node.y, height: node.height };

    case 'MAX': {
      const distFromBottom = srcHeight - (node.y + node.height);
      return { y: dstHeight - node.height - distFromBottom, height: node.height };
    }

    case 'CENTER': {
      const centerRatio = (node.y + node.height / 2) / srcHeight;
      const newCenter = centerRatio * dstHeight;
      return { y: newCenter - node.height / 2, height: node.height };
    }

    case 'STRETCH': {
      const distFromTop = node.y;
      const distFromBottom = srcHeight - (node.y + node.height);
      const newHeight = Math.max(1, dstHeight - distFromTop - distFromBottom);
      return { y: distFromTop, height: newHeight };
    }

    case 'SCALE': {
      const scale = dstHeight / srcHeight;
      return { y: node.y * scale, height: node.height * scale };
    }

    default:
      return { y: node.y, height: node.height };
  }
}
