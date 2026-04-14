/**
 * Page Composer — assemble a page from blocks.
 *
 * Takes an ordered list of block names, instantiates each,
 * stacks them vertically into a single page SceneGraph.
 *
 * Flow:
 *   composePage(["nav-simple", "hero-centered", "features-grid-3col", "footer-4col"])
 *   → single SceneGraph with all blocks stacked vertically
 *   → ready for brand application, content extraction, site export
 */

import { SceneGraph } from '../engine/scene-graph';
import type { SceneNode } from '../engine/types';
import { getBlock } from '../blocks/registry';
import { instantiateBlock } from '../blocks/instantiate';
import type { BlockDefinition } from '../blocks/types';

// ─── Types ────────────────────────────────────────────────────

export interface ComposePageInput {
  /** Block name from the registry (e.g. "hero-centered"). */
  block: string;
  /** Optional slot overrides for this block instance. */
  slots?: Record<string, string>;
}

export interface ComposePageResult {
  /** Assembled page graph. */
  graph: SceneGraph;
  /** Root node ID. */
  rootId: string;
  /** Blocks that were composed. */
  blocks: Array<{ name: string; rootNodeId: string; filledSlots: number }>;
  /** Blocks that couldn't be found. */
  notFound: string[];
  /** Total page height. */
  pageHeight: number;
}

// ─── Compose ──────────────────────────────────────────────────

/**
 * Compose a page from an ordered list of blocks.
 *
 * Each block is instantiated, then its subtree is merged into
 * a single vertical-layout page frame (1440px wide by default).
 */
export function composePage(
  blocks: ComposePageInput[],
  options?: { pageWidth?: number; pageName?: string },
): ComposePageResult {
  const pageWidth = options?.pageWidth ?? 1440;
  const pageName = options?.pageName ?? 'Page';

  // Create page graph with a root vertical frame
  const pageGraph = new SceneGraph();
  const rootId = pageGraph.createNode('FRAME', pageGraph.rootId, {
    name: pageName,
    width: pageWidth,
    height: 0, // will be computed
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    clipsContent: true,
  } as Partial<SceneNode>).id;

  const composed: ComposePageResult['blocks'] = [];
  const notFound: string[] = [];
  let currentY = 0;

  for (const input of blocks) {
    const def = getBlock(input.block);
    if (!def) {
      notFound.push(input.block);
      continue;
    }

    // Instantiate the block
    const { graph: blockGraph, rootId: blockRootId, filledSlots } = instantiateBlock(def, input.slots);

    // Merge block subtree into page graph
    const blockRoot = blockGraph.getNode(blockRootId);
    if (!blockRoot) continue;

    // Clone the block subtree into the page graph
    const mergedRootId = mergeSubtree(pageGraph, blockGraph, blockRootId, rootId, pageWidth);

    if (mergedRootId) {
      composed.push({
        name: input.block,
        rootNodeId: mergedRootId,
        filledSlots,
      });

      // Track height for page sizing
      const mergedNode = pageGraph.getNode(mergedRootId);
      if (mergedNode) currentY += mergedNode.height;
    }
  }

  // Update root height
  pageGraph.updateNode(rootId, { height: currentY || 800 });

  return {
    graph: pageGraph,
    rootId,
    blocks: composed,
    notFound,
    pageHeight: currentY,
  };
}

/**
 * Merge a subtree from one SceneGraph into another.
 * Creates new nodes in the target graph, preserving structure.
 */
function mergeSubtree(
  target: SceneGraph,
  source: SceneGraph,
  sourceNodeId: string,
  targetParentId: string,
  pageWidth: number,
): string | null {
  const sourceNode = source.getNode(sourceNodeId);
  if (!sourceNode) return null;

  // Create node in target, stretching to page width
  const props: Partial<SceneNode> = {};
  const skipKeys = new Set(['id', 'parentId', 'childIds']);

  for (const [key, value] of Object.entries(sourceNode)) {
    if (skipKeys.has(key)) continue;
    (props as any)[key] = value;
  }

  // Stretch root block frame to page width
  props.width = pageWidth;

  const newNode = target.createNode(sourceNode.type as any, targetParentId, props);

  // Recursively merge children
  for (const childId of sourceNode.childIds) {
    mergeSubtree(target, source, childId, newNode.id, pageWidth);
  }

  return newNode.id;
}

/** Format compose result for text output. */
export function formatComposeResult(result: ComposePageResult): string {
  const lines: string[] = [];
  lines.push(`Page composed: ${result.blocks.length} blocks, ${result.pageHeight}px tall`);
  lines.push('');

  for (const b of result.blocks) {
    lines.push(`  ✓ ${b.name} (${b.filledSlots} slots filled)`);
  }

  if (result.notFound.length > 0) {
    lines.push('');
    lines.push(`Not found: ${result.notFound.join(', ')}`);
    lines.push('Use reframe_project({ action: "list_blocks" }) to see available blocks.');
  }

  lines.push('');
  lines.push('Next steps:');
  lines.push('  1. reframe_inspect() — verify the composed page');
  lines.push('  2. reframe_edit({ defineTokens ... }) — apply brand');
  lines.push('  3. reframe_project({ action: "extract_content" }) — get .md for editing');
  lines.push('  4. reframe_export({ format: "html" }) — export');

  return lines.join('\n');
}
