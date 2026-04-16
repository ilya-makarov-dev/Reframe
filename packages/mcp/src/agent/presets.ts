/**
 * Preset Ops — explicit, user-clickable design transformations.
 *
 * The "fast-intent" regex matcher was a wrong move (brittle, NLP doesn't
 * scale). The right pattern: surface presets as BUTTONS in the agent
 * prompt UI. The user clicks "playful" → we apply the op directly via
 * the engine in ~200ms. No AI call. No tokens.
 *
 * If they want something nuanced ("a bit more playful but keep the
 * sharp corners") they type it in and AI handles it. Best of both.
 *
 * Each preset is one or more variation ops applied in order. They run
 * over the selected node's subtree if a nodeId is provided, otherwise
 * over the whole scene root.
 */

import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import {
  scaleSpacing,
  scaleRadius,
  scaleShadows,
  applyTypographyPreset,
} from '../../../core/src/variations/index.js';
import type {
  RadiusStrategy,
  ShadowStrategy,
  TypographyPreset,
} from '../../../core/src/variations/index.js';

// ─── Definitions ────────────────────────────────────────────

export interface PresetDef {
  /** Internal id (sent over the wire). */
  id: string;
  /** Short label shown on the chip. */
  label: string;
  /** One-line tooltip. */
  description: string;
  /** Ops applied to the target subtree, in order. */
  ops: PresetOp[];
}

export type PresetOp =
  | { kind: 'scaleSpacing'; factor: number }
  | { kind: 'scaleRadius'; strategy: RadiusStrategy }
  | { kind: 'scaleShadows'; strategy: ShadowStrategy }
  | { kind: 'typographyPreset'; preset: TypographyPreset };

export const PRESETS: PresetDef[] = [
  {
    id: 'playful',
    label: 'playful',
    description: 'Friendly type + pill corners — softer, more inviting',
    ops: [
      { kind: 'typographyPreset', preset: 'friendly' as TypographyPreset },
      { kind: 'scaleRadius', strategy: 'pill' as RadiusStrategy },
    ],
  },
  {
    id: 'minimal',
    label: 'minimal',
    description: 'Flat shadows + sharp corners — clean and quiet',
    ops: [
      { kind: 'scaleShadows', strategy: 'flat' as ShadowStrategy },
      { kind: 'scaleRadius', strategy: 'sharp' as RadiusStrategy },
    ],
  },
  {
    id: 'bold',
    label: 'bold',
    description: 'Dramatic type + dramatic shadows — high contrast',
    ops: [
      { kind: 'typographyPreset', preset: 'dramatic' as TypographyPreset },
      { kind: 'scaleShadows', strategy: 'dramatic' as ShadowStrategy },
    ],
  },
  {
    id: 'compact',
    label: 'compact',
    description: 'Tighten spacing by 25%',
    ops: [{ kind: 'scaleSpacing', factor: 0.75 }],
  },
  {
    id: 'spacious',
    label: 'spacious',
    description: 'Loosen spacing by 30%',
    ops: [{ kind: 'scaleSpacing', factor: 1.3 }],
  },
  {
    id: 'pill',
    label: 'pill',
    description: 'Pill-shaped corners on buttons and cards',
    ops: [{ kind: 'scaleRadius', strategy: 'pill' as RadiusStrategy }],
  },
  {
    id: 'sharp',
    label: 'sharp',
    description: 'Remove all corner radius — straight edges',
    ops: [{ kind: 'scaleRadius', strategy: 'sharp' as RadiusStrategy }],
  },
  {
    id: 'editorial',
    label: 'editorial',
    description: 'Magazine-style typography hierarchy',
    ops: [{ kind: 'typographyPreset', preset: 'editorial' as TypographyPreset }],
  },
  // Note: rotateColors requires a TokenIndex (computed from active
  // brand DESIGN.md). We'll add it once the preset apply path can
  // re-tokenize the scene against the brand. For MVP, keep only the
  // subtree-only transforms that don't need brand context.
];

export function getPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Lightweight list for the UI — drops the ops payload. */
export function listPresets(): Array<Pick<PresetDef, 'id' | 'label' | 'description'>> {
  return PRESETS.map(({ id, label, description }) => ({ id, label, description }));
}

// ─── Apply ──────────────────────────────────────────────────

/**
 * Apply a preset's ops to a SceneGraph subtree.
 * Returns the total field-mutation count across all ops (best-effort metric).
 */
export function applyPreset(
  graph: SceneGraph,
  rootId: string,
  preset: PresetDef,
): number {
  let changed = 0;
  for (const op of preset.ops) {
    try {
      switch (op.kind) {
        case 'scaleSpacing':
          changed += scaleSpacing(graph, rootId, op.factor, { preserveAtoms: true }) || 0;
          break;
        case 'scaleRadius':
          changed += scaleRadius(graph, rootId, op.strategy) || 0;
          break;
        case 'scaleShadows':
          changed += scaleShadows(graph, rootId, op.strategy) || 0;
          break;
        case 'typographyPreset':
          changed += applyTypographyPreset(graph, rootId, op.preset) || 0;
          break;
      }
    } catch {
      // Skip failed op, keep applying the rest.
    }
  }
  return changed;
}
