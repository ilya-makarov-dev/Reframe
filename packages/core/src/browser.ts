/**
 * Browser-safe subset of @reframe/core.
 *
 * Only exports modules that have no Node.js dependencies (no fs, path, etc.).
 * Used by the editor bundle for browser builds.
 */

export { SceneGraph, generateId, createDefaultNode } from './engine/scene-graph.js';
export type { SceneNode } from './engine/types.js';
export type { SceneGraphEvents } from './engine/types.js';
export { deserializeToGraph, serializeGraph } from './serialize.js';
