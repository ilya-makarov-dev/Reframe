/**
 * reframe_vary — generate variation grids deterministically.
 *
 * Takes a source scene and a set of axes (brand, density, radius, shadows,
 * typography, mode, colorRotation) and produces N = product of axis sizes
 * variation scenes. Each variant is a full clone with all transforms applied
 * in sequence — brand rebrand first (if any), then setMode, then shape
 * transforms, then typography, then color rotation.
 *
 * Pure algorithmic — no AI. Ideal for:
 *   - Design space exploration ("show me all combinations")
 *   - A/B test candidate generation
 *   - Template sets (same content, N brand treatments)
 *
 * Returns the list of generated scene IDs so the caller can inspect/export
 * each variant individually.
 */

import { z } from 'zod';
import { getSession } from '../session.js';
import { getScene, storeScene, getWorkspaceRoot } from '../store.js';
import { deepCloneTree } from './edit.js';
import { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import {
  generateVariationGrid,
  scaleSpacing as vScaleSpacing,
  scaleRadius as vScaleRadius,
  scaleShadows as vScaleShadows,
  rotateColors as vRotateColors,
  applyTypographyPreset as vTypographyPreset,
} from '../../../core/src/variations/index.js';
import {
  tokenizeDesignSystem,
  autoBindTokensFromGraph,
  rebrandColorsFromTokens,
  switchTokenMode,
  rebuildTokenIndexFromGraph,
} from '../../../core/src/design-system/tokens.js';
import { parseDesignMd, applyBrandInheritance } from '../../../core/src/design-system/index.js';
import { coreProjectIo } from '../project-io.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';

export const varyInputSchema = {
  sceneId: z.string().describe('Source scene ID to derive variations from. Each variant is a deep clone with transforms applied.'),
  axes: z.object({
    brand: z.array(z.string()).optional().describe('Brand slugs to apply via defineTokens + rebrandColorsFromTokens'),
    density: z.array(z.number()).optional().describe('Density factors (e.g. [0.8, 1.0, 1.2]) — multiplies spacing'),
    radius: z.array(z.union([
      z.enum(['sharp', 'soft', 'pill', 'editorial']),
      z.object({ factor: z.number() }),
      z.object({ value: z.number() }),
    ])).optional().describe('Radius strategies'),
    shadows: z.array(z.union([
      z.enum(['flat', 'subtle', 'normal', 'dramatic']),
      z.object({ factor: z.number() }),
    ])).optional().describe('Shadow strategies'),
    typography: z.array(z.enum(['dramatic', 'flat', 'editorial', 'technical', 'friendly']))
      .optional().describe('Typography presets'),
    mode: z.array(z.string()).optional().describe('Token modes (light/dark)'),
    colorRotation: z.array(z.union([
      z.enum(['invert-accent', 'invert-mode']),
      z.tuple([z.string(), z.string()]),
    ])).optional().describe('Color rotations'),
  }).describe('Variation axes — Cartesian product generates all combinations'),
  namePrefix: z.string().optional().describe('Prefix for generated scene names (default: source name + "-v")'),
  limit: z.number().optional().describe('Maximum number of variants to generate. Default: 64 (safety cap).'),
};

const schemaObject = z.object(varyInputSchema);
export type VaryInput = z.infer<typeof schemaObject>;

function loadBrandMd(slug: string): string | undefined {
  try {
    const projectDir = getWorkspaceRoot();
    const loaded = coreProjectIo().loadBrandFromProject(projectDir, slug);
    return loaded?.content;
  } catch {
    return undefined;
  }
}

export async function handleVary(input: VaryInput) {
  const session = getSession();
  session.recordToolCall('vary');

  const sourceScene = getScene(input.sceneId);
  if (!sourceScene) {
    return {
      content: [{ type: 'text' as const, text: `reframe_vary ERROR: scene "${input.sceneId}" not found` }],
    };
  }

  const limit = input.limit ?? 64;
  const recipes = generateVariationGrid(input.axes);

  if (recipes.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'reframe_vary: no axes specified — nothing to generate' }],
    };
  }

  if (recipes.length > limit) {
    return {
      content: [{
        type: 'text' as const,
        text: `reframe_vary ERROR: grid has ${recipes.length} variants, exceeds limit ${limit}. Narrow axes or raise limit.`,
      }],
    };
  }

  const prefix = input.namePrefix ?? `${sourceScene.name}-v`;
  const lines: string[] = [
    `reframe_vary: generating ${recipes.length} variants from ${input.sceneId} "${sourceScene.name}"`,
    '',
  ];

  const generated: Array<{ sceneId: string; label: string }> = [];

  for (const recipe of recipes) {
    // Deep-clone source graph into a fresh SceneGraph via deepCloneTree
    const newGraph = new SceneGraph();
    const page = newGraph.addPage('Scene');
    deepCloneTree(sourceScene.graph, sourceScene.rootId, newGraph, page.id);
    const newRoot = newGraph.getChildren(page.id)[0];
    if (!newRoot) {
      lines.push(`  ${recipe.id} — CLONE FAILED`);
      continue;
    }
    const cloneName = `${prefix}${recipe.id}`;
    newGraph.updateNode(newRoot.id, { name: cloneName });

    const transforms: string[] = [];

    // 1. Apply brand (defineTokens + rebrand + inheritance)
    if (recipe.axes.brand) {
      const brandMd = loadBrandMd(recipe.axes.brand);
      if (brandMd) {
        try {
          const parsed = session.getOrParseDesignMd(brandMd, parseDesignMd);
          const tokenIdx = tokenizeDesignSystem(newGraph, parsed, { darkMode: true });
          autoBindTokensFromGraph(newGraph, newRoot.id, tokenIdx);
          rebrandColorsFromTokens(newGraph, newRoot.id, tokenIdx);
          applyBrandInheritance(newGraph, newRoot.id, parsed);
          transforms.push(`brand=${recipe.axes.brand}`);
        } catch {
          transforms.push(`brand=${recipe.axes.brand}(FAILED)`);
        }
      }
    }

    // 2. Apply mode (light/dark) — only if tokens exist
    if (recipe.axes.mode) {
      const tokenIdx = rebuildTokenIndexFromGraph(newGraph);
      if (tokenIdx) {
        switchTokenMode(newGraph, tokenIdx, recipe.axes.mode);
        transforms.push(`mode=${recipe.axes.mode}`);
      }
    }

    // 3. Density (spacing)
    if (recipe.axes.density !== undefined) {
      vScaleSpacing(newGraph, newRoot.id, recipe.axes.density);
      transforms.push(`d=${recipe.axes.density}`);
    }

    // 4. Radius
    if (recipe.axes.radius) {
      vScaleRadius(newGraph, newRoot.id, recipe.axes.radius);
      const label = typeof recipe.axes.radius === 'string' ? recipe.axes.radius : JSON.stringify(recipe.axes.radius);
      transforms.push(`r=${label}`);
    }

    // 5. Shadows
    if (recipe.axes.shadows) {
      vScaleShadows(newGraph, newRoot.id, recipe.axes.shadows);
      const label = typeof recipe.axes.shadows === 'string' ? recipe.axes.shadows : JSON.stringify(recipe.axes.shadows);
      transforms.push(`s=${label}`);
    }

    // 6. Typography
    if (recipe.axes.typography) {
      vTypographyPreset(newGraph, newRoot.id, recipe.axes.typography);
      transforms.push(`t=${recipe.axes.typography}`);
    }

    // 7. Color rotation (after tokens exist, so it rotates the actual bound values)
    if (recipe.axes.colorRotation) {
      const tokenIdx = rebuildTokenIndexFromGraph(newGraph);
      if (tokenIdx) {
        vRotateColors(newGraph, tokenIdx, recipe.axes.colorRotation);
        const label = typeof recipe.axes.colorRotation === 'string'
          ? recipe.axes.colorRotation
          : `${recipe.axes.colorRotation[0]}↔${recipe.axes.colorRotation[1]}`;
        transforms.push(`cr=${label}`);
      }
    }

    // Ensure layout is current after all mutations
    ensureSceneLayout(newGraph, newRoot.id);

    // Store scene in session
    const newSceneId = storeScene(newGraph, newRoot.id, undefined, { name: cloneName });
    session.trackImport(newSceneId, cloneName, newRoot.width, newRoot.height, true);

    generated.push({ sceneId: newSceneId, label: recipe.label });
    lines.push(`  ${newSceneId} ${recipe.label} — ${transforms.join(', ') || '(no-op)'}`);
  }

  lines.push('');
  lines.push(`Done: ${generated.length} variants generated. Next: reframe_inspect or reframe_export each scene ID.`);

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}
