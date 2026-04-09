/**
 * Reframe MCP — Engine Functions
 *
 * Shared adaptation and scene I/O logic for MCP tools.
 * Extracted from packages/api/src/index.ts (no filesystem deps).
 */

import { SceneGraph } from '../../core/src/engine/scene-graph.js';
import { StandaloneHost } from '../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../core/src/host/context.js';
import { exportToSvg, type SvgExportOptions } from '../../core/src/exporters/svg.js';
import {
  serializeSceneNode,
  deserializeToGraph,
  deserializeScene,
  migrateScene,
  migrateSceneJSON,
  applyImportedNodeLayoutProps,
  type INodeJSON,
} from '../../core/src/serialize.js';

function isSceneJsonEnvelope(scene: unknown): boolean {
  if (scene === null || typeof scene !== 'object') return false;
  const o = scene as Record<string, unknown>;
  return (
    typeof o.version === 'number' ||
    o.timeline != null ||
    (o.images !== null && typeof o.images === 'object')
  );
}

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

  applyImportedNodeLayoutProps(overrides);

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

/** Serialize from live SceneGraph (with image hashes, layout, etc.) then render SVG — same idea as CLI export-svg. */
export function exportSvgFromGraph(graph: SceneGraph, rootId: string, options?: SvgExportOptions): string {
  // Serialized INode matches the SVG shape at runtime; cast matches CLI export-svg.
  return exportToSvg({ root: exportScene(graph, rootId) } as any, options);
}

export function countNodes(graph: SceneGraph, id: string): number {
  let n = 1;
  const node = graph.getNode(id);
  if (node) for (const c of node.childIds) n += countNodes(graph, c);
  return n;
}

// ─── Scene Setup ───────────────────────────────────────────────

/**
 * Build a SceneGraph from inline JSON (`resolveScene({ scene })` path).
 * Uses the same deserialization as Studio/core: `deserializeToGraph` / `deserializeScene`
 * (instance index, MIXED sentinels, BOOLEAN_OPERATION → VECTOR) instead of ad-hoc `importScene`.
 *
 * Envelope: `packages/core/src/spec/scene-envelope.ts`
 */
export function createSceneFromJson(sceneJson: any): { graph: SceneGraph; rootId: string } {
  if (!sceneJson?.root || typeof sceneJson.root !== 'object') {
    throw new Error('Invalid scene JSON: expected an object with a `root` node');
  }

  let graph: SceneGraph;
  let rootId: string;

  if (isSceneJsonEnvelope(sceneJson)) {
    const migrated = migrateSceneJSON(sceneJson);
    ({ graph, rootId } = deserializeScene(migrated));
  } else {
    const migratedRoot = migrateScene(sceneJson.root) as INodeJSON;
    ({ graph, rootId } = deserializeToGraph(migratedRoot));
  }

  setHost(new StandaloneHost(graph));
  return { graph, rootId };
}

// ─── Inspect ───────────────────────────────────────────────────

export interface InspectSceneOptions {
  /** Max depth below root to traverse for the text tree (root = 0). Deeper nodes omitted from tree lines. */
  treeMaxDepth?: number;
  /** Max lines for the text tree; remaining siblings are collapsed. */
  treeMaxLines?: number;
}

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
  treeTruncated?: boolean;
}

export function inspectScene(graph: SceneGraph, rootId: string, options?: InspectSceneOptions): InspectResult {
  const maxDepthCap = options?.treeMaxDepth;
  const maxLines = options?.treeMaxLines;

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
  let truncated = false;

  function buildTree(id: string, prefix: string, isLast: boolean, isRoot: boolean, depth: number) {
    if (maxLines !== undefined && treeLines.length >= maxLines) {
      truncated = true;
      return;
    }
    const n = graph.getNode(id);
    if (!n) return;
    const connector = isRoot ? '' : (isLast ? '└── ' : '├── ');
    let line = `${prefix}${connector}[${n.type}] ${n.name} ${Math.round(n.width)}x${Math.round(n.height)}`;
    if (n.type === 'TEXT' && n.text) {
      const preview = n.text.length > 30 ? n.text.slice(0, 30) + '...' : n.text;
      line += ` "${preview}"`;
    }
    if (maxDepthCap !== undefined && depth >= maxDepthCap - 1 && n.childIds.length > 0) {
      line += ` … (${n.childIds.length} children omitted — treeMaxDepth ${maxDepthCap})`;
    }
    treeLines.push(line);
    if (maxDepthCap !== undefined && depth >= maxDepthCap - 1) {
      if (n.childIds.length > 0) truncated = true;
      return;
    }
    const children = n.childIds;
    for (let i = 0; i < children.length; i++) {
      if (maxLines !== undefined && treeLines.length >= maxLines) {
        truncated = true;
        break;
      }
      const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
      buildTree(children[i], childPrefix, i === children.length - 1, false, depth + 1);
    }
  }
  buildTree(rootId, '', true, true, 0);

  return {
    name: root.name,
    size: { width: root.width, height: root.height },
    aspect: Math.round((root.width / root.height) * 10000) / 10000,
    stats,
    tree: treeLines.join('\n'),
    ...(truncated ? { treeTruncated: true } : {}),
  };
}
