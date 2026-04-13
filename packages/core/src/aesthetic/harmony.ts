/**
 * Color harmony metric.
 *
 * Evaluates color relationships using HSL hue angles.
 * Complementary (180deg), analogous (30deg), triadic (120deg)
 * pairs score higher than random hue distributions.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { Color } from '../engine/types';

interface HSL { h: number; s: number; l: number }

function rgbToHsl(c: Color): HSL {
  const r = c.r, g = c.g, b = c.b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    h *= 360;
  }

  return { h, s, l };
}

function hueDifference(h1: number, h2: number): number {
  const diff = Math.abs(h1 - h2);
  return Math.min(diff, 360 - diff);
}

/** Check if two hues are in a harmonious relationship. */
function isHarmonious(diff: number): boolean {
  // Complementary: 165-195 degrees
  if (diff >= 165 && diff <= 195) return true;
  // Analogous: 15-45 degrees
  if (diff >= 15 && diff <= 45) return true;
  // Triadic: 105-135 degrees
  if (diff >= 105 && diff <= 135) return true;
  // Split-complementary: 140-170 degrees
  if (diff >= 140 && diff <= 170) return true;
  // Near-identical (same color family): 0-10 degrees
  if (diff <= 10) return true;
  return false;
}

/**
 * Compute color harmony score for a scene.
 * @returns 0-1 where 1 = all color pairs are harmonious
 */
export function measureHarmony(graph: SceneGraph, rootId: string): number {
  const colors: HSL[] = [];
  const seen = new Set<string>();

  function collectColors(nodeId: string): void {
    const node = graph.getNode(nodeId);
    if (!node || !node.visible) return;

    for (const fill of node.fills) {
      if (fill.type === 'SOLID' && fill.visible !== false) {
        const c = fill.color;
        const key = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
        if (!seen.has(key)) {
          seen.add(key);
          const hsl = rgbToHsl(c);
          // Only consider chromatic colors (saturation > 5%)
          if (hsl.s > 0.05 && hsl.l > 0.05 && hsl.l < 0.95) {
            colors.push(hsl);
          }
        }
      }
    }

    for (const childId of node.childIds) {
      collectColors(childId);
    }
  }

  collectColors(rootId);

  if (colors.length < 2) return 1; // Monochromatic is harmonious

  // Check all pairs
  let harmoniousPairs = 0;
  let totalPairs = 0;

  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      totalPairs++;
      const diff = hueDifference(colors[i].h, colors[j].h);
      if (isHarmonious(diff)) harmoniousPairs++;
    }
  }

  if (totalPairs === 0) return 1;

  // Base harmony from hue relationships
  let score = harmoniousPairs / totalPairs;

  // Bonus for saturation consistency (low stddev = coherent palette)
  const saturations = colors.map(c => c.s);
  const meanSat = saturations.reduce((a, b) => a + b, 0) / saturations.length;
  const satVariance = saturations.reduce((acc, s) => acc + Math.pow(s - meanSat, 2), 0) / saturations.length;
  const satConsistency = 1 - Math.min(1, Math.sqrt(satVariance) * 3);
  score = score * 0.7 + satConsistency * 0.3;

  return Math.max(0, Math.min(1, score));
}
