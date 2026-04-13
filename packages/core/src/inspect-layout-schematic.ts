/**
 * Layout inspector — compact, agent-readable spatial view of a scene.
 *
 * `reframe_inspect` is a hot tool (runs after every edit), so the default
 * output must fit in ≲15 lines and only surface actionable signal. Three
 * levels:
 *
 *   summary (default) — one line per top-level section + one line per
 *                       spatial-issue cluster. ~8–15 lines, <0.5 KB.
 *                       Healthy scenes collapse to a section strip only.
 *
 *   focus              — broken subtrees only, with inline annotations
 *                       like `← 40w, expected ~1280 (-1240px)` on nodes
 *                       that trigger layout issues. Healthy branches
 *                       are replaced with `… N children OK`.
 *                       Typical 20–40 lines.
 *
 *   full               — the entire tree with every child listed, for
 *                       when the agent explicitly asks for it. Expensive.
 *
 *   off                — skip schematic entirely.
 *
 * The schematic is not a render — it answers "is the tree laid out
 * correctly?" not "does it look pretty?". It works together with the
 * `content-overflow` / `sibling-overlap` audit rules by clustering
 * their issues per top-level section so the agent sees one root cause
 * instead of a flood of symptoms.
 */

import type { SceneGraph } from './engine/scene-graph';
import type { SceneNode } from './engine/types';
import type { AuditIssue } from './audit';

// ─── Config ──────────────────────────────────────────────────────

export type LayoutMode = 'summary' | 'focus' | 'full' | 'off';

export interface LayoutSchematicOptions {
  mode?: LayoutMode;
  /** Maximum lines before truncating (safety cap). */
  maxLines?: number;
}

// Spatial audit rules that feed the layout view.
const SPATIAL_RULES = new Set([
  'content-overflow',
  'container-underflow',
  'sibling-overlap',
  'text-overflow',
  'node-overflow',
  'no-zero-size',
]);

// ─── Helpers ─────────────────────────────────────────────────────

function fmt(n: number | undefined): string {
  return n == null ? '?' : String(Math.round(n));
}

function dims(node: SceneNode): string {
  return `${fmt(node.width)}×${fmt(node.height)}`;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '…';
}

function layoutLabel(node: SceneNode): string {
  const m = (node as any).layoutMode as string | undefined;
  if (m === 'HORIZONTAL') return 'row';
  if (m === 'VERTICAL') return 'col';
  if (m === 'GRID') return 'grid';
  return 'box';
}

// ─── Expected width inference ───────────────────────────────────

/**
 * Infer the width a container "should" have by walking up to the nearest
 * ancestor whose width is resolved (>100 px) and subtracting its padding +
 * estimated gap share. Returns undefined if no resolved ancestor is found.
 * Used to annotate broken nodes with `← 40w, expected ~1280 (-1240px)`.
 */
function inferExpectedWidth(
  graph: SceneGraph,
  nodeId: string,
): number | undefined {
  let current: string | undefined = graph.getNode(nodeId)?.parentId ?? undefined;
  while (current) {
    const p = graph.getNode(current);
    if (!p) break;
    const pw = p.width ?? 0;
    if (pw > 100) {
      const pl = (p as any).paddingLeft ?? 0;
      const pr = (p as any).paddingRight ?? 0;
      const innerW = Math.max(0, pw - pl - pr);
      if ((p as any).layoutMode === 'HORIZONTAL') {
        const sibCount = p.childIds.length || 1;
        const gap = (p as any).itemSpacing ?? 0;
        const gapTotal = gap * Math.max(0, sibCount - 1);
        return Math.max(0, Math.floor((innerW - gapTotal) / sibCount));
      }
      return innerW;
    }
    current = p.parentId ?? undefined;
  }
  return undefined;
}

// ─── Issue clustering ────────────────────────────────────────────

