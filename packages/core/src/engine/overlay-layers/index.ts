/**
 * Overlay layer registry — the single source of truth for what layer
 * types exist, what they validate, and what their browser runtime is.
 *
 * Compile uses LAYER_REGISTRY[type].validate(config) to gate bad configs.
 * Renderer + HTML exporter pull BROWSER_SOURCE strings to mount layers
 * in the live editor and inline standalone-HTML respectively.
 *
 * Adding a new type:
 *   1. New file overlay-layers/<type>.ts exporting a LayerImpl.
 *   2. Register here.
 *   3. Extend OverlayLayerType union in composition.ts.
 *
 * That's it — compile / renderer / exporter all iterate this registry.
 */

import type { OverlayBlendMode, OverlayLayerType } from '../composition.js';
import type { LayerImpl } from './types.js';
import { noiseGrainImpl } from './noise-grain.js';
import { gradientPulseImpl } from './gradient-pulse.js';
import { particleDustImpl } from './particle-dust.js';
import { fireImpl } from './fire.js';
import { smokeImpl } from './smoke.js';
import { windImpl } from './wind.js';
import { snowImpl } from './snow.js';
import { electricImpl } from './electric.js';
import { goldImpl } from './gold.js';
import { shaderGradientFlowImpl } from './shader-gradient-flow.js';
import { shaderNoiseFieldImpl } from './shader-noise-field.js';
import { shaderAuroraImpl } from './shader-aurora.js';
import { realdataGlobeImpl } from './realdata-globe.js';
import { realdataStarfieldImpl } from './realdata-starfield.js';
import { realdataWeatherImpl } from './realdata-weather.js';
import { OVERLAY_UTILS_BROWSER_SOURCE } from './utils.js';
import { VERTEX_QUAD_BROWSER_SOURCE } from './webgl/vertex-quad.glsl.js';
import { SHADER_HELPERS_BROWSER_SOURCE } from './webgl/shader-helpers.js';
import { SHADER_FALLBACK_BROWSER_SOURCE } from './webgl/shader-fallback.js';

export const LAYER_REGISTRY: Record<OverlayLayerType, LayerImpl> = {
  // Phase 0 (#5) — ambient atmospherics (canvas 2D)
  'noise-grain': noiseGrainImpl,
  'gradient-pulse': gradientPulseImpl,
  'particle-dust': particleDustImpl,
  // T2 (#10) — physics-driven effects (canvas 2D)
  'fire': fireImpl,
  'smoke': smokeImpl,
  'wind': windImpl,
  'snow': snowImpl,
  'electric': electricImpl,
  'gold': goldImpl,
  // T2 (#28) — GPU shader layers (WebGL fragment shaders)
  'shader-gradient-flow': shaderGradientFlowImpl,
  'shader-noise-field': shaderNoiseFieldImpl,
  'shader-aurora': shaderAuroraImpl,
  // T2 (#29) — real-data primitives (embedded datasets, no live API)
  'realdata-globe': realdataGlobeImpl,
  'realdata-starfield': realdataStarfieldImpl,
  'realdata-weather': realdataWeatherImpl,
};

/**
 * Resolve effective blendMode for a layer spec. Explicit override wins;
 * falls back to the layer's DEFAULT_BLEND_MODE; finally to 'source-over'
 * (#5 layers don't carry DEFAULT_BLEND_MODE — preserves their pre-#10
 * behavior).
 */
export function resolveBlendMode(
  type: OverlayLayerType,
  explicit: OverlayBlendMode | undefined,
): OverlayBlendMode {
  if (explicit) return explicit;
  return LAYER_REGISTRY[type].DEFAULT_BLEND_MODE ?? 'source-over';
}

export const KNOWN_LAYER_TYPES: OverlayLayerType[] = Object.keys(LAYER_REGISTRY) as OverlayLayerType[];

export function isKnownLayerType(t: string): t is OverlayLayerType {
  return Object.prototype.hasOwnProperty.call(LAYER_REGISTRY, t);
}

/**
 * Concatenated browser source for the entire registry — utils first,
 * then WebGL helpers (#28), then each layer's factory_<type>(). Used by:
 *   - overlay-renderer.ts (eval'd at module load → factories table)
 *   - html.ts overlay export (inlined into <script> block in exported file)
 *
 * The factory naming convention `factory_<type>` (with `-` → `_` in the
 * name) lets the consumer build a dispatch table without parsing JS.
 *
 * WebGL helper bundle adds ~1.5 KB to ALL_LAYERS_BROWSER_SOURCE
 * regardless of whether shader layers are used in a given overlay.
 * Conditional injection (only ship helpers when a shader type appears)
 * = future opt; trivial vs the determinism-of-output benefit of one
 * source artifact across all overlay exports.
 */
export const ALL_LAYERS_BROWSER_SOURCE: string =
  OVERLAY_UTILS_BROWSER_SOURCE +
  '\n' +
  VERTEX_QUAD_BROWSER_SOURCE +
  '\n' +
  SHADER_HELPERS_BROWSER_SOURCE +
  '\n' +
  SHADER_FALLBACK_BROWSER_SOURCE +
  '\n' +
  Object.values(LAYER_REGISTRY).map(l => l.BROWSER_SOURCE).join('\n');

/** factory_<type> identifier as it appears in BROWSER_SOURCE. */
export function factoryNameFor(type: OverlayLayerType): string {
  return 'factory_' + type.replace(/-/g, '_');
}

export type { LayerImpl, LayerValidationResult, LayerInstance } from './types.js';
