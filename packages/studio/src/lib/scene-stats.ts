/**
 * Single source for scene dimensions + node counts shown in Studio UI
 * (toolbar, tabs, MCP list when a tab is hydrated with this scene).
 */

import type { SceneGraph } from '@reframe/core/engine/scene-graph';

export function countSceneNodes(graph: SceneGraph, rootId: string): number {
  let n = 0;
  const walk = (id: string) => {
    const node = graph.getNode(id);
    if (!node) return;
    n++;
    for (const c of node.childIds) walk(c);
  };
  walk(rootId);
  return n;
}

export function rootFrameMetrics(
  graph: SceneGraph | null,
  rootId: string | null,
): { width: number; height: number } | null {
  if (!graph || !rootId) return null;
  const root = graph.getNode(rootId);
  if (!root) return null;
  return { width: Math.round(root.width), height: Math.round(root.height) };
}

/** Patch fragment for Artboard.width / height from the current design root */
export function artboardSizePatch(
  graph: SceneGraph | null,
  rootId: string | null,
): { width: number; height: number } | undefined {
  const m = rootFrameMetrics(graph, rootId);
  if (!m) return undefined;
  return m;
}
