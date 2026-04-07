/**
 * Engine Bridge — connects CLI to the reframe core engine.
 *
 * Initializes the SceneGraph + StandaloneHost,
 * wires up the scaling pipeline, runs adaptation.
 */

// Re-export engine types for convenience
export { SceneGraph } from '../../core/src/engine/scene-graph';
export { StandaloneHost } from '../../core/src/adapters/standalone/adapter';
export { StandaloneNode } from '../../core/src/adapters/standalone/node';
export { setHost, getHost } from '../../core/src/host/context';
export { computeLayout, computeAllLayouts, setTextMeasurer } from '../../core/src/engine/layout';
export { loadFont, ensureNodeFont, collectFontKeys, setFontRegistrar } from '../../core/src/engine/fonts';
export { initYoga } from '../../core/src/engine/yoga-init';

// Engine types
export type { SceneNode } from '../../core/src/engine/types';
export type { INode, IHost } from '../../core/src/host/types';

// Scaling pipeline
export {
  uniformScaleForLetterbox,
  centeredLetterboxOffsets,
  rectCenterLocal,
} from '../../core/src/resize/geometry/fit';

// Constraints
export { applyConstraints, computeConstrainedPosition } from '../../core/src/engine/constraints';

// Importers & Exporters
export { importFromFigma, importFromFigmaResponse } from '../../core/src/importers/figma-rest';
export { importFromSvg } from '../../core/src/importers/svg';
export { exportToSvg, exportSceneGraphToSvg } from '../../core/src/exporters/svg';

import { SceneGraph } from '../../core/src/engine/scene-graph';
import { StandaloneHost } from '../../core/src/adapters/standalone/adapter';
import { StandaloneNode } from '../../core/src/adapters/standalone/node';
import { setHost } from '../../core/src/host/context';
import { computeAllLayouts } from '../../core/src/engine/layout';
import { applyConstraints } from '../../core/src/engine/constraints';

// ─── Target Size ────────────────────────────────────────────────

export interface TargetSize {
  width: number;
  height: number;
  label?: string;
}

export function parseTarget(spec: string): TargetSize {
  const match = spec.match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`Invalid target format: "${spec}" (expected WxH, e.g. 1080x1920)`);
  return {
    width: parseInt(match[1], 10),
    height: parseInt(match[2], 10),
    label: spec,
  };
}

// ─── Adaptation Engine ──────────────────────────────────────────

export interface AdaptResult {
  target: TargetSize;
  rootId: string;
  graph: SceneGraph;
  stats: {
    nodesProcessed: number;
    scaleX: number;
    scaleY: number;
    strategy: string;
    durationMs: number;
  };
}

/**
 * Core adaptation: take a scene graph and adapt it to a target size.
 *
 * Strategy:
 * - smart: cluster-aware projection (anisotropic bg, uniform content)
 * - contain: uniform scale, fit inside target with letterbox
 * - cover: uniform scale, fill target, clip overflow
 * - stretch: non-uniform scale to exact target
 */
export function adaptScene(
  sourceGraph: SceneGraph,
  sourceRootId: string,
  target: TargetSize,
  strategy = 'smart',
): AdaptResult {
  const t0 = Date.now();

  // Clone scene for adaptation
  const graph = new SceneGraph();
  const page = graph.addPage('Adapted');

  // Deep clone source tree into new graph
  const sourceRoot = sourceGraph.getNode(sourceRootId);
  if (!sourceRoot) throw new Error(`Source root ${sourceRootId} not found`);

  const clonedRootId = deepCloneInto(graph, sourceGraph, sourceRootId, page.id);
  const root = graph.getNode(clonedRootId)!;

  const srcW = root.width;
  const srcH = root.height;
  const dstW = target.width;
  const dstH = target.height;

  let scaleX: number;
  let scaleY: number;

  switch (strategy) {
    case 'contain': {
      const s = Math.min(dstW / srcW, dstH / srcH);
      scaleX = s;
      scaleY = s;
      break;
    }
    case 'cover': {
      const s = Math.max(dstW / srcW, dstH / srcH);
      scaleX = s;
      scaleY = s;
      break;
    }
    case 'stretch': {
      scaleX = dstW / srcW;
      scaleY = dstH / srcH;
      break;
    }
    case 'constraints': {
      // Constraint-based: use Figma-style constraints for repositioning
      scaleX = dstW / srcW;
      scaleY = dstH / srcH;
      graph.updateNode(clonedRootId, { width: dstW, height: dstH });
      applyConstraints(graph, clonedRootId, { srcWidth: srcW, srcHeight: srcH, dstWidth: dstW, dstHeight: dstH });
      // Skip the default resize + scaleChildren below
      computeAllLayouts(graph, clonedRootId);
      const constraintNodes = countNodes(graph, clonedRootId);
      return {
        target, rootId: clonedRootId, graph,
        stats: { nodesProcessed: constraintNodes, scaleX, scaleY, strategy, durationMs: Date.now() - t0 },
      };
    }

    case 'smart':
    default: {
      // Smart: uniform scale for content, anisotropic for background
      const uniformScale = Math.min(dstW / srcW, dstH / srcH);
      scaleX = uniformScale;
      scaleY = uniformScale;

      // Apply anisotropic scaling to background nodes
      applySmartScaling(graph, clonedRootId, srcW, srcH, dstW, dstH, uniformScale);
      break;
    }
  }

  // Resize root frame
  graph.updateNode(clonedRootId, { width: dstW, height: dstH });

  // Scale all children
  if (strategy !== 'smart') {
    scaleChildren(graph, clonedRootId, scaleX, scaleY);
  }

  // Recompute layout
  computeAllLayouts(graph, clonedRootId);

  const nodesProcessed = countNodes(graph, clonedRootId);

  return {
    target,
    rootId: clonedRootId,
    graph,
    stats: {
      nodesProcessed,
      scaleX,
      scaleY,
      strategy,
      durationMs: Date.now() - t0,
    },
  };
}

