/**
 * Ensures MCP createSceneFromJson matches the historical importScene(graph, page, root) tree.
 * Uses resetIdCounter so node id sequences align for deepEqual on stripped serialize output.
 */
import assert from 'node:assert/strict';
import { resetIdCounter } from '../packages/core/src/engine/scene-graph.js';
import { serializeSceneNode } from '../packages/core/src/serialize.js';
import { createSceneFromJson, importScene } from '../packages/mcp/src/engine.js';
import { SceneGraph } from '../packages/core/src/engine/scene-graph.js';
import { StandaloneHost } from '../packages/core/src/adapters/standalone/adapter.js';
import { setHost } from '../packages/core/src/host/context.js';

function legacyCreateSceneFromJson(sceneJson: { root: unknown }) {
  const graph = new SceneGraph();
  const host = new StandaloneHost(graph);
  setHost(host);
  const page = graph.addPage('Source');
  const rootId = importScene(graph, page.id, sceneJson.root as any);
  return { graph, rootId };
}

function stripIds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripIds);
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (k === 'id') continue;
      out[k] = stripIds(o[k]);
    }
    return out;
  }
  return node;
}

function assertParity(sceneWrapper: { root: any; version?: number; images?: Record<string, string> }) {
  resetIdCounter(1);
  const legacy = legacyCreateSceneFromJson({ root: sceneWrapper.root });
  const serLegacy = stripIds(serializeSceneNode(legacy.graph, legacy.rootId, { compact: false }));

  resetIdCounter(1);
  const modern = createSceneFromJson(sceneWrapper);
  const serModern = stripIds(serializeSceneNode(modern.graph, modern.rootId, { compact: false }));

  assert.deepEqual(serModern, serLegacy);
}

assertParity({
  root: {
    type: 'FRAME',
    name: 'Root',
    width: 400,
    height: 300,
    children: [
      { type: 'TEXT', name: 'T', characters: 'Hi', width: 100, height: 24, fontSize: 14 },
    ],
  },
});

assertParity({
  version: 1,
  root: {
    type: 'FRAME',
    name: 'Legacy',
    width: 100,
    height: 100,
    horizontalConstraint: 'STRETCH',
    verticalConstraint: 'MAX',
  },
});

assertParity({
  version: 2,
  root: {
    type: 'FRAME',
    name: 'R',
    width: 10,
    height: 10,
  },
  images: {},
});

assertParity({
  root: {
    type: 'INSTANCE',
    name: 'I',
    width: 50,
    height: 50,
    componentId: '0:999',
    overrides: {},
    variantProperties: {},
  },
});

console.log('scene import parity: OK');
