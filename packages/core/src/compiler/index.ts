/**
 * Reframe Compiler — content + design system → INode blueprint.
 *
 * No LLM needed for layout. The compiler resolves typography, colors,
 * spacing from the DesignSystem and picks a layout strategy.
 *
 * Output: NodeBlueprint — ready for `build()` → SceneGraph → export.
 */

import type { NodeBlueprint } from '../builder.js';
import type { CompileOptions } from './types.js';
import { resolveTheme } from './theme.js';
import { buildCenteredLayout, buildLeftAlignedLayout, buildSplitLayout, buildStackedLayout } from './layouts.js';

/**
 * Compile content + design system into an INode blueprint.
 *
 * The blueprint is a pure data structure — no side effects, no graph mutation.
 * Call `build(blueprint)` to materialize into a SceneGraph.
 */
export function compileTemplate(options: CompileOptions): NodeBlueprint {
  const theme = resolveTheme(options.designSystem, options.width, options.height);

  switch (options.layout) {
    case 'split':
      return buildSplitLayout(options.width, options.height, options.content, theme);
    case 'left-aligned':
      return buildLeftAlignedLayout(options.width, options.height, options.content, theme);
    case 'stacked':
      return buildStackedLayout(options.width, options.height, options.content, theme);
    case 'centered':
    default:
      return buildCenteredLayout(options.width, options.height, options.content, theme);
  }
}

/**
 * Auto-pick best layout based on content and aspect ratio.
 */
export function autoPickLayout(width: number, height: number, content: CompileOptions['content']): CompileOptions['layout'] {
  const aspect = width / height;
  const hasImage = !!content.imageUrl;

  // Wide formats (banners): left-aligned or split
  if (aspect > 2.5) return 'left-aligned';

  // Landscape with image: split
  if (aspect > 1.2 && hasImage) return 'split';

  // Portrait with image: stacked (image on top)
  if (aspect < 0.8 && hasImage) return 'stacked';

  // Square or near-square: centered
  return 'centered';
}

export * from './types.js';
export * from './theme.js';
export * from './layouts.js';