// ─── Smart Scaling ──────────────────────────────────────────────

function applySmartScaling(
  graph: SceneGraph,
  rootId: string,
  srcW: number, srcH: number,
  dstW: number, dstH: number,
  uniformScale: number,
): void {
  const root = graph.getNode(rootId);
  if (!root) return;

  for (const childId of root.childIds) {
    const child = graph.getNode(childId);
    if (!child) continue;

    const isBackground = isBackgroundNode(child, srcW, srcH);

    if (isBackground) {
      // Background: stretch to fill target
      graph.updateNode(childId, {
        x: 0, y: 0,
        width: dstW, height: dstH,
      });
    } else {
      // Content: uniform scale + center
      const newW = child.width * uniformScale;
      const newH = child.height * uniformScale;
      const newX = child.x * uniformScale + (dstW - srcW * uniformScale) / 2;
      const newY = child.y * uniformScale + (dstH - srcH * uniformScale) / 2;

      graph.updateNode(childId, {
        x: newX, y: newY,
        width: newW, height: newH,
      });

      // Scale grandchildren uniformly
      scaleChildren(graph, childId, uniformScale, uniformScale);
    }
  }
}

function isBackgroundNode(node: any, parentW: number, parentH: number): boolean {
  // Heuristic: node covers >80% of parent and is at position ~(0,0)
  const coverageX = node.width / parentW;
  const coverageY = node.height / parentH;
  const nearOrigin = Math.abs(node.x) < parentW * 0.05 && Math.abs(node.y) < parentH * 0.05;
  const hasImageFill = node.fills?.some((f: any) => f.type === 'IMAGE');
  const isBigRect = coverageX > 0.8 && coverageY > 0.8;

  return nearOrigin && (isBigRect || hasImageFill);
}

// ─── Utility ────────────────────────────────────────────────────

function scaleChildren(
  graph: SceneGraph,
  parentId: string,
  sx: number, sy: number,
): void {
  const parent = graph.getNode(parentId);
  if (!parent) return;

  for (const childId of parent.childIds) {
    const child = graph.getNode(childId);
    if (!child) continue;

    graph.updateNode(childId, {
      x: child.x * sx,
      y: child.y * sy,
      width: child.width * sx,
      height: child.height * sy,
      fontSize: child.type === 'TEXT' ? child.fontSize * Math.min(sx, sy) : child.fontSize,
    });

    scaleChildren(graph, childId, sx, sy);
  }
}

function deepCloneInto(
  dest: SceneGraph,
  source: SceneGraph,
  sourceNodeId: string,
  destParentId: string,
): string {
  const src = source.getNode(sourceNodeId);
  if (!src) throw new Error(`Source node ${sourceNodeId} not found`);

  const overrides: Record<string, any> = {};
  const skip = new Set(['id', 'parentId', 'childIds']);

  for (const [key, value] of Object.entries(src)) {
    if (skip.has(key)) continue;
    if (typeof value === 'object' && value !== null) {
      overrides[key] = JSON.parse(JSON.stringify(value));
    } else {
      overrides[key] = value;
    }
  }

  const cloned = dest.createNode(src.type, destParentId, overrides);

  for (const childId of src.childIds) {
    deepCloneInto(dest, source, childId, cloned.id);
  }

  return cloned.id;
}

function countNodes(graph: SceneGraph, rootId: string): number {
  let count = 1;
  const node = graph.getNode(rootId);
  if (node) {
    for (const childId of node.childIds) {
      count += countNodes(graph, childId);
    }
  }
  return count;
}
