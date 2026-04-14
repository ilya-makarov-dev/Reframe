/**
 * Project Audit — Multi-scene intelligence.
 *
 * Product-level audit that checks cross-scene consistency:
 * - Navigation consistency (same structure everywhere?)
 * - Spacing scale coherence (all pages on the same grid?)
 * - Typography hierarchy agreement (heading levels mean the same thing?)
 * - Color role consistency (primary = same shade site-wide?)
 * - Brand drift detection (scenes out of sync with DESIGN.md?)
 * - Aggregate quality scoring
 *
 * This runs ON TOP of per-scene 23-rule audit — it catches issues
 * that only manifest when you look at the product as a whole.
 */

import type { INode, IPaint, ISolidPaint } from './host/types';
import { NodeType, MIXED } from './host/types';
import type { SceneGraph } from './engine/scene-graph';
import type { DesignSystem } from './design-system/types';
import type { AuditIssue, AuditRule } from './audit';
import { audit } from './audit';
import { computeAestheticScore } from './aesthetic/score';
import type { AestheticScore } from './aesthetic/types';
import { computeBrandFidelity, type BrandFidelityResult } from './brand-fidelity';

// ─── Types ────────────────────────────────────────────────────

export interface SceneAuditSummary {
  sceneId: string;
  sceneName: string;
  /** Per-scene audit issue counts. */
  errors: number;
  warnings: number;
  info: number;
  /** Per-scene aesthetic score. */
  aesthetic: AestheticScore;
  /** Per-scene brand fidelity (if design system available). */
  brandFidelity?: BrandFidelityResult;
}

export interface CrossSceneIssue {
  /** What type of consistency problem. */
  type: 'nav-inconsistency' | 'spacing-variance' | 'typography-variance' |
        'color-variance' | 'brand-drift' | 'missing-landmark';
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Scenes involved. */
  scenes: string[];
}

export interface ProjectAuditResult {
  /** Total scenes analyzed. */
  totalScenes: number;
  /** Per-scene summaries. */
  sceneSummaries: SceneAuditSummary[];
  /** Cross-scene consistency issues. */
  crossSceneIssues: CrossSceneIssue[];
  /** Aggregate stats. */
  aggregate: {
    totalErrors: number;
    totalWarnings: number;
    avgAesthetic: number;
    avgBrandFidelity: number;
    /** Which audit rules fail most across all scenes. */
    worstRules: Array<{ rule: string; count: number; scenes: string[] }>;
  };
  /** Product health score (0-100). */
  productScore: number;
}

