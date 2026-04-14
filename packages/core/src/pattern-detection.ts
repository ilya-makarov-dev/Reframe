/**
 * Pattern Detection — Emergent Design System.
 *
 * Scans multiple scenes, finds repeated subtree structures, extracts
 * component candidates with inferred props. Discovers a design system
 * from practice — the engine doesn't just apply brands, it extracts them.
 *
 * Algorithm:
 * 1. Walk each scene tree, hash subtree structures (ignoring content/colors)
 * 2. Group structurally identical subtrees across scenes
 * 3. Rank by frequency (N+ occurrences = component candidate)
 * 4. Infer props from differences between instances
 * 5. Return candidates for review
 */

import type { INode, IPaint, ISolidPaint } from './host/types';
import { NodeType, MIXED } from './host/types';
import type { SceneGraph } from './engine/scene-graph';
import { StandaloneNode } from './adapters/standalone/node';

// ─── Types ────────────────────────────────────────────────────

export interface PatternInstance {
  /** Scene ID where this instance was found. */
  sceneId: string;
  /** Root node ID of this instance within the scene. */
  nodeId: string;
  /** Node name. */
  nodeName: string;
  /** Path from scene root. */
  path: string;
}

export interface InferredProp {
  /** Prop name (derived from what varies). */
  name: string;
  /** Property path that varies (e.g. 'text', 'fills[0].color'). */
  property: string;
  /** Distinct values across instances. */
  values: string[];
}

export interface PatternCandidate {
  /** Structural hash of this pattern. */
  hash: string;
  /** Suggested component name (from most common node name). */
  suggestedName: string;
  /** Number of child nodes in the pattern. */
  nodeCount: number;
  /** How many times this pattern appears. */
  frequency: number;
  /** Which scenes contain it. */
  scenes: string[];
  /** All instances. */
  instances: PatternInstance[];
  /** Inferred props (what differs between instances). */
  props: InferredProp[];
  /** Semantic role if detected. */
  semanticRole?: string;
  /** Confidence that this is a real component (0-1). */
  confidence: number;
}

export interface PatternDetectionResult {
  /** Total scenes analyzed. */
  scenesAnalyzed: number;
  /** Total subtrees hashed. */
  subtreesHashed: number;
  /** Component candidates (sorted by frequency). */
  candidates: PatternCandidate[];
}

export interface PatternDetectionOptions {
  /** Minimum occurrences to be a candidate (default: 2). */
  minOccurrences?: number;
  /** Minimum subtree depth to consider (default: 2). */
  minDepth?: number;
  /** Maximum candidates to return (default: 20). */
  maxCandidates?: number;
}

// ─── Structural hashing ───────────────────────────────────────

/**
 * Hash a subtree's structure — ignoring content (text, colors, images)
 * but preserving layout topology (node types, child counts, layout modes).
 */
function hashSubtreeStructure(node: INode): string {
  const parts: string[] = [];
  buildStructureSignature(node, parts, 0);
  return fnv1a(parts.join('|'));
}

function buildStructureSignature(node: INode, parts: string[], depth: number): void {
  // Type + layout mode + child count = structural identity
  const layoutMode = node.layoutMode || 'NONE';
  const childCount = node.children?.length ?? 0;

  parts.push(`${depth}:${node.type}:${layoutMode}:${childCount}`);

  // For text nodes, include approximate size range (not exact text)
  if (node.type === NodeType.Text && typeof node.fontSize === 'number') {
    const sizeRange = node.fontSize > 24 ? 'L' : node.fontSize > 14 ? 'M' : 'S';
    parts.push(`T:${sizeRange}`);
  }

  // Include corner radius presence (not exact value)
  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    parts.push('R');
  }

  // Recurse children in order
  if (node.children) {
    for (const child of node.children) {
      buildStructureSignature(child, parts, depth + 1);
    }
  }
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ─── Subtree depth ────────────────────────────────────────────

function subtreeDepth(node: INode): number {
  if (!node.children || node.children.length === 0) return 1;
  let max = 0;
  for (const child of node.children) {
    max = Math.max(max, subtreeDepth(child));
  }
  return max + 1;
}

function subtreeNodeCount(node: INode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += subtreeNodeCount(child);
    }
  }
  return count;
}

// ─── Collect subtrees from a scene ────────────────────────────

interface SubtreeEntry {
  node: INode;
  hash: string;
  depth: number;
  nodeCount: number;
  sceneId: string;
  path: string;
}

