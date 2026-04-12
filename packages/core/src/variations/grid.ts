/**
 * Variation grid — generate Cartesian product of variation axes.
 *
 * Takes a set of axes (brand, density, radius, shadows, typography, colors)
 * and produces a list of variation recipes. Each recipe is a self-contained
 * description of transforms to apply — the caller is responsible for cloning
 * the source scene and invoking each transform in order.
 *
 * The grid generator is pure: no scene graph, no I/O. It just produces
 * the combinatorial space. Wire it to reframe_edit operations or the
 * variations API to materialize actual scenes.
 *
 * Example:
 *   const grid = generateVariationGrid({
 *     brand: ['spotify', 'stripe', 'ferrari'],
 *     density: [0.8, 1.0, 1.2],
 *     radius: ['sharp', 'pill'],
 *   });
 *   // → 3 × 3 × 2 = 18 recipes
 */

import type { RadiusStrategy } from './radius';
import type { ShadowStrategy } from './shadows';
import type { TypographyPreset } from './typography';
import type { ColorRotation } from './colors';

export interface VariationAxes {
  /** Brand slug(s) — apply via defineTokens + rebrandColorsFromTokens */
  brand?: string[];
  /** Density factors — scale spacing */
  density?: number[];
  /** Radius strategies */
  radius?: RadiusStrategy[];
  /** Shadow strategies */
  shadows?: ShadowStrategy[];
  /** Typography presets */
  typography?: TypographyPreset[];
  /** Mode names — setMode (light/dark) */
  mode?: string[];
  /** Color rotations */
  colorRotation?: ColorRotation[];
}

export interface VariationRecipe {
  /** Stable identifier — generated from axis values */
  id: string;
  /** Human-readable label */
  label: string;
  /** Axis values applied in this recipe */
  axes: {
    brand?: string;
    density?: number;
    radius?: RadiusStrategy;
    shadows?: ShadowStrategy;
    typography?: TypographyPreset;
    mode?: string;
    colorRotation?: ColorRotation;
  };
}

/**
 * Produce all variation recipes from the Cartesian product of axes.
 * Axes that are undefined or empty are skipped (not enumerated).
 */
export function generateVariationGrid(axes: VariationAxes): VariationRecipe[] {
  const dimensions: Array<{ key: string; values: unknown[] }> = [];

  if (axes.brand && axes.brand.length) dimensions.push({ key: 'brand', values: axes.brand });
  if (axes.mode && axes.mode.length) dimensions.push({ key: 'mode', values: axes.mode });
  if (axes.density && axes.density.length) dimensions.push({ key: 'density', values: axes.density });
  if (axes.radius && axes.radius.length) dimensions.push({ key: 'radius', values: axes.radius });
  if (axes.shadows && axes.shadows.length) dimensions.push({ key: 'shadows', values: axes.shadows });
  if (axes.typography && axes.typography.length) dimensions.push({ key: 'typography', values: axes.typography });
  if (axes.colorRotation && axes.colorRotation.length) dimensions.push({ key: 'colorRotation', values: axes.colorRotation });

  if (dimensions.length === 0) return [];

  // Cartesian product
  const product: Record<string, unknown>[] = [{}];
  for (const dim of dimensions) {
    const next: Record<string, unknown>[] = [];
    for (const item of product) {
      for (const value of dim.values) {
        next.push({ ...item, [dim.key]: value });
      }
    }
    product.splice(0, product.length, ...next);
  }

  // Convert to recipes with labels
  return product.map((combo, idx) => {
    const parts: string[] = [];
    if (combo.brand) parts.push(String(combo.brand));
    if (combo.mode) parts.push(String(combo.mode));
    if (combo.density !== undefined) parts.push(`d${combo.density}`);
    if (combo.radius) parts.push(`r:${describeRadius(combo.radius as RadiusStrategy)}`);
    if (combo.shadows) parts.push(`s:${describeShadow(combo.shadows as ShadowStrategy)}`);
    if (combo.typography) parts.push(`t:${combo.typography}`);
    if (combo.colorRotation) parts.push(`cr:${describeRotation(combo.colorRotation as ColorRotation)}`);

    const label = parts.length > 0 ? parts.join(' · ') : `variant-${idx}`;
    const id = parts.length > 0 ? parts.join('_').replace(/[^a-zA-Z0-9_-]/g, '-') : `v${idx}`;

    return { id, label, axes: combo as VariationRecipe['axes'] };
  });
}

function describeRadius(r: RadiusStrategy): string {
  if (typeof r === 'string') return r;
  if ('value' in r) return `v${r.value}`;
  return `f${r.factor}`;
}

function describeShadow(s: ShadowStrategy): string {
  if (typeof s === 'string') return s;
  return `f${s.factor}`;
}

function describeRotation(r: ColorRotation): string {
  if (typeof r === 'string') return r;
  return `${r[0]}↔${r[1]}`;
}
