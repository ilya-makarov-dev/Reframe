/**
 * Whitespace fraction metric.
 *
 * Measures the ratio of empty space to total area.
 * Optimal is around 40-60% (well-breathed layout).
 * Too dense or too sparse scores lower.
 */

import type { SceneGraph } from '../engine/scene-graph';

const OPTIMAL_COVERAGE = 0.50;
const VARIANCE = 0.08; // Gaussian spread

/**
 * Compute whitespace score for a scene.
 * @returns 0-1 where 1 = optimal whitespace ratio (~50%)
 */
export function measureWhitespace(graph: SceneGraph, rootId: string): number {
  const root = graph.getNode(rootId);
  if (!root) return 1;

  const rootArea = root.width * root.height;
  if (rootArea <= 0) return 1;

  // Sum leaf node areas (nodes with no children, or text nodes)
  let filledArea = 0;

  function walkLeaves(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;

    const isLeaf = node.childIds.length === 0;
    const isText = node.type === 'TEXT';

    if (isLeaf || isText) {
      filledArea += node.width * node.height;
      return;
    }

    for (const childId of node.childIds) {
      walkLeaves(childId);
    }
  }

  // Start from direct children of root (root itself is the canvas)
  for (const childId of root.childIds) {
    walkLeaves(childId);
  }

  const coverage = Math.min(1, filledArea / rootArea);

  // Gaussian scoring: peak at OPTIMAL_COVERAGE
  const score = Math.exp(-Math.pow(coverage - OPTIMAL_COVERAGE, 2) / VARIANCE);

  return Math.max(0, Math.min(1, score));
}