function collectSubtrees(
  root: INode,
  sceneId: string,
  minDepth: number,
): SubtreeEntry[] {
  const entries: SubtreeEntry[] = [];

  function walk(node: INode, path: string) {
    const depth = subtreeDepth(node);
    if (depth >= minDepth && node !== root) {
      entries.push({
        node,
        hash: hashSubtreeStructure(node),
        depth,
        nodeCount: subtreeNodeCount(node),
        sceneId,
        path,
      });
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child, `${path} > ${child.name}`);
      }
    }
  }

  walk(root, root.name);
  return entries;
}

// ─── Prop inference ───────────────────────────────────────────

function extractNodeValues(node: INode): Record<string, string> {
  const vals: Record<string, string> = {};

  // Text content (INode uses 'characters', not 'text')
  const chars = (node as any).characters as string | undefined;
  if (node.type === NodeType.Text && chars) {
    vals['text'] = chars.slice(0, 50);
  }

  // Primary fill color
  if (node.fills && node.fills !== MIXED) {
    const fills = node.fills as IPaint[];
    if (fills.length > 0 && fills[0].type === 'SOLID') {
      const sp = fills[0] as ISolidPaint;
      if (sp.color) {
        const { r, g, b } = sp.color;
        const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
        vals['fill'] = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      }
    }
  }

  // Font size
  if (node.type === NodeType.Text && typeof node.fontSize === 'number') {
    vals['fontSize'] = String(node.fontSize);
  }

  return vals;
}

function collectInstanceValues(node: INode, prefix: string = ''): Record<string, string> {
  const vals: Record<string, string> = {};
  const nodeVals = extractNodeValues(node);
  for (const [k, v] of Object.entries(nodeVals)) {
    vals[`${prefix}${k}`] = v;
  }
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      const childVals = collectInstanceValues(node.children[i], `child${i}.`);
      Object.assign(vals, childVals);
    }
  }
  return vals;
}

function inferProps(instances: INode[]): InferredProp[] {
  if (instances.length < 2) return [];

  // Collect values from all instances
  const allValues: Record<string, string>[] = instances.map(n => collectInstanceValues(n));

  // Find properties that vary
  const allKeys = new Set<string>();
  for (const vals of allValues) {
    for (const k of Object.keys(vals)) allKeys.add(k);
  }

  const props: InferredProp[] = [];
  for (const key of allKeys) {
    const values = allValues.map(v => v[key] ?? '').filter(v => v !== '');
    const unique = [...new Set(values)];
    if (unique.length > 1) {
      // This property varies across instances = it's a prop
      const propName = key
        .replace(/^child\d+\./, '')
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '');

      props.push({
        name: propName,
        property: key,
        values: unique.slice(0, 5), // cap at 5 examples
      });
    }
  }

  return props;
}

// ─── Semantic role detection ──────────────────────────────────

function detectSemanticFromStructure(node: INode): string | undefined {
  // Check explicit semantic role
  if ((node as any).semanticRole) return (node as any).semanticRole;

  const name = (node.name || '').toLowerCase();

  // Name-based heuristics
  if (name.includes('nav') || name.includes('header')) return 'navigation';
  if (name.includes('footer')) return 'footer';
  if (name.includes('card')) return 'card';
  if (name.includes('button') || name.includes('btn') || name.includes('cta')) return 'button';
  if (name.includes('hero')) return 'hero';
  if (name.includes('badge') || name.includes('tag') || name.includes('chip')) return 'badge';
  if (name.includes('input') || name.includes('field')) return 'input';

  return undefined;
}

// ─── Main ─────────────────────────────────────────────────────

/**
 * Detect repeated patterns across multiple scenes.
 *
 * Takes a map of sceneId → root INode. Returns component candidates
 * ranked by frequency.
 */
