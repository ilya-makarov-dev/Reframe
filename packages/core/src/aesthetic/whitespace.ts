/**
 * Whitespace fraction metric.
 *
 * Measures the ratio of empty space to total area.
 * Optimal depends on genre: marketing ~50 %, dashboard ~70 %.
 * Too dense or too sparse (relative to genre target) scores lower.
 */

import type { SceneGraph } from '../engine/scene-graph';

// Marketing genre: peak ~50 %. Dashboards: peak ~70 % (dense data UIs).
const MARKETING_OPTIMAL = 0.50;
const DASHBOARD_OPTIMAL = 0.70;
const VARIANCE = 0.08; // Gaussian spread — same for both genres

// Density heuristic: leaf nodes per million sq-px. Dashboards sit
// around 25+ (many small cards/table rows/chips); marketing pages
// sit around 5–12 (hero + 3–4 sections + footer).
const DENSITY_DASHBOARD_THRESHOLD = 18;

/**
 * Compute whitespace score for a scene.
 * @returns 0-1 where 1 = optimal whitespace ratio for detected genre
 */
export function measureWhitespace(graph: SceneGraph, rootId: string): number {
  const root = graph.getNode(rootId);
  if (!root) return 1;

  const rootArea = root.width * root.height;
  if (rootArea <= 0) return 1;

  // Sum leaf node areas (nodes with no children, or text nodes)
  let filledArea = 0;
  let leafCount = 0;

  function walkLeaves(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;

    const isLeaf = node.childIds.length === 0;
    const isText = node.type === 'TEXT';

    if (isLeaf || isText) {
      filledArea += node.width * node.height;
      leafCount++;
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

  // Density-aware genre calibration. Leaves-per-Msqpx > threshold
  // means dense information UI (dashboard, table-heavy page) — use the
  // dashboard peak so a well-populated dense scene isn't unfairly
  // penalised by the marketing-calibrated 50 % target.
  const density = (leafCount * 1_000_000) / rootArea;
  const optimal = density >= DENSITY_DASHBOARD_THRESHOLD ? DASHBOARD_OPTIMAL : MARKETING_OPTIMAL;

  // Gaussian scoring: peak at genre-appropriate optimal
  const score = Math.exp(-Math.pow(coverage - optimal, 2) / VARIANCE);

  return Math.max(0, Math.min(1, score));
}