/** Top-level section that this node ultimately belongs to (root's direct child). */
function topSectionId(graph: SceneGraph, nodeId: string, rootId: string): string | undefined {
  let current: string | undefined = nodeId;
  let lastUnderRoot: string | undefined;
  while (current) {
    const n = graph.getNode(current);
    if (!n) break;
    if (n.parentId === rootId) return current;
    lastUnderRoot = current;
    current = n.parentId ?? undefined;
  }
  return lastUnderRoot;
}

interface IssueCluster {
  sectionId: string | undefined;
  errors: number;
  warnings: number;
  infos: number;
  /** Representative headline describing the root cause. */
  headline: string;
}

function clusterSpatialIssues(
  graph: SceneGraph,
  rootId: string,
  issues: AuditIssue[],
): IssueCluster[] {
  const spatial = issues.filter(i => SPATIAL_RULES.has(i.rule));
  if (spatial.length === 0) return [];

  // Group by top-level section
  const bySection = new Map<string, AuditIssue[]>();
  for (const issue of spatial) {
    const sec = issue.nodeId ? topSectionId(graph, issue.nodeId, rootId) : undefined;
    const key = sec ?? '__root__';
    const arr = bySection.get(key) ?? [];
    arr.push(issue);
    bySection.set(key, arr);
  }

  const clusters: IssueCluster[] = [];
  for (const [sectionId, sectionIssues] of bySection) {
    const errors = sectionIssues.filter(i => i.severity === 'error').length;
    const warnings = sectionIssues.filter(i => i.severity === 'warning').length;
    const infos = sectionIssues.filter(i => i.severity === 'info').length;

    // Prefer error → warning → info as the representative
    const repr = sectionIssues.find(i => i.severity === 'error')
      ?? sectionIssues.find(i => i.severity === 'warning')
      ?? sectionIssues[0];

    // Try to infer a root cause: if several content-overflow issues point at
    // descendants of the same narrow wrapper, name that wrapper.
    let headline = repr.message;
    const overflowIssues = sectionIssues.filter(i => i.rule === 'content-overflow');
    if (overflowIssues.length >= 2) {
      headline = `${overflowIssues.length} content overflows — likely narrow wrapper; run layout:"focus" for details`;
    } else if (sectionIssues.length > 3) {
      headline = `${sectionIssues.length} spatial issues (${repr.rule}: ${truncate(repr.message, 60)})`;
    } else {
      headline = `${repr.rule}: ${truncate(repr.message, 90)}`;
    }

    clusters.push({
      sectionId: sectionId === '__root__' ? undefined : sectionId,
      errors, warnings, infos,
      headline,
    });
  }

  // Sort: most severe first
  clusters.sort((a, b) => (b.errors - a.errors) || (b.warnings - a.warnings));
  return clusters;
}

// ─── Summary mode ────────────────────────────────────────────────

function renderSummary(
  graph: SceneGraph,
  rootId: string,
  issues: AuditIssue[],
): string[] {
  const root = graph.getNode(rootId);
  if (!root) return [];
  const sections = graph.getChildren(rootId);
  const clusters = clusterSpatialIssues(graph, rootId, issues);

  // Map section id → cluster for quick lookup
  const clusterBySection = new Map<string, IssueCluster>();
  for (const c of clusters) if (c.sectionId) clusterBySection.set(c.sectionId, c);

  const out: string[] = [];
  out.push(`Layout: ${fmt(root.width)}×${fmt(root.height)}, ${sections.length} section${sections.length === 1 ? '' : 's'}`);

  // Section strip — one line each
  for (const s of sections) {
    const y = String(Math.round(s.y ?? 0)).padStart(5);
    const size = `${fmt(s.width)}×${fmt(s.height)}`.padEnd(10);
    const name = truncate(s.name ?? s.id, 22).padEnd(23);
    const mode = (s as any).layoutMode as string | undefined;
    const modeTag = mode && mode !== 'NONE'
      ? `${layoutLabel(s)}·${s.childIds.length}`
      : `${s.childIds.length}ch`;
    const cluster = clusterBySection.get(s.id);
    const marker = cluster
      ? (cluster.errors > 0 ? '❌' : '⚠ ')
      : '✅';
    out.push(`  ${marker} [${y}] ${size} ${name} ${modeTag}`);
  }

  // Cluster summaries — only for sections with issues
  if (clusters.length > 0) {
    out.push('');
    out.push(`Spatial: ${clusters.length} cluster${clusters.length === 1 ? '' : 's'} with issues`);
    for (const c of clusters) {
      const secNode = c.sectionId ? graph.getNode(c.sectionId) : undefined;
      const secName = secNode ? truncate(secNode.name ?? '', 24) : 'root';
      const tag = c.errors > 0 ? '❌' : '⚠ ';
      const counts = [
        c.errors > 0 ? `${c.errors}E` : '',
        c.warnings > 0 ? `${c.warnings}W` : '',
        c.infos > 0 ? `${c.infos}I` : '',
      ].filter(Boolean).join('/');
      out.push(`  ${tag} ${secName.padEnd(24)} ${counts.padEnd(8)} ${c.headline}`);
    }
    out.push('');
    out.push('→ reframe_inspect({ sceneId, layout: "focus" }) for broken-subtree detail');
  } else {
    out.push('');
    out.push('✅ No spatial issues');
  }

  return out;
}

