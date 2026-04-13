/**
 * Spacing rhythm metric.
 *
 * Measures spacing consistency across sibling elements.
 * Regular, repeating spacing patterns score higher.
 * Random gaps score lower.
 */

import type { SceneGraph } from '../engine/scene-graph';

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Compute spacing rhythm score for a scene.
 * @returns 0-1 where 1 = perfectly consistent spacing
 */
export function measureRhythm(graph: SceneGraph, rootId: string): number {
  let totalWeight = 0;
  let weightedScore = 0;

  function evaluateParent(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;

    const children = node.childIds
      .map(id => graph.getNode(id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined && c.visible);

    // Need at least 3 siblings to evaluate rhythm
    if (children.length >= 3) {
      // Check if this is an auto-layout container
      const isAutoLayout = node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';

      if (isAutoLayout && node.itemSpacing > 0) {
        // For auto-layout, spacing is defined by itemSpacing — rhythm is perfect by definition
        weightedScore += 1 * children.length;
        totalWeight += children.length;
      } else {
        // For manual layout, measure actual gaps
        const isVertical = children.every((c, i) => i === 0 || c.y >= children[i - 1].y);
        const isHorizontal = children.every((c, i) => i === 0 || c.x >= children[i - 1].x);

        if (isVertical || isHorizontal) {
          const gaps: number[] = [];
          const sorted = [...children].sort((a, b) =>
            isVertical ? (a.y - b.y) : (a.x - b.x)
          );

          for (let i = 1; i < sorted.length; i++) {
            const gap = isVertical
              ? sorted[i].y - (sorted[i - 1].y + sorted[i - 1].height)
              : sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width);
            if (gap >= 0) gaps.push(gap);
          }

          if (gaps.length >= 2) {
            const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
            if (mean > 0) {
              const cv = stddev(gaps) / mean; // Coefficient of variation
              const score = Math.exp(-cv * 2); // Lower CV = higher score
              weightedScore += score * children.length;
              totalWeight += children.length;
            }
          }
        }
      }
    }

    // Recurse into children
    for (const child of children) {
      evaluateParent(child.id);
    }
  }

  evaluateParent(rootId);

  if (totalWeight === 0) return 1; // No rhythm to evaluate
  return Math.max(0, Math.min(1, weightedScore / totalWeight));
}
