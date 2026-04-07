/**
 * Reframe MCP — Engine Functions
 *
 * Shared adaptation and scene I/O logic for MCP tools.
 * Extracted from packages/api/src/index.ts (no filesystem deps).
 */

import { SceneGraph } from '../../core/src/engine/scene-graph.js';
import { StandaloneHost } from '../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../core/src/host/context.js';
import { serializeSceneNode, deserializeToGraph, migrateScene, type INodeJSON } from '../../core/src/serialize.js';

// ─── Scene Import/Export ───────────────────────────────────────

/**
 * Import a node JSON tree into a SceneGraph.
 * Handles both v1 (legacy) and v2 (full-fidelity) formats.
 */
export function importScene(graph: SceneGraph, parentId: string, nodeJson: any): string {
  const migrated = migrateScene(nodeJson);
  return importNodeRecursive(graph, parentId, migrated);
}

function importNodeRecursive(graph: SceneGraph, parentId: string, nodeJson: any): string {
  const overrides: Record<string, any> = {};
  const skip = new Set(['type', 'children', 'name', 'id', 'version', 'timeline', 'strokeWeight']);

  for (const [key, value] of Object.entries(nodeJson)) {
    if (skip.has(key) || value === undefined) continue;
    overrides[key] = value;
  }

  // Normalize constraints → engine fields
  if (nodeJson.constraints) {
    overrides.horizontalConstraint = nodeJson.constraints.horizontal;
    overrides.verticalConstraint = nodeJson.constraints.vertical;
    delete overrides.constraints;
  }

  // Normalize characters → text
  if ('characters' in overrides && !('text' in overrides)) {
    overrides.text = overrides.characters;
    delete overrides.characters;
  }

  const node = graph.createNode(nodeJson.type ?? 'FRAME', parentId, {
    name: nodeJson.name ?? nodeJson.type ?? 'Node',
    ...overrides,
  });

  if (nodeJson.children) {
    for (const child of nodeJson.children) {
      importNodeRecursive(graph, node.id, child);
    }
  }

  return node.id;
}

/**
 * Export a SceneGraph subtree to INodeJSON (full fidelity).
 * Replaces the old lossy export — all SceneNode properties are captured.
 */
export function exportScene(graph: SceneGraph, nodeId: string): INodeJSON {
  return serializeSceneNode(graph, nodeId, { compact: true });
}

export function countNodes(graph: SceneGraph, id: string): number {
  let n = 1;
  const node = graph.getNode(id);
  if (node) for (const c of node.childIds) n += countNodes(graph, c);
  return n;
}

// ─── Scene Setup ───────────────────────────────────────────────

export function createSceneFromJson(sceneJson: any): { graph: SceneGraph; rootId: string } {
  const graph = new SceneGraph();
  const host = new StandaloneHost(graph);
  setHost(host);
  const page = graph.addPage('Source');
  const rootId = importScene(graph, page.id, sceneJson.root);
  return { graph, rootId };
}

// ─── Inspect ───────────────────────────────────────────────────

export interface InspectResult {
  name: string;
  size: { width: number; height: number };
  aspect: number;
  stats: {
    total: number;
    byType: Record<string, number>;
    maxDepth: number;
    textNodes: number;
    autoLayoutFrames: number;
  };
  tree: string;
}

export function inspectScene(graph: SceneGraph, rootId: string): InspectResult {
  const root = graph.getNode(rootId)!;
  const stats = { total: 0, byType: {} as Record<string, number>, maxDepth: 0, textNodes: 0, autoLayoutFrames: 0 };

  function walk(id: string, depth: number) {
    const n = graph.getNode(id);
    if (!n) return;
    stats.total++;
    stats.byType[n.type] = (stats.byType[n.type] ?? 0) + 1;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    if (n.type === 'TEXT') stats.textNodes++;
    if (n.layoutMode !== 'NONE') stats.autoLayoutFrames++;
    for (const c of n.childIds) walk(c, depth + 1);
  }
  walk(rootId, 0);

  const treeLines: string[] = [];
  function buildTree(id: string, prefix: string, isLast: boolean, isRoot: boolean) {
    const n = graph.getNode(id);
    if (!n) return;
    const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
    let line = `${prefix}${connector}[${n.type}] ${n.name} ${Math.round(n.width)}x${Math.round(n.height)}`;
    if (n.type === 'TEXT' && n.text) {
      const preview = n.text.length > 30 ? n.text.slice(0, 30) + '...' : n.text;
      line += ` "${preview}"`;
    }
    treeLines.push(line);
    const children = n.childIds;
    for (let i = 0; i < children.length; i++) {
      const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
      buildTree(children[i], childPrefix, i === children.length - 1, false);
    }
  }
  buildTree(rootId, '', true, true);

  return {
    name: root.name,
    size: { width: root.width, height: root.height },
    aspect: Math.round((root.width / root.height) * 10000) / 10000,
    stats,
    tree: treeLines.join('\n'),
  };
}
