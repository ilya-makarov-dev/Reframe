/**
 * Orchestration — Guide Key Picker
 *
 * Picks the best matching layout guide key for given dimensions.
 * Pure math, no host dependency.
 */

import type { GuideSize } from '../contracts/types';

/** Prefer guides with similar aspect, then minimal |Δw|+|Δh|. */
export function pickBestGuideKeyForDimensions(
  w: number,
  h: number,
  guides: Record<string, GuideSize>,
): string | undefined {
  const arT = w / Math.max(h, 1e-6);
  const relTol = 0.09;
  const entries = Object.entries(guides);
  const aspectPool = entries.filter(([, g]) => {
    const arG = g.width / Math.max(g.height, 1e-6);
    return Math.abs(arT - arG) / Math.max(arT, 1e-6) < relTol;
  });
  const pool = aspectPool.length > 0 ? aspectPool : entries;
  let bestKey: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [key, g] of pool) {
    const score = Math.abs(g.width - w) + Math.abs(g.height - h);
    if (score < bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey;
}
