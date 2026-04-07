/**
 * Design Diff — structural comparison of two INode trees.
 *
 * Like `git diff` for design. Detects added, removed, modified,
 * and moved nodes with property-level granularity.
 */

import { type INode, MIXED } from './host';

// ─── Types ────────────────────────────────────────────────────

export type DiffType = 'added' | 'removed' | 'modified' | 'moved';

export interface PropertyChange {
  property: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface DiffEntry {
  type: DiffType;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  path: string;
  changes?: PropertyChange[];
  oldParentId?: string;
  newParentId?: string;
}

export interface DiffOptions {
  /** Match strategy: 'id' (exact), 'name-type' (heuristic), 'both' (default) */
  matchStrategy?: 'id' | 'name-type' | 'both';
  /** Properties to ignore in comparison */
  ignoreProperties?: string[];
}

export interface DiffResult {
  entries: DiffEntry[];
  summary: { added: number; removed: number; modified: number; moved: number };
}

// ─── Property comparison ──────────────────────────────────────

/** INode properties to compare (value properties, no methods/tree) */
const COMPARABLE_PROPS: string[] = [
  'x', 'y', 'width', 'height',
  'layoutMode', 'layoutPositioning', 'clipsContent',
  'primaryAxisAlign', 'counterAxisAlign', 'itemSpacing', 'counterAxisSpacing',
  'layoutWrap', 'layoutGrow',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fills', 'strokes', 'effects',
  'cornerRadius', 'topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius',
  'strokeWeight', 'opacity', 'visible', 'rotation', 'blendMode',
  'fontSize', 'fontName', 'fontWeight', 'fontFamily',
  'characters', 'lineHeight', 'letterSpacing',
  'textAutoResize', 'textAlignHorizontal', 'textAlignVertical',
  'textCase', 'textDecoration',
];

function normalize(val: unknown): unknown {
  if (val === MIXED) return '__MIXED__';
  if (val === undefined || val === null) return null;
  if (typeof val === 'object') return JSON.stringify(val);
  return val;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return normalize(a) === normalize(b);
}

// ─── Tree flattening ──────────────────────────────────────────

interface FlatNode {
  node: INode;
  parentId: string | null;
  path: string;
  depth: number;
}

function flattenTree(root: INode, prefix = ''): Map<string, FlatNode> {
  const map = new Map<string, FlatNode>();

  function walk(node: INode, parentId: string | null, path: string, depth: number): void {
    if (node.removed) return;
    map.set(node.id, { node, parentId, path, depth });
    if (node.children) {
      for (const child of node.children) {
        walk(child, node.id, `${path}/${child.name}`, depth + 1);
      }
    }
  }

  walk(root, null, prefix || root.name, 0);
  return map;
}

// ─── Node matching ────────────────────────────────────────────

function matchKey(node: INode, depth: number): string {
  return `${node.name}:${node.type}:${depth}`;
}

function buildMatches(
  mapA: Map<string, FlatNode>,
  mapB: Map<string, FlatNode>,
  strategy: 'id' | 'name-type' | 'both',
): Map<string, string> {
  const matches = new Map<string, string>(); // A.id → B.id
  const usedB = new Set<string>();

  // Phase 1: match by id
  if (strategy === 'id' || strategy === 'both') {
    for (const [id, _] of mapA) {
      if (mapB.has(id)) {
        matches.set(id, id);
        usedB.add(id);
      }
    }
  }

  // Phase 2: match by name+type heuristic
  if (strategy === 'name-type' || strategy === 'both') {
    const bByKey = new Map<string, FlatNode[]>();
    for (const [id, flat] of mapB) {
      if (usedB.has(id)) continue;
      const key = matchKey(flat.node, flat.depth);
      if (!bByKey.has(key)) bByKey.set(key, []);
      bByKey.get(key)!.push(flat);
    }

    for (const [idA, flatA] of mapA) {
      if (matches.has(idA)) continue;
      const key = matchKey(flatA.node, flatA.depth);
      const candidates = bByKey.get(key);
      if (candidates && candidates.length > 0) {
        const best = candidates.shift()!;
        matches.set(idA, best.node.id);
        usedB.add(best.node.id);
      }
    }
  }

  return matches;
}

// ─── Diff ─────────────────────────────────────────────────────

/** Compare two INode trees and return structural differences. */
export function diffTrees(a: INode, b: INode, options?: DiffOptions): DiffResult {
  const strategy = options?.matchStrategy ?? 'both';
  const ignoreSet = new Set(options?.ignoreProperties ?? []);

  const mapA = flattenTree(a);
  const mapB = flattenTree(b);
  const matches = buildMatches(mapA, mapB, strategy);

  const entries: DiffEntry[] = [];
  const matchedBIds = new Set(matches.values());

  // Removed: in A but not matched
  for (const [idA, flatA] of mapA) {
    if (!matches.has(idA)) {
      entries.push({
        type: 'removed',
        nodeId: idA,
        nodeName: flatA.node.name,
        nodeType: flatA.node.type,
        path: flatA.path,
      });
    }
  }

  // Added: in B but not matched
  for (const [idB, flatB] of mapB) {
    if (!matchedBIds.has(idB)) {
      entries.push({
        type: 'added',
        nodeId: idB,
        nodeName: flatB.node.name,
        nodeType: flatB.node.type,
        path: flatB.path,
      });
    }
  }

  // Modified / Moved: matched pairs
  for (const [idA, idB] of matches) {
    const flatA = mapA.get(idA)!;
    const flatB = mapB.get(idB)!;

    // Check if moved (parent changed)
    const moved = flatA.parentId !== null && flatB.parentId !== null && flatA.parentId !== flatB.parentId;

    // Compare properties
    const changes: PropertyChange[] = [];
    for (const prop of COMPARABLE_PROPS) {
      if (ignoreSet.has(prop)) continue;
      const va = (flatA.node as any)[prop];
      const vb = (flatB.node as any)[prop];
      if (!deepEqual(va, vb)) {
        changes.push({ property: prop, oldValue: va, newValue: vb });
      }
    }

    // Also compare name
    if (flatA.node.name !== flatB.node.name) {
      changes.push({ property: 'name', oldValue: flatA.node.name, newValue: flatB.node.name });
    }

    if (moved) {
      entries.push({
        type: 'moved',
        nodeId: idB,
        nodeName: flatB.node.name,
        nodeType: flatB.node.type,
        path: flatB.path,
        oldParentId: flatA.parentId!,
        newParentId: flatB.parentId!,
        changes: changes.length > 0 ? changes : undefined,
      });
    } else if (changes.length > 0) {
      entries.push({
        type: 'modified',
        nodeId: idB,
        nodeName: flatB.node.name,
        nodeType: flatB.node.type,
        path: flatB.path,
        changes,
      });
    }
  }

  const summary = { added: 0, removed: 0, modified: 0, moved: 0 };
  for (const e of entries) summary[e.type]++;

  return { entries, summary };
}

// ─── Formatting ───────────────────────────────────────────────

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return 'none';
  if (val === MIXED) return 'MIXED';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

/** Format a DiffResult as a human-readable string. */
export function formatDiff(result: DiffResult): string {
  if (result.entries.length === 0) return 'No differences found.';

  const lines: string[] = [];
  const { summary } = result;
  lines.push(`${summary.added} added, ${summary.removed} removed, ${summary.modified} modified, ${summary.moved} moved\n`);

  for (const e of result.entries) {
    switch (e.type) {
      case 'added':
        lines.push(`+ [${e.nodeType}] "${e.nodeName}"`);
        break;
      case 'removed':
        lines.push(`- [${e.nodeType}] "${e.nodeName}"`);
        break;
      case 'modified':
        lines.push(`~ [${e.nodeType}] "${e.nodeName}"`);
        for (const c of e.changes!) {
          lines.push(`    ${c.property}: ${formatValue(c.oldValue)} → ${formatValue(c.newValue)}`);
        }
        break;
      case 'moved':
        lines.push(`> [${e.nodeType}] "${e.nodeName}" (moved)`);
        if (e.changes) {
          for (const c of e.changes) {
            lines.push(`    ${c.property}: ${formatValue(c.oldValue)} → ${formatValue(c.newValue)}`);
          }
        }
        break;
    }
  }

  return lines.join('\n');
}