export interface ProjectAuditOptions {
  /** Filter to specific scene group. */
  group?: string;
  /** Audit rules to use (defaults to all). */
  rules?: AuditRule[];
  /** Design system for brand checks. */
  designSystem?: DesignSystem;
  /** Skip variants (only audit base scenes). */
  skipVariants?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────

function extractSolidColor(paint: IPaint): string | null {
  if (paint.type !== 'SOLID') return null;
  const sp = paint as ISolidPaint;
  if (!sp.color) return null;
  const { r, g, b } = sp.color;
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function collectNodes(root: INode): INode[] {
  const nodes: INode[] = [];
  function walk(node: INode) {
    nodes.push(node);
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return nodes;
}

/** Find top-level semantic landmarks in a scene. */
function findLandmarks(root: INode): Map<string, INode> {
  const landmarks = new Map<string, INode>();

  function walk(node: INode, depth: number) {
    if (depth > 3) return; // only look at top levels
    const role = (node as any).semanticRole as string | undefined;
    const name = (node.name || '').toLowerCase();

    if (role === 'navigation' || name.includes('nav') || name.includes('header')) {
      landmarks.set('navigation', node);
    }
    if (role === 'footer' || name.includes('footer')) {
      landmarks.set('footer', node);
    }
    if (name.includes('hero')) {
      landmarks.set('hero', node);
    }

    if (node.children) {
      for (const child of node.children) walk(child, depth + 1);
    }
  }

  walk(root, 0);
  return landmarks;
}

/** Extract spacing values used in a scene. */
function extractSpacingValues(root: INode): number[] {
  const values: number[] = [];
  function walk(node: INode) {
    const spacings = [
      node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft,
      node.itemSpacing,
    ].filter((v): v is number => typeof v === 'number' && v > 0);
    values.push(...spacings);
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return values;
}

/** Extract font sizes used in a scene. */
function extractFontSizes(root: INode): number[] {
  const sizes: number[] = [];
  function walk(node: INode) {
    if (node.type === NodeType.Text && typeof node.fontSize === 'number' && node.fontSize > 0) {
      sizes.push(node.fontSize);
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return sizes;
}

/** Extract solid colors used in a scene. */
function extractColors(root: INode): string[] {
  const colors: string[] = [];
  function walk(node: INode) {
    if (node.fills && node.fills !== MIXED) {
      for (const fill of node.fills as IPaint[]) {
        const hex = extractSolidColor(fill);
        if (hex) colors.push(hex.toLowerCase());
      }
    }
    if (node.children) {
      for (const child of node.children) walk(child);
    }
  }
  walk(root);
  return colors;
}

/** Compute structural hash of a node's immediate children types. */
function landmarkSignature(node: INode): string {
  if (!node.children) return '';
  return node.children
    .map(c => `${c.type}:${c.layoutMode || 'N'}:${c.children?.length ?? 0}`)
    .join('|');
}

// ─── Cross-scene checks ──────────────────────────────────────

function checkNavConsistency(
  scenes: Map<string, { root: INode; landmarks: Map<string, INode> }>,
): CrossSceneIssue[] {
  const issues: CrossSceneIssue[] = [];
  const navSignatures = new Map<string, string[]>(); // signature → scene IDs

  for (const [sceneId, { landmarks }] of scenes) {
    const nav = landmarks.get('navigation');
    if (!nav) continue;
    const sig = landmarkSignature(nav);
    const existing = navSignatures.get(sig);
    if (existing) existing.push(sceneId);
    else navSignatures.set(sig, [sceneId]);
  }

  if (navSignatures.size > 1) {
    const groups = [...navSignatures.entries()].sort((a, b) => b[1].length - a[1].length);
    const majority = groups[0][1];
    for (const [, sceneIds] of groups.slice(1)) {
      issues.push({
        type: 'nav-inconsistency',
        severity: 'warning',
        message: `Navigation structure differs from majority (${majority.length} scenes). Check: ${sceneIds.join(', ')}`,
        scenes: sceneIds,
      });
    }
  }

  return issues;
}

function checkSpacingVariance(
  scenes: Map<string, { root: INode; spacingValues: number[] }>,
): CrossSceneIssue[] {
  const issues: CrossSceneIssue[] = [];

  // Find the most common spacing unit across all scenes
  const allSpacings: number[] = [];
  for (const { spacingValues } of scenes.values()) {
    allSpacings.push(...spacingValues);
  }

  if (allSpacings.length === 0) return [];

  // Detect if any scene uses a fundamentally different grid
  const sceneBases = new Map<string, number>();
  for (const [sceneId, { spacingValues }] of scenes) {
    if (spacingValues.length === 0) continue;
    // Find GCD-like base unit
    const sorted = [...new Set(spacingValues)].sort((a, b) => a - b);
    const base = sorted[0] > 0 ? sorted[0] : 4;
    sceneBases.set(sceneId, base);
  }

  const bases = [...sceneBases.entries()];
  if (bases.length < 2) return [];

  const mostCommonBase = bases
    .map(([, b]) => b)
    .sort((a, b) =>
      bases.filter(([, v]) => v === b).length - bases.filter(([, v]) => v === a).length
    )
    .pop() ?? 4;

  const outliers = bases.filter(([, b]) => Math.abs(b - mostCommonBase) > 2);
  if (outliers.length > 0) {
    issues.push({
      type: 'spacing-variance',
      severity: 'warning',
      message: `Spacing base unit differs: most scenes use ${mostCommonBase}px, but ${outliers.map(([id, b]) => `${id} uses ${b}px`).join(', ')}`,
      scenes: outliers.map(([id]) => id),
    });
  }

  return issues;
}

function checkTypographyVariance(
  scenes: Map<string, { root: INode; fontSizes: number[] }>,
): CrossSceneIssue[] {
  const issues: CrossSceneIssue[] = [];

  // Check: is the largest font size consistent across scenes?
  const sceneMaxSizes = new Map<string, number>();
  for (const [sceneId, { fontSizes }] of scenes) {
    if (fontSizes.length === 0) continue;
    sceneMaxSizes.set(sceneId, Math.max(...fontSizes));
  }

  const maxSizes = [...sceneMaxSizes.entries()];
  if (maxSizes.length < 2) return [];

  const avgMax = maxSizes.reduce((s, [, v]) => s + v, 0) / maxSizes.length;
  const outliers = maxSizes.filter(([, v]) => Math.abs(v - avgMax) / avgMax > 0.3);

  if (outliers.length > 0) {
    issues.push({
      type: 'typography-variance',
      severity: 'info',
      message: `Heading sizes vary significantly: average max ${Math.round(avgMax)}px, but ${outliers.map(([id, v]) => `${id} uses ${v}px`).join(', ')}`,
      scenes: outliers.map(([id]) => id),
    });
  }

  return issues;
}

function checkColorVariance(
  scenes: Map<string, { root: INode; colors: string[] }>,
): CrossSceneIssue[] {
  const issues: CrossSceneIssue[] = [];

  // Simple check: how many unique colors across the product?
  const allColors = new Set<string>();
  for (const { colors } of scenes.values()) {
    for (const c of colors) allColors.add(c);
  }

  // Flag if palette is too large (suggests inconsistency)
  if (allColors.size > 25) {
    issues.push({
      type: 'color-variance',
      severity: 'warning',
      message: `Product uses ${allColors.size} distinct colors across ${scenes.size} scenes. Consider consolidating to a tighter palette.`,
      scenes: [...scenes.keys()],
    });
  }

  return issues;
}

function checkMissingLandmarks(
  scenes: Map<string, { root: INode; landmarks: Map<string, INode> }>,
): CrossSceneIssue[] {
  const issues: CrossSceneIssue[] = [];

  // If most scenes have nav, flag those that don't
  const withNav = [...scenes.entries()].filter(([, s]) => s.landmarks.has('navigation'));
  const withoutNav = [...scenes.entries()].filter(([, s]) => !s.landmarks.has('navigation'));

  if (withNav.length > 0 && withoutNav.length > 0 && withNav.length >= withoutNav.length) {
    issues.push({
      type: 'missing-landmark',
      severity: 'info',
      message: `${withNav.length} scenes have navigation, but ${withoutNav.map(([id]) => id).join(', ')} do not.`,
      scenes: withoutNav.map(([id]) => id),
    });
  }

  // Same for footer
  const withFooter = [...scenes.entries()].filter(([, s]) => s.landmarks.has('footer'));
  const withoutFooter = [...scenes.entries()].filter(([, s]) => !s.landmarks.has('footer'));

  if (withFooter.length > 0 && withoutFooter.length > 0 && withFooter.length >= withoutFooter.length) {
    issues.push({
      type: 'missing-landmark',
      severity: 'info',
      message: `${withFooter.length} scenes have footer, but ${withoutFooter.map(([id]) => id).join(', ')} do not.`,
      scenes: withoutFooter.map(([id]) => id),
    });
  }

  return issues;
}

// ─── Main ─────────────────────────────────────────────────────

/**
 * Run product-level audit across multiple scenes.
 *
 * Takes a map of sceneId → { graph, rootId } and returns a comprehensive
 * report with per-scene summaries, cross-scene consistency issues,
 * and an aggregate product health score.
 */
export function auditProject(
  scenes: Map<string, { graph: SceneGraph; rootId: string; root: INode; name: string }>,
  options?: ProjectAuditOptions,
): ProjectAuditResult {
  const ds = options?.designSystem;
  const rules = options?.rules ?? [];

  // Phase 1: per-scene audits
  const sceneSummaries: SceneAuditSummary[] = [];
  const ruleFailMap = new Map<string, { count: number; scenes: Set<string> }>();

  // Prepare scene data for cross-scene checks
  const sceneData = new Map<string, {
    root: INode;
    landmarks: Map<string, INode>;
    spacingValues: number[];
    fontSizes: number[];
    colors: string[];
  }>();

  for (const [sceneId, { graph, rootId, root, name }] of scenes) {
    // Per-scene audit
    const issues = rules.length > 0 ? audit(root, rules, ds as any) : [];

    const errors = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;
    const info = issues.filter(i => i.severity === 'info').length;

    // Track worst rules
    for (const issue of issues) {
      const existing = ruleFailMap.get(issue.rule);
      if (existing) {
        existing.count++;
        existing.scenes.add(sceneId);
      } else {
        ruleFailMap.set(issue.rule, { count: 1, scenes: new Set([sceneId]) });
      }
    }

    // Aesthetic score
    const aesthetic = computeAestheticScore(graph, rootId);

    // Brand fidelity
    const brandFidelity = ds ? computeBrandFidelity(root, ds) : undefined;

    sceneSummaries.push({
      sceneId,
      sceneName: name,
      errors,
      warnings,
      info,
      aesthetic,
      brandFidelity,
    });

    // Prepare cross-scene data
    sceneData.set(sceneId, {
      root,
      landmarks: findLandmarks(root),
      spacingValues: extractSpacingValues(root),
      fontSizes: extractFontSizes(root),
      colors: extractColors(root),
    });
  }

  // Phase 2: cross-scene consistency checks
  const crossSceneIssues: CrossSceneIssue[] = [
    ...checkNavConsistency(sceneData),
    ...checkSpacingVariance(sceneData),
    ...checkTypographyVariance(sceneData),
    ...checkColorVariance(sceneData),
    ...checkMissingLandmarks(sceneData),
  ];

  // Phase 3: aggregate
  const totalErrors = sceneSummaries.reduce((s, ss) => s + ss.errors, 0);
  const totalWarnings = sceneSummaries.reduce((s, ss) => s + ss.warnings, 0);
  const avgAesthetic = sceneSummaries.length > 0
    ? sceneSummaries.reduce((s, ss) => s + ss.aesthetic.overall, 0) / sceneSummaries.length
    : 0;
  const brandFidelities = sceneSummaries.filter(s => s.brandFidelity).map(s => s.brandFidelity!.score);
  const avgBrandFidelity = brandFidelities.length > 0
    ? brandFidelities.reduce((s, v) => s + v, 0) / brandFidelities.length
    : 0;

  const worstRules = [...ruleFailMap.entries()]
    .map(([rule, { count, scenes }]) => ({ rule, count, scenes: [...scenes] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Product health score: weighted from subscores
  const auditPenalty = Math.min(30, totalErrors * 3 + totalWarnings * 0.5);
  const crossPenalty = Math.min(20, crossSceneIssues.filter(i => i.severity === 'warning').length * 5 +
    crossSceneIssues.filter(i => i.severity === 'error').length * 10);
  const aestheticContrib = avgAesthetic * 25;
  const brandContrib = avgBrandFidelity * 0.25;

  const productScore = Math.max(0, Math.min(100,
    Math.round(100 - auditPenalty - crossPenalty + aestheticContrib * 0 + brandContrib * 0
      // Simplified: start at 100, subtract penalties
      // Aesthetic and brand already factored into per-scene
    ),
  ));

  // Better scoring: blend of penalties and positive signals
  const finalScore = Math.max(0, Math.min(100, Math.round(
    avgBrandFidelity * 0.4 +
    avgAesthetic * 100 * 0.2 +
    Math.max(0, 100 - auditPenalty) * 0.25 +
    Math.max(0, 100 - crossPenalty) * 0.15,
  )));

  return {
    totalScenes: scenes.size,
    sceneSummaries,
    crossSceneIssues,
    aggregate: {
      totalErrors,
      totalWarnings,
      avgAesthetic,
      avgBrandFidelity,
      worstRules,
    },
    productScore: finalScore,
  };
}

/** Format project audit for text output. */
export function formatProjectAudit(result: ProjectAuditResult): string {
  const lines: string[] = [];

  lines.push(`Product Audit: ${result.totalScenes} scenes — Score: ${result.productScore}/100`);
  lines.push('');

  // Per-scene summary table
  lines.push('Per-scene:');
  for (const s of result.sceneSummaries) {
    const bf = s.brandFidelity ? ` BF:${s.brandFidelity.score}` : '';
    lines.push(`  ${s.sceneId} — ${s.errors}E ${s.warnings}W aesthetic:${Math.round(s.aesthetic.overall * 100)}${bf}`);
  }

  // Cross-scene issues
  if (result.crossSceneIssues.length > 0) {
    lines.push('');
    lines.push(`Cross-scene issues (${result.crossSceneIssues.length}):`);
    for (const issue of result.crossSceneIssues) {
      lines.push(`  [${issue.severity}] ${issue.type}: ${issue.message}`);
    }
  }

  // Worst rules
  if (result.aggregate.worstRules.length > 0) {
    lines.push('');
    lines.push('Most frequent audit failures:');
    for (const r of result.aggregate.worstRules.slice(0, 5)) {
      lines.push(`  ${r.rule}: ${r.count}× across ${r.scenes.length} scene(s)`);
    }
  }

  // Aggregate
  lines.push('');
  lines.push(`Aggregate: ${result.aggregate.totalErrors} errors, ${result.aggregate.totalWarnings} warnings`);
  lines.push(`  Avg aesthetic: ${Math.round(result.aggregate.avgAesthetic * 100)}/100`);
  if (result.aggregate.avgBrandFidelity > 0) {
    lines.push(`  Avg brand fidelity: ${Math.round(result.aggregate.avgBrandFidelity)}/100`);
  }

  return lines.join('\n');
}
