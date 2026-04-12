/**
 * Variations — pure, deterministic design space explorers.
 *
 * Every transform here takes a SceneGraph and returns a mutation count.
 * No AI, no randomness — just parameterized graph rewrites. Combine
 * them via generateVariationGrid() to explore whole design spaces.
 */

export { scaleSpacing } from './spacing';
export type { ScaleSpacingOptions } from './spacing';

export { scaleRadius } from './radius';
export type { RadiusStrategy } from './radius';

export { scaleShadows } from './shadows';
export type { ShadowStrategy } from './shadows';

export { rotateColors } from './colors';
export type { ColorRotation } from './colors';

export { applyTypographyPreset } from './typography';
export type { TypographyPreset } from './typography';

export { generateVariationGrid } from './grid';
export type { VariationAxes, VariationRecipe } from './grid';
