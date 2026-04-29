/**
 * Undertone classification (T3 #7).
 *
 * Brand palette gets one of three temperature labels based on weighted
 * hue analysis: warm / cool / neutral. Drives:
 *   - inspect surfacing ("Stripe brand undertone: cool")
 *   - audit.undertone-clash rule (warns on scene colors fighting brand axis)
 *   - future warm-shifted / cool-shifted variant generation
 *
 * ─── Computation ────────────────────────────────────────────
 *
 * Each palette color contributes weighted warmness to a running sum.
 * Weight = saturation × roleBoost (primary = 2×, others = 1×). Near-
 * grayscale colors (saturation < 0.1) are skipped — they don't carry
 * temperature signal, just noise.
 *
 * Hue → warmness mapping (signed -1..1):
 *
 *   0°   (red)        → +1.0  warm
 *   30°  (orange)     → +1.0  warm
 *   60°  (yellow)     → +0.6  warm-ish
 *   90°  (yellow-grn) →  0    transitional (drops out)
 *   120° (green)      →  0    neutral on the green ridge
 *   180° (cyan)       → -0.6  cool-ish
 *   210° (azure)      → -1.0  cool
 *   240° (blue)       → -1.0  cool
 *   270° (violet)     → -0.5  cool, fading
 *   300° (magenta)    → +0.5  warm-ish (red-shifted)
 *   330° (rose)       → +1.0  warm
 *
 * Aggregate: ratio = (warmSum - coolSum) / totalWeight.
 * Threshold ±0.25 → balanced palettes resolve to neutral (avoids
 * false-warm/cool labels on nuanced brands).
 *
 * ─── Determinism ────────────────────────────────────────────
 *
 * Pure function — same colors → same undertone. No randomness, no
 * floating-point ordering dependency.
 */

import type { UndertoneAxis } from './types.js';

export interface PaletteEntry {
  /** Hex color (#rgb or #rrggbb). */
  hex: string;
  /** Role identifier — 'primary' gets 2× weight. */
  role: string;
}

/** Strict ±0.25 threshold separating warm/cool from neutral. */
export const UNDERTONE_THRESHOLD = 0.25;

/**
 * RGB hex → HSL with hue in 0..360 degrees and s/l in 0..1.
 * Returns h=0 when the color is achromatic (max === min) — caller can
 * fall back to saturation < 0.1 to detect achromatic instead.
 */
export function rgbToHsl(hex: string): { h: number; s: number; l: number } {
  const cleaned = hex.replace(/^#/, '').trim();
  const expanded = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned;
  if (expanded.length < 6) return { h: 0, s: 0, l: 0 };
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Map a hue (0..360) to a signed warmness in -1..1 using a piecewise
 * cosine-shaped function. Red/orange/rose lobe peaks at +1; cyan/blue
 * lobe peaks at -1; greens and yellow-greens land near 0.
 */
export function computeWarmness(hue: number): number {
  // Normalize hue into 0..360.
  let h = hue % 360;
  if (h < 0) h += 360;

  // Define warmness as smooth interpolation between named anchor points.
  // Anchors: 0=warm(+1), 60=warm-ish(+0.6), 120=neutral(0),
  //          180=cool-ish(-0.6), 240=cool(-1), 300=warm-ish(+0.5), 360=warm(+1).
  // Linear segments are sufficient for thresholding decisions; cosine
  // interp would be marginal accuracy for substantial complexity.
  const ANCHORS: Array<[number, number]> = [
    [0, 1.0],
    [30, 1.0],
    [60, 0.6],
    [90, 0.0],
    [180, -0.6],
    [210, -1.0],
    [240, -1.0],
    [270, -0.5],
    [300, 0.5],
    [330, 1.0],
    [360, 1.0],
  ];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [h0, w0] = ANCHORS[i];
    const [h1, w1] = ANCHORS[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0);
      return w0 + (w1 - w0) * t;
    }
  }
  return 0;
}

/**
 * Aggregate warmness across a palette into one of three labels.
 *
 * Weighting:
 *   - per-color weight = saturation × roleBoost
 *   - roleBoost = 2 when role === 'primary', else 1
 *   - colors with saturation < 0.1 contribute zero (achromatic skip)
 *
 * Decision:
 *   - ratio > +0.25 → 'warm'
 *   - ratio < -0.25 → 'cool'
 *   - else (incl. all-grayscale / empty palette) → 'neutral'
 */
export function computeUndertone(palette: ReadonlyArray<PaletteEntry>): UndertoneAxis {
  let warmSum = 0;
  let coolSum = 0;
  let totalWeight = 0;
  for (const entry of palette) {
    const hsl = rgbToHsl(entry.hex);
    if (hsl.s < 0.1) continue;     // skip achromatic / very-near-gray
    const warmness = computeWarmness(hsl.h);
    const roleBoost = entry.role === 'primary' ? 2 : 1;
    const weight = hsl.s * roleBoost;
    if (warmness > 0) warmSum += warmness * weight;
    else if (warmness < 0) coolSum += -warmness * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 'neutral';
  const ratio = (warmSum - coolSum) / totalWeight;
  if (ratio > UNDERTONE_THRESHOLD) return 'warm';
  if (ratio < -UNDERTONE_THRESHOLD) return 'cool';
  return 'neutral';
}

/**
 * Returns true when a single scene color "fights" the brand undertone —
 * scene color is warm but brand is cool (or vice versa). Achromatic /
 * low-saturation scene colors don't fight (they're temperature-neutral).
 *
 * Used by the undertone-clash audit rule. Brand undertone = 'neutral'
 * never clashes (no axis to fight against) — the rule is bypassed
 * upstream when brand.undertone === 'neutral'.
 */
export function colorClashesUndertone(
  hex: string,
  brandUndertone: UndertoneAxis,
): boolean {
  if (brandUndertone === 'neutral') return false;
  const hsl = rgbToHsl(hex);
  if (hsl.s < 0.3) return false;     // unsaturated colors don't carry temperature
  const warmness = computeWarmness(hsl.h);
  if (Math.abs(warmness) < 0.4) return false;  // transitional hues are ambiguous
  if (brandUndertone === 'warm' && warmness < -0.4) return true;
  if (brandUndertone === 'cool' && warmness > 0.4) return true;
  return false;
}