// ─── Focus mode ──────────────────────────────────────────────────

function hasDescendantIssue(
  graph: SceneGraph,
  nodeId: string,
  issueNodeIds: Set<string>,
): boolean {
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (issueNodeIds.has(id)) return true;
    for (const cid of graph.getNode(id)?.childIds ?? []) stack.push(cid);
  }
  return false;
}

function renderFocusSubtree(
  graph: SceneGraph,
  nodeId: string,
  issueNodeIds: Set<string>,
  indent: string,
  isLast: boolean,
  out: string[],
  depth = 0,
): void {
  if (depth > 6) {
    out.push(`${indent}…`);
    return;
  }
  const node = graph.getNode(nodeId);
  if (!node) return;

  const branch = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');
  const marker = issueNodeIds.has(nodeId) ? '❌' : '  ';

  // Inline annotation for broken nodes: compute expected width and diff.
  let annotation = '';
  if (issueNodeIds.has(nodeId)) {
    const expected = inferExpectedWidth(graph, nodeId);
    const actual = node.width ?? 0;
    if (expected !== undefined && expected > actual + 8) {
      const diff = expected - actual;
      annotation = `  ← ${Math.round(actual)}w, expected ~${expected} (-${Math.round(diff)}px)`;
    }
  }

  const label = node.type === 'TEXT'
    ? `${dims(node)} "${truncate((node as any).characters ?? '', 28)}"`
    : `${dims(node)} ${truncate(node.name ?? node.id, 26)}`;

  out.push(`${indent}${branch}${marker} ${label}${annotation}`);

  // Collapse healthy children into a summary line
  const children = graph.getChildren(nodeId);
  const brokenChildren = children.filter(c => issueNodeIds.has(c.id) || hasDescendantIssue(graph, c.id, issueNodeIds));
  const healthyCount = children.length - brokenChildren.length;

  const childIndent = indent + (depth === 0 ? '' : (isLast ? '   ' : '│  '));

  // Show broken children in full
  for (let i = 0; i < brokenChildren.length; i++) {
    const c = brokenChildren[i];
    const last = i === brokenChildren.length - 1 && healthyCount === 0;
    renderFocusSubtree(graph, c.id, issueNodeIds, childIndent, last, out, depth + 1);
  }
  // Collapse healthy into one line
  if (healthyCount > 0) {
    out.push(`${childIndent}└─ … ${healthyCount} children OK`);
  }
}

