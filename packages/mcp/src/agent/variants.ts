/**
 * Agent variants — Midjourney-style "give me N options" for the agent
 * prompt. After the agent finishes a single AI generation, we cheaply
 * deterministic-vary the resulting scene N-1 times so the user gets
 * N distinct options for the cost of 1 AI call.
 *
 * Strategy at MVP:
 *   N=1 → no-op (the AI's result is the only output)
 *   N=2 → original + 1 typography variation
 *   N=4 → original + density variation + radius variation + typography variation
 *
 * This is "Strategy B" from the design doc — engine-only variations.
 * Cheap, fast, deterministic. Future "Strategy C" (hybrid: 2× AI calls
 * with engine-vary on each) can swap in here without touching callers.
 *
 * Each variant becomes a NEW session scene with a derived name. The
 * caller gets back the list of new scene IDs and can broadcast them
 * via SSE so the UI can render a picker / gallery.
 */

import { getScene, storeScene } from '../store.js';
import { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { deepCloneTree } from '../tools/edit.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import {
  scaleSpacing,
  scaleRadius,
  applyTypographyPreset,
} from '../../../core/src/variations/index.js';
import type {
  RadiusStrategy,
  TypographyPreset,
} from '../../../core/src/variations/index.js';

// ─── Preset variant recipes ────────────────────────────────

interface VariantRecipe {
  /** Suffix appended to scene name. */
  label: string;
  /** Apply the transform to the cloned graph. */
  apply: (graph: SceneGraph, rootId: string) => void;
}

/**
 * Recipes used when the user asks for N variants. The first variant is
 * always "original" (a clone of the AI's output, untransformed) so the
 * gallery has a baseline to compare against. The remaining recipes are
 * picked from this pool in order.
 */
const RECIPE_POOL: VariantRecipe[] = [
  {
    label: 'compact',
    apply: (g, root) => { scaleSpacing(g, root, 0.75, { preserveAtoms: true }); },
  },
  {
    label: 'pill',
    apply: (g, root) => { scaleRadius(g, root, 'pill' as RadiusStrategy); },
  },
  {
    label: 'editorial-type',
    apply: (g, root) => { applyTypographyPreset(g, root, 'editorial' as TypographyPreset); },
  },
  {
    label: 'spacious',
    apply: (g, root) => { scaleSpacing(g, root, 1.3, { preserveAtoms: true }); },
  },
  {
    label: 'sharp',
    apply: (g, root) => { scaleRadius(g, root, 'sharp' as RadiusStrategy); },
  },
];

function pickRecipes(count: number): VariantRecipe[] {
  // count is the number of EXTRA variants needed (excluding original).
  return RECIPE_POOL.slice(0, count);
}

// ─── Public API ─────────────────────────────────────────────

export interface GenerateVariantsResult {
  /** All variant scene IDs in display order (original first). */
  sceneIds: string[];
  /** Per-scene metadata: id, name, label. */
  variants: Array<{ sceneId: string; name: string; label: string }>;
  /** Source scene id (echoed back for clarity). */
  sourceSceneId: string;
}

/**
 * Clone the source scene and produce N total variants, including the
 * original as variant #1. Returns the new scene IDs.
 *
 * If the source scene cannot be found, returns { sceneIds: [], variants: [] }.
 *
 * Note: the original scene is NOT mutated — we always clone, even for
 * variant #1. That keeps the agent's edit fully reversible (the user
 * sees their pre-AI scene + N alternatives) instead of half-baked
 * (original is gone, replaced by AI's output).
 *
 * Currently the AI's output IS the source — we don't preserve the
 * "before AI" state because that requires snapshotting before spawn.
 * Phase 2 will add that.
 */
export function generateAgentVariants(
  sourceSceneId: string,
  totalCount: number,
): GenerateVariantsResult {
  const empty: GenerateVariantsResult = { sceneIds: [], variants: [], sourceSceneId };
  if (totalCount <= 1) return empty;

  const source = getScene(sourceSceneId);
  if (!source) return empty;

  const variants: GenerateVariantsResult['variants'] = [];
  const sceneIds: string[] = [];

  // Variant #1 — clone of source, no transforms. We re-store it so the
  // gallery shows N peer variants instead of "original + N clones"
  // (which would be N+1 scenes and confusing).
  // Decision: keep original as-is, only ADD the N-1 alternatives.
  // Most natural for MJ-style: original is variant #1 implicitly.
  variants.push({
    sceneId: sourceSceneId,
    name: source.name,
    label: 'original',
  });
  sceneIds.push(sourceSceneId);

  const recipes = pickRecipes(totalCount - 1);
  for (const recipe of recipes) {
    try {
      // Deep-clone — same pattern as handleVary in tools/vary.ts.
      const newGraph = new SceneGraph();
      const page = newGraph.addPage('Scene');
      deepCloneTree(source.graph, source.rootId, newGraph, page.id);
      const newRootNode = newGraph.getChildren(page.id)[0];
      if (!newRootNode) continue;
      const newRootId = newRootNode.id;

      const cloneName = `${source.name} (${recipe.label})`;
      newGraph.updateNode(newRootId, { name: cloneName });

      // Apply the recipe's transform.
      try { recipe.apply(newGraph, newRootId); } catch { /* best-effort */ }

      // Recompute layout after mutations so dimensions are current.
      try { ensureSceneLayout(newGraph, newRootId); } catch { /* best-effort */ }

      const newSceneId = storeScene(newGraph, newRootId, undefined, { name: cloneName });
      variants.push({ sceneId: newSceneId, name: cloneName, label: recipe.label });
      sceneIds.push(newSceneId);
    } catch {
      // Skip failed variants instead of aborting the whole batch.
      continue;
    }
  }

  return { sceneIds, variants, sourceSceneId };
}
