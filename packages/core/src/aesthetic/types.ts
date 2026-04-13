/**
 * Aesthetic scoring types.
 *
 * Each metric produces a 0-1 score where 1 is ideal.
 * The `overall` field is a weighted composite.
 */

export interface AestheticScore {
  /** X/Y coordinate clustering consistency. 1 = all elements on shared rails. */
  alignment: number;
  /** Empty area fraction. Peaks near 0.5. Too dense or too sparse = lower. */
  whitespace: number;
  /** Center-of-mass proximity to frame center. 1 = perfectly centered. */
  balance: number;
  /** Color relationship quality (complementary/analogous/triadic). */
  harmony: number;
  /** Font size/weight variation clarity. 1 = clear visual hierarchy. */
  hierarchy: number;
  /** Spacing pattern regularity across siblings. */
  rhythm: number;
  /** Line length + line-height adequacy for text nodes. */
  readability: number;
  /** Aspect ratio quality (golden/silver ratio proximity). */
  proportion: number;
  /** Weighted composite of all metrics. */
  overall: number;
}

/** Weights for each metric in the composite score. */
export const AESTHETIC_WEIGHTS: Record<keyof Omit<AestheticScore, 'overall'>, number> = {
  alignment: 0.15,
  whitespace: 0.10,
  balance: 0.15,
  harmony: 0.10,
  hierarchy: 0.15,
  rhythm: 0.10,
  readability: 0.15,
  proportion: 0.10,
};

/** Human-readable rating from a 0-1 score. */
export function scoreToRating(score: number): 'Poor' | 'Fair' | 'Good' | 'Excellent' {
  if (score >= 0.8) return 'Excellent';
  if (score >= 0.6) return 'Good';
  if (score >= 0.3) return 'Fair';
  return 'Poor';
}
