/**
 * Proportionality metric.
 *
 * Evaluates aspect ratios against golden ratio (1.618),
 * silver ratio (1.414), and square (1.0).
 * Also checks rule-of-thirds positioning for key elements.
 */

import type { SceneGraph } from '../engine/scene-graph';

const GOLDEN_RATIO = 1.618;
const SILVER_RATIO = 1.414;
const PLEASING_RATIOS = [GOLDEN_RATIO, 1 / GOLDEN_RATIO, SILVER_RATIO, 1 / SILVER_RATIO, 1.0, 2.0, 0.5, 16 / 9, 9 / 16, 4 / 3, 3 / 4];

/** How close a ratio is to any pleasing ratio. Returns 0-1. */
function ratioProximity(ratio: number): number {
  let minDist = Infinity;
  for (const target of PLEASING_RATIOS) {
    const dist = Math.abs(ratio - target) / target;
    if (dist < minDist) minDist = dist;
  }
  // Score: exponential decay from nearest target
  return Math.exp(-minDist * 3);
}

/**
 * Compute proportion score for a scene.
 * @returns 0-1 where 1 = all elements have pleasing proportions
 */
export function measureProportion(graph: SceneGraph, rootId: string): number {
  const root = graph.getNode(rootId);
  if (!root) return 1;

  let totalWeight = 0;
  let weightedScore = 0;

  function walkNodes(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;
    if (node.width <= 0 || node.height <= 0) return;

    // Skip tiny elements and text
    if (node.width < 20 || node.height < 20) return;
    if (node.type === 'TEXT') return;

    const ratio = node.width / node.height;
    const area = node.width * node.height;
    const weight = Math.sqrt(area); // Larger elements matter more

    weightedScore += ratioProximity(ratio) * weight;
    totalWeight += weight;

    for (const childId of node.childIds) {
      walkNodes(childId);
    }
  }

  walkNodes(rootId);

  if (totalWeight === 0) return 1;

  // Rule-of-thirds bonus
  let thirdsBonus = 0;
  const rootW = root.width;
  const rootH = root.height;
  const thirdX1 = rootW / 3, thirdX2 = rootW * 2 / 3;
  const thirdY1 = rootH / 3, thirdY2 = rootH * 2 / 3;
  const thirdTolerance = rootW * 0.08; // 8% tolerance

  let keyElements = 0;
  let onThirds = 0;

  for (const childId of root.childIds) {
    const child = graph.getNode(childId);
    if (!child || !child.visible) continue;
    const cx = child.x + child.width / 2;
    const cy = child.y + child.height / 2;

    keyElements++;
    const nearThirdX = Math.abs(cx - thirdX1) < thirdTolerance || Math.abs(cx - thirdX2) < thirdTolerance;
    const nearThirdY = Math.abs(cy - thirdY1) < thirdTolerance || Math.abs(cy - thirdY2) < thirdTolerance;
    if (nearThirdX || nearThirdY) onThirds++;
  }

  if (keyElements > 0) {
    thirdsBonus = (onThirds / keyElements) * 0.2;
  }

  const baseScore = weightedScore / totalWeight;
  return Math.max(0, Math.min(1, baseScore + thirdsBonus));
}
