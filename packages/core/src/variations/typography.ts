/**
 * Typography variation — apply named presets to the type hierarchy.
 *
 * Presets reshape the relationship between headings and body without
 * changing the actual content. Operates on both token values (when a
 * token collection exists) and direct node properties (fallback).
 *
 * Presets:
 *   'dramatic'  — max contrast: headings 900, body 300 (editorial hero energy)
 *   'flat'      — all weights 500 (technical, Swiss)
 *   'editorial' — headings tight, body relaxed (magazine rhythm)
 *   'technical' — uniform weights, wide letter-spacing (engineering docs)
 *   'friendly'  — rounded weights, comfortable line-height (marketing)
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { TokenIndex } from '../design-system/tokens';

export type TypographyPreset =
  | 'dramatic'
  | 'flat'
  | 'editorial'
  | 'technical'
  | 'friendly';

interface PresetRecipe {
  /** Weight overrides per semantic role */
  weights: Partial<Record<string, number>>;
  /** LineHeight multiplier (applied on top of existing) */
  lineHeightMultiplier?: number;
  /** Letter-spacing override (absolute px) */
  letterSpacing?: number;
  /** Letter-spacing multiplier */
  letterSpacingMultiplier?: number;
}

const RECIPES: Record<TypographyPreset, PresetRecipe> = {
  dramatic: {
    weights: {
      heading: 900,
      title: 900,
      hero: 900,
      paragraph: 300,
      body: 300,
      description: 300,
      label: 500,
      caption: 400,
      button: 700,
    },
    lineHeightMultiplier: 0.95,
  },
  flat: {
    weights: {
      heading: 500,
      title: 500,
      hero: 500,
      paragraph: 500,
      body: 500,
      description: 500,
      label: 500,
      caption: 500,
      button: 500,
    },
  },
  editorial: {
    weights: {
      heading: 700,
      title: 700,
      hero: 700,
      paragraph: 400,
      body: 400,
      description: 400,
      label: 600,
      caption: 400,
      button: 600,
    },
    lineHeightMultiplier: 1.15,
  },
  technical: {
    weights: {
      heading: 600,
      title: 600,
      hero: 600,
      paragraph: 400,
      body: 400,
      description: 400,
      label: 600,
      caption: 400,
      button: 500,
    },
    letterSpacingMultiplier: 1.5,
  },
  friendly: {
    weights: {
      heading: 700,
      title: 700,
      hero: 800,
      paragraph: 400,
      body: 400,
      description: 400,
      label: 500,
      caption: 400,
      button: 600,
    },
    lineHeightMultiplier: 1.1,
  },
};

/**
 * Map semantic role → preset recipe key.
 * Multiple semantic roles map to the same recipe slot.
 */
const ROLE_TO_RECIPE: Record<string, string> = {
  heading: 'heading',
  paragraph: 'paragraph',
  label: 'label',
  caption: 'caption',
  button: 'button',
  cta: 'button',
};

export function applyTypographyPreset(
  graph: SceneGraph,
  rootId: string,
  preset: TypographyPreset,
  _index?: TokenIndex,
): number {
  const recipe = RECIPES[preset];
  if (!recipe) return 0;

  let changed = 0;

  function walk(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;

    if (n.type === 'TEXT') {
      const role = (n as any).semanticRole as string | null;
      const recipeKey = role ? ROLE_TO_RECIPE[role] : undefined;
      const weight = recipeKey ? recipe.weights[recipeKey] : undefined;

      const updates: Record<string, unknown> = {};

      if (weight !== undefined) {
        const current = (n as any).fontWeight;
        if (typeof current === 'number' && current !== weight) {
          updates.fontWeight = weight;
          changed++;
        }
      }

      if (recipe.lineHeightMultiplier !== undefined) {
        const currentLh = (n as any).lineHeight;
        if (typeof currentLh === 'number' && currentLh > 0) {
          updates.lineHeight = Math.round(currentLh * recipe.lineHeightMultiplier * 100) / 100;
          changed++;
        }
      }

      if (recipe.letterSpacing !== undefined) {
        updates.letterSpacing = recipe.letterSpacing;
        changed++;
      } else if (recipe.letterSpacingMultiplier !== undefined) {
        const currentLs = (n as any).letterSpacing;
        if (typeof currentLs === 'number') {
          updates.letterSpacing = Math.round(currentLs * recipe.letterSpacingMultiplier * 100) / 100;
          changed++;
        }
      }

      if (Object.keys(updates).length > 0) {
        graph.updateNode(nodeId, updates);
      }
    }

    for (const childId of n.childIds) walk(childId);
  }

  walk(rootId);
  return changed;
}
