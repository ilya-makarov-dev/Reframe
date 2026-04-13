/**
 * Composite aesthetic scorer.
 *
 * Aggregates all individual metrics into a single AestheticScore.
 * Also re-uses the existing visual-balance and visual-hierarchy
 * metrics from audit.ts for the `balance` and `hierarchy` fields.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { AestheticScore } from './types';
import { AESTHETIC_WEIGHTS } from './types';
import { measureAlignment } from './alignment';
import { measureWhitespace } from './whitespace';
import { measureHarmony } from './harmony';
import { measureProportion } from './proportion';
import { measureRhythm } from './rhythm';
import { measureReadability } from './readability';

/**
 * Compute balance score — center-of-mass proximity to frame center.
 * Reimplemented here to avoid coupling to audit.ts internals.
 */
function measureBalance(graph: SceneGraph, rootId: string): number {
  const root = graph.getNode(rootId);
  if (!root) return 1;

  const children = root.childIds
    .map(id => graph.getNode(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined && c.visible);

  if (children.length === 0) return 1;

  let totalArea = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (const child of children) {
    const area = child.width * child.height;
    const cx = child.x + child.width / 2;
    const cy = child.y + child.height / 2;
    weightedX += cx * area;
    weightedY += cy * area;
    totalArea += area;
  }

  if (totalArea === 0) return 1;

  const comX = weightedX / totalArea;
  const comY = weightedY / totalArea;
  const centerX = root.width / 2;
  const centerY = root.height / 2;

  const offsetX = Math.abs(comX - centerX) / root.width;
  const offsetY = Math.abs(comY - centerY) / root.height;
  const offset = Math.sqrt(offsetX * offsetX + offsetY * offsetY);

  // Score: 1 at center (offset=0), degrades to 0 at offset=0.5
  return Math.max(0, Math.min(1, 1 - offset * 2));
}

/**
 * Compute hierarchy score — font size/weight variation clarity.
 */
function measureHierarchy(graph: SceneGraph, rootId: string): number {
  const fontSizes: number[] = [];

  function collectFontSizes(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;
    if (node.type === 'TEXT' && node.fontSize > 0) {
      fontSizes.push(node.fontSize);
    }
    for (const childId of node.childIds) {
      collectFontSizes(childId);
    }
  }

  collectFontSizes(rootId);

  if (fontSizes.length < 2) return 1;

  const uniqueSizes = [...new Set(fontSizes)].sort((a, b) => b - a);

  if (uniqueSizes.length < 2) return 0.5; // No variation

  // Ratio between largest and smallest
  const ratio = uniqueSizes[0] / uniqueSizes[uniqueSizes.length - 1];

  // Good hierarchy: ratio >= 2.0 (clear contrast)
  // Flat: ratio < 1.3
  if (ratio >= 2.5) return 1;
  if (ratio >= 2.0) return 0.9;
  if (ratio >= 1.5) return 0.7;
  if (ratio >= 1.3) return 0.5;
  return 0.3;
}

/**
 * Compute the full aesthetic score for a scene.
 */
export function computeAestheticScore(graph: SceneGraph, rootId: string): AestheticScore {
  const alignment = measureAlignment(graph, rootId);
  const whitespace = measureWhitespace(graph, rootId);
  const balance = measureBalance(graph, rootId);
  const harmony = measureHarmony(graph, rootId);
  const hierarchy = measureHierarchy(graph, rootId);
  const rhythm = measureRhythm(graph, rootId);
  const readability = measureReadability(graph, rootId);
  const proportion = measureProportion(graph, rootId);

  const overall =
    alignment * AESTHETIC_WEIGHTS.alignment +
    whitespace * AESTHETIC_WEIGHTS.whitespace +
    balance * AESTHETIC_WEIGHTS.balance +
    harmony * AESTHETIC_WEIGHTS.harmony +
    hierarchy * AESTHETIC_WEIGHTS.hierarchy +
    rhythm * AESTHETIC_WEIGHTS.rhythm +
    readability * AESTHETIC_WEIGHTS.readability +
    proportion * AESTHETIC_WEIGHTS.proportion;

  return {
    alignment,
    whitespace,
    balance,
    harmony,
    hierarchy,
    rhythm,
    readability,
    proportion,
    overall,
  };
}
