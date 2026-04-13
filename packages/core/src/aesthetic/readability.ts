/**
 * Readability metric.
 *
 * Evaluates text legibility based on:
 * - Line length (45-75 chars per line is optimal — Bringhurst)
 * - Line height ratio (1.4-1.6 for body, 1.0-1.2 for headings)
 */

import type { SceneGraph } from '../engine/scene-graph';

const OPTIMAL_LINE_LENGTH_MIN = 45;
const OPTIMAL_LINE_LENGTH_MAX = 75;
const CHAR_WIDTH_FACTOR = 0.5; // Average char width as fraction of fontSize

/**
 * Compute readability score for text in a scene.
 * @returns 0-1 where 1 = all text has ideal line length and spacing
 */
export function measureReadability(graph: SceneGraph, rootId: string): number {
  let totalWeight = 0;
  let weightedScore = 0;

  function walkText(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;

    if (node.type === 'TEXT' && node.fontSize > 0 && node.width > 0) {
      const fontSize = node.fontSize;
      const charWidth = fontSize * CHAR_WIDTH_FACTOR;
      const charsPerLine = node.width / charWidth;

      // Line length score
      let lineScore: number;
      if (charsPerLine >= OPTIMAL_LINE_LENGTH_MIN && charsPerLine <= OPTIMAL_LINE_LENGTH_MAX) {
        lineScore = 1;
      } else if (charsPerLine < OPTIMAL_LINE_LENGTH_MIN) {
        // Short lines: okay for headings, penalize for body
        const isHeading = fontSize >= 24;
        lineScore = isHeading ? 0.9 : Math.max(0, 1 - (OPTIMAL_LINE_LENGTH_MIN - charsPerLine) / OPTIMAL_LINE_LENGTH_MIN);
      } else {
        // Long lines: always penalize
        lineScore = Math.max(0, 1 - (charsPerLine - OPTIMAL_LINE_LENGTH_MAX) / OPTIMAL_LINE_LENGTH_MAX);
      }

      // Line height score
      let lineHeightScore = 0.7; // default for missing lineHeight
      const lineHeight = node.lineHeight;
      if (typeof lineHeight === 'number' && lineHeight > 0) {
        const ratio = lineHeight / fontSize;
        const isHeading = fontSize >= 24;

        if (isHeading) {
          // Headings: 1.0-1.3 is ideal
          if (ratio >= 1.0 && ratio <= 1.3) lineHeightScore = 1;
          else lineHeightScore = Math.max(0, 1 - Math.abs(ratio - 1.15) * 2);
        } else {
          // Body: 1.4-1.6 is ideal
          if (ratio >= 1.4 && ratio <= 1.6) lineHeightScore = 1;
          else lineHeightScore = Math.max(0, 1 - Math.abs(ratio - 1.5) * 2);
        }
      }

      // Weight by text area (larger text blocks matter more)
      const weight = Math.sqrt(node.width * Math.max(node.height, fontSize));
      const nodeScore = lineScore * 0.6 + lineHeightScore * 0.4;
      weightedScore += nodeScore * weight;
      totalWeight += weight;
    }

    for (const childId of node.childIds) {
      walkText(childId);
    }
  }

  walkText(rootId);

  if (totalWeight === 0) return 1; // No text to evaluate
  return Math.max(0, Math.min(1, weightedScore / totalWeight));
}