export function detectPatterns(
  scenes: Map<string, INode>,
  options?: PatternDetectionOptions,
): PatternDetectionResult {
  const minOccurrences = options?.minOccurrences ?? 2;
  const minDepth = options?.minDepth ?? 2;
  const maxCandidates = options?.maxCandidates ?? 20;

  // Phase 1: collect all subtrees from all scenes
  const allSubtrees: SubtreeEntry[] = [];
  for (const [sceneId, root] of scenes) {
    const entries = collectSubtrees(root, sceneId, minDepth);
    allSubtrees.push(...entries);
  }

  // Phase 2: group by structural hash
  const groups = new Map<string, SubtreeEntry[]>();
  for (const entry of allSubtrees) {
    const existing = groups.get(entry.hash);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(entry.hash, [entry]);
    }
  }

  // Phase 3: filter by frequency + cross-scene presence
  const candidates: PatternCandidate[] = [];
  for (const [hash, entries] of groups) {
    if (entries.length < minOccurrences) continue;

    const sceneSet = new Set(entries.map(e => e.sceneId));

    // Prefer patterns that appear in multiple scenes
    const crossSceneBonus = sceneSet.size > 1 ? 0.2 : 0;

    // Name voting: most common node name wins
    const nameCounts = new Map<string, number>();
    for (const e of entries) {
      const name = e.node.name || 'unnamed';
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    let bestName = 'component';
    let bestCount = 0;
    for (const [name, count] of nameCounts) {
      if (count > bestCount) { bestName = name; bestCount = count; }
    }

    // Infer props from first few instances
    const instanceNodes = entries.slice(0, 10).map(e => e.node);
    const props = inferProps(instanceNodes);

    // Semantic role
    const roles = entries.map(e => detectSemanticFromStructure(e.node)).filter(Boolean);
    const semanticRole = roles.length > 0
      ? roles.sort((a, b) => roles.filter(r => r === b).length - roles.filter(r => r === a).length)[0]
      : undefined;

    // Confidence = frequency + cross-scene + prop count
    const avgNodeCount = entries.reduce((s, e) => s + e.nodeCount, 0) / entries.length;
    const confidence = Math.min(1,
      0.3 * Math.min(1, entries.length / 5) +  // frequency
      0.3 * crossSceneBonus / 0.2 +             // cross-scene
      0.2 * Math.min(1, props.length / 3) +     // has meaningful props
      0.2 * Math.min(1, avgNodeCount / 5),      // non-trivial structure
    );

    candidates.push({
      hash,
      suggestedName: bestName,
      nodeCount: Math.round(avgNodeCount),
      frequency: entries.length,
      scenes: [...sceneSet],
      instances: entries.map(e => ({
        sceneId: e.sceneId,
        nodeId: e.node.id,
        nodeName: e.node.name,
        path: e.path,
      })),
      props,
      semanticRole,
      confidence,
    });
  }

  // Sort by frequency × confidence, take top N
  candidates.sort((a, b) => (b.frequency * b.confidence) - (a.frequency * a.confidence));
  const topCandidates = candidates.slice(0, maxCandidates);

  return {
    scenesAnalyzed: scenes.size,
    subtreesHashed: allSubtrees.length,
    candidates: topCandidates,
  };
}

/**
 * Convenience: detect patterns from SceneGraph objects.
 * Resolves root nodes from each graph.
 */
export function detectPatternsFromGraphs(
  graphs: Map<string, { graph: SceneGraph; rootId: string }>,
  options?: PatternDetectionOptions,
): PatternDetectionResult {
  const scenes = new Map<string, INode>();
  for (const [sceneId, { graph, rootId }] of graphs) {
    const rawRoot = graph.getNode(rootId);
    if (rawRoot) {
      scenes.set(sceneId, new StandaloneNode(graph, rawRoot) as unknown as INode);
    }
  }
  return detectPatterns(scenes, options);
}

/** Format pattern detection results for text output. */
export function formatPatternDetection(result: PatternDetectionResult): string {
  const lines: string[] = [];
  lines.push(`Pattern Detection: ${result.scenesAnalyzed} scenes, ${result.subtreesHashed} subtrees analyzed`);
  lines.push(`Found ${result.candidates.length} component candidates:\n`);

  for (const c of result.candidates) {
    const sceneList = c.scenes.length <= 3 ? c.scenes.join(', ') : `${c.scenes.slice(0, 3).join(', ')} +${c.scenes.length - 3}`;
    lines.push(`  "${c.suggestedName}" — ${c.frequency}× across ${c.scenes.length} scene(s) [${sceneList}]`);
    lines.push(`    ${c.nodeCount} nodes, confidence ${Math.round(c.confidence * 100)}%${c.semanticRole ? `, role: ${c.semanticRole}` : ''}`);
    if (c.props.length > 0) {
      const propNames = c.props.map(p => p.name).join(', ');
      lines.push(`    Props: ${propNames}`);
    }
  }

  return lines.join('\n');
}
