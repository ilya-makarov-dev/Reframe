/**
 * Alignment consistency metric.
 *
 * Measures how well elements align to shared vertical/horizontal rails.
 * Fewer distinct alignment positions = higher score.
 */

import type { SceneGraph } from '../engine/scene-graph';

const CLUSTER_THRESHOLD = 2; // px tolerance for grouping coordinates

/** Cluster values within threshold. Returns number of distinct clusters. */
function countClusters(values: number[], threshold: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let clusters = 1;
  let clusterStart = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusterStart > threshold) {
      clusters++;
      clusterStart = sorted[i];
    }
  }
  return clusters;
}

/**
 * Compute alignment score for a scene.
 * @returns 0-1 where 1 = all elements on shared alignment rails
 */
export function measureAlignment(graph: SceneGraph, rootId: string): number {
  const root = graph.getNode(rootId);
  if (!root) return 1;

  const childIds = root.childIds;
  if (childIds.length < 2) return 1; // Single child is trivially aligned

  // Collect x and y positions of direct children (depth 1)
  // Also go one level deeper for section-level alignment
  const xPositions: number[] = [];
  const yPositions: number[] = [];

  function collectPositions(nodeId: string, depth: number): void {
    if (depth > 2) return; // Only check 2 levels deep
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;
    if (depth > 0) {
      xPositions.push(node.x);
      yPositions.push(node.y);
    }
    for (const childId of node.childIds) {
      collectPositions(childId, depth + 1);
    }
  }

  collectPositions(rootId, 0);

  if (xPositions.length < 2) return 1;

  const xClusters = countClusters(xPositions, CLUSTER_THRESHOLD);
  const yClusters = countClusters(yPositions, CLUSTER_THRESHOLD);

  // Ideal: few clusters relative to node count
  // Score: 1 - (clusters / totalNodes), clamped
  const totalNodes = xPositions.length;
  const xScore = 1 - Math.min(1, (xClusters - 1) / Math.max(1, totalNodes - 1));
  const yScore = 1 - Math.min(1, (yClusters - 1) / Math.max(1, totalNodes - 1));

  // Weighted average (x alignment matters more for typical vertical layouts)
  return Math.max(0, Math.min(1, xScore * 0.6 + yScore * 0.4));
}
