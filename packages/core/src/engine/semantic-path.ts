// Semantic path computation + resolution for agent-operable INode.
//
// WHY: Agents need stable node addresses that survive id regeneration
// across recompiles. Auto-generated ids change every compile — that
// breaks any patch an agent issued in a prior turn. Stable paths derived
// from node.name (or semanticRole / type when name is absent) with
// sibling-index disambiguation give us the same address across compiles
// as long as the designer-meaningful structure hasn't moved.
//
// Contract:
//   - `computeSemanticPaths(graph)` walks the scene and assigns
//     `node.semanticPath` in-place. Root = null. Called after every
//     structural mutation.
//   - `findNodeByPath(graph, path)` resolves a path string back to a
//     node. O(n) scan — fine for typical scene sizes; promotable to an
//     index if callers hammer it.
//   - `substituteGestureArgs(args, ctx)` swaps {value}, {path}, {id}
//     placeholders in gesture arg templates at dispatch time.

import type { SceneGraph } from './scene-graph.js';
import type { SceneNode } from './types.js';

const SEGMENT_SANITIZE = /[^a-z0-9-]+/g;
const TRIM_DASHES = /^-+|-+$/g;

/**
 * Normalize a node into a URL-safe path segment.
 * Order of preference: explicit name → semanticRole → type (lowercased).
 * Non-alphanumerics collapse to single dashes; leading/trailing dashes stripped.
 */
function segmentFor(node: SceneNode): string {
  const raw = (node.name || node.semanticRole || node.type || 'node').toString();
  const normalized = raw.toLowerCase().replace(SEGMENT_SANITIZE, '-').replace(TRIM_DASHES, '');
  return normalized || node.type.toLowerCase();
}

/**
 * Walk the graph from root and assign `semanticPath` on every node.
 * When siblings collide on segment name, disambiguate with `:index` suffix
 * (zero-based position among colliding siblings under the same parent).
 */
export function computeSemanticPaths(graph: SceneGraph): void {
  const root = graph.getNode(graph.rootId);
  if (!root) return;
  root.semanticPath = null;
  assignChildren(graph, root, []);
}

function assignChildren(graph: SceneGraph, parent: SceneNode, ancestorSegs: string[]): void {
  const children = parent.childIds
    .map(id => graph.getNode(id))
    .filter((n): n is SceneNode => !!n);

  // First pass: count occurrences of each normalized segment under this parent.
  const counts = new Map<string, number>();
  const segs: string[] = [];
  for (const child of children) {
    const seg = segmentFor(child);
    segs.push(seg);
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }

  // Second pass: assign paths with disambiguation when needed.
  const seen = new Map<string, number>();
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const seg = segs[i];
    const finalSeg = counts.get(seg)! > 1
      ? `${seg}:${(seen.get(seg) ?? 0)}`
      : seg;
    if (counts.get(seg)! > 1) seen.set(seg, (seen.get(seg) ?? 0) + 1);
    const path = [...ancestorSegs, finalSeg].join('/');
    child.semanticPath = path;
    assignChildren(graph, child, [...ancestorSegs, finalSeg]);
  }
}

/**
 * Resolve a semantic path to a node. Returns null if not found.
 * Root is addressable as `null` or empty string (but callers rarely want root).
 */
export function findNodeByPath(graph: SceneGraph, path: string | null): SceneNode | null {
  if (path === null || path === '') return graph.getNode(graph.rootId) ?? null;
  for (const node of graph.getAllNodes()) {
    if (node.semanticPath === path) return node;
  }
  return null;
}

/**
 * Substitute gesture arg placeholders at dispatch time.
 * Known placeholders:
 *   {value} — runtime input value (onInput dispatches pass this)
 *   {path}  — dispatching node's semanticPath
 *   {id}    — dispatching node's id
 * Scalars are replaced verbatim; object/array values recurse.
 * Unknown placeholders pass through untouched — makes agent-authored
 * manifests fail-soft rather than fail-hard.
 */
export function substituteGestureArgs(
  args: Record<string, unknown>,
  ctx: { value?: unknown; path?: string | null; id?: string }
): Record<string, unknown> {
  return substituteRecursive(args, ctx) as Record<string, unknown>;
}

function substituteRecursive(value: unknown, ctx: { value?: unknown; path?: string | null; id?: string }): unknown {
  if (typeof value === 'string') {
    if (value === '{value}') return ctx.value;
    if (value === '{path}') return ctx.path ?? null;
    if (value === '{id}') return ctx.id ?? null;
    return value.replace(/\{(value|path|id)\}/g, (_, key) => {
      const v = key === 'value' ? ctx.value : key === 'path' ? ctx.path : ctx.id;
      return v == null ? '' : String(v);
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => substituteRecursive(v, ctx));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteRecursive(v, ctx);
    }
    return out;
  }
  return value;
}
