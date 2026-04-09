/**
 * Scene I/O — load and save scene JSON files.
 *
 * Delegates to core serialize for full-fidelity roundtrips.
 * Handles v1 (legacy) and v2 (current) formats transparently.
 */

import * as fs from 'fs';
import { SceneGraph } from '../../core/src/engine/scene-graph.js';
import {
  serializeSceneNode,
  deserializeScene,
  migrateScene, migrateSceneJSON,
  SERIALIZE_VERSION,
  type INodeJSON, type SceneJSON,
} from '../../core/src/serialize.js';

// Re-export INodeJSON as SceneNodeJson for backward compat
export type SceneNodeJson = INodeJSON;
export type SceneJson = SceneJSON;
export { SERIALIZE_VERSION };

export function loadScene(filePath: string): SceneJSON {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(raw);
  if (!data.root) {
    throw new Error('Invalid scene file: missing "root" key');
  }
  // Auto-migrate from any version to current
  return migrateSceneJSON(data);
}

export function saveScene(scene: SceneJSON, filePath: string): void {
  // Ensure version is set
  scene.version = scene.version ?? SERIALIZE_VERSION;
  fs.writeFileSync(filePath, JSON.stringify(scene, null, 2), 'utf-8');
}

/**
 * Build a SceneGraph from a migrated SceneJSON envelope (e.g. {@link loadScene}).
 * Restores embedded images the same way as core deserialize.
 */
export function graphFromSceneEnvelope(scene: SceneJSON): { graph: SceneGraph; rootId: string } {
  const { graph, rootId } = deserializeScene(scene);
  return { graph, rootId };
}

/**
 * Populate a SceneGraph from scene JSON.
 * Returns the root node ID.
 */
export function importScene(
  graph: SceneGraph,
  pageId: string,
  nodeJson: any,
): string {
  const migrated = migrateScene(nodeJson);
  return importNodeRecursive(graph, pageId, migrated);
}

function importNodeRecursive(graph: SceneGraph, pageId: string, nodeJson: any): string {
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

  const node = graph.createNode(nodeJson.type ?? 'FRAME', pageId, {
    name: nodeJson.name ?? nodeJson.type ?? 'Node',
    ...overrides,
  });

  if (nodeJson.children) {
    for (const childJson of nodeJson.children) {
      importNodeRecursive(graph, node.id, childJson);
    }
  }

  return node.id;
}

/**
 * Export a SceneGraph subtree to INodeJSON (full fidelity).
 */
export function exportScene(graph: SceneGraph, nodeId: string): INodeJSON {
  return serializeSceneNode(graph, nodeId, { compact: true });
}