function renderFocus(
  graph: SceneGraph,
  rootId: string,
  issues: AuditIssue[],
): string[] {
  const spatial = issues.filter(i => SPATIAL_RULES.has(i.rule));
  if (spatial.length === 0) {
    return ['✅ No spatial issues'];
  }

  const issueNodeIds = new Set<string>();
  for (const i of spatial) if (i.nodeId) issueNodeIds.add(i.nodeId);

  // Find top-level sections that contain at least one issue
  const root = graph.getNode(rootId);
  if (!root) return [];
  const sections = graph.getChildren(rootId);
  const broken = sections.filter(s => issueNodeIds.has(s.id) || hasDescendantIssue(graph, s.id, issueNodeIds));

  const out: string[] = [];
  out.push(`Layout focus: ${broken.length}/${sections.length} sections broken, ${spatial.length} issue${spatial.length === 1 ? '' : 's'}`);

  for (const s of broken) {
    out.push('');
    renderFocusSubtree(graph, s.id, issueNodeIds, '', true, out);
  }

  // Compact issue list at the bottom — grouped, not per-node
  out.push('');
  out.push('Issues:');
  const byRule = new Map<string, AuditIssue[]>();
  for (const i of spatial) {
    const arr = byRule.get(i.rule) ?? [];
    arr.push(i);
    byRule.set(i.rule, arr);
  }
  for (const [rule, arr] of byRule) {
    const errors = arr.filter(i => i.severity === 'error').length;
    const warns = arr.filter(i => i.severity === 'warning').length;
    const firstMsg = truncate(arr[0].message, 80);
    out.push(`  ${rule} ×${arr.length} (${errors}E/${warns}W): ${firstMsg}`);
  }

  return out;
}

// ─── Full mode (opt-in only, expensive) ─────────────────────────

function renderFull(
  graph: SceneGraph,
  rootId: string,
  issues: AuditIssue[],
): string[] {
  const issueNodeIds = new Set<string>();
  for (const i of issues.filter(x => SPATIAL_RULES.has(x.rule))) {
    if (i.nodeId) issueNodeIds.add(i.nodeId);
  }

  const out: string[] = [];
  const root = graph.getNode(rootId);
  if (!root) return out;
  out.push(`Full layout: ${fmt(root.width)}×${fmt(root.height)}`);
  walkFull(graph, rootId, issueNodeIds, '', true, out, 0);
  return out;
}

function walkFull(
  graph: SceneGraph,
  nodeId: string,
  issueNodeIds: Set<string>,
  indent: string,
  isLast: boolean,
  out: string[],
  depth: number,
): void {
  if (depth > 10) { out.push(`${indent}…`); return; }
  const n = graph.getNode(nodeId);
  if (!n) return;
  const branch = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');
  const marker = issueNodeIds.has(nodeId) ? '❌' : '  ';
  const label = n.type === 'TEXT'
    ? `${dims(n)} "${truncate((n as any).characters ?? '', 24)}"`
    : `${dims(n)} ${truncate(n.name ?? n.id, 22)}`;
  out.push(`${indent}${branch}${marker} ${label}`);
  const children = graph.getChildren(nodeId);
  const childIndent = indent + (depth === 0 ? '' : (isLast ? '   ' : '│  '));
  for (let i = 0; i < children.length; i++) {
    walkFull(graph, children[i].id, issueNodeIds, childIndent, i === children.length - 1, out, depth + 1);
  }
}

// ─── Public API ──────────────────────────────────────────────────

export function buildLayoutSchematic(
  graph: SceneGraph,
  rootId: string,
  issues: AuditIssue[] = [],
  options: LayoutSchematicOptions = {},
): string {
  const mode: LayoutMode = options.mode ?? 'summary';
  if (mode === 'off') return '';

  const maxLines = options.maxLines ?? (mode === 'full' ? 400 : mode === 'focus' ? 80 : 20);

  let lines: string[];
  if (mode === 'summary') lines = renderSummary(graph, rootId, issues);
  else if (mode === 'focus') lines = renderFocus(graph, rootId, issues);
  else lines = renderFull(graph, rootId, issues);

  if (lines.length > maxLines) {
    const trimmed = lines.slice(0, maxLines - 1);
    trimmed.push(`… (${lines.length - maxLines + 1} lines truncated; use layout:"full" to see all)`);
    lines = trimmed;
  }

  return lines.join('\n');
}
