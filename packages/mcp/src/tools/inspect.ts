/**
 * reframe_inspect (v2) — Unified inspection tool.
 *
 * Merges: audit, assert, inspect, info, diff, preview into one tool.
 * Returns a composite report with only the sections the caller requests.
 */

import { z } from 'zod';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { runWithHostAsync } from '../../../core/src/host/context.js';
import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import { audit } from '../../../core/src/audit.js';
import { buildInspectAuditRules } from '../../../core/src/inspect-audit-rules.js';
import { assertDesign, formatAssertions } from '../../../core/src/assert.js';
import { diffTrees, formatDiff } from '../../../core/src/diff.js';
import { inspectScene, exportScene } from '../engine.js';
import { resolveScene, listScenes, getScene } from '../store.js';
import { getSession } from '../session.js';
import { VERSION } from '../version.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { classifyScene, readSemanticSkeleton, SEMANTIC_TO_BANNER } from '../../../core/src/semantic/index.js';
import { MCP_LIMITS } from '../limits.js';

// ─── Schema ────────────────────────────────────────────────────

export const inspectInputSchema = {
  sceneId: z.string().optional().describe('Scene ID to inspect. Omit for session overview.'),

  // What to include in the report
  tree: z.boolean().optional().default(true).describe('Include node tree'),
  audit: z.union([z.boolean(), z.object({
    minFontSize: z.number().optional().default(8),
    minContrast: z.number().optional().default(3),
  })]).optional().default(true).describe('Run audit (true = defaults)'),

  assert: z.array(z.object({
    type: z.enum(['minContrast', 'fitsWithin', 'noOverlapping', 'minFontSize',
      'noEmptyText', 'noZeroSize', 'noTextOverflow', 'minLineHeight']),
    value: z.any().optional(),
  })).optional().describe('Design assertions to run'),

  designMd: z.string().optional().describe('DESIGN.md for brand compliance checks'),

  // Diff mode
  diffWith: z.string().optional().describe('Scene ID to diff against (structural comparison)'),
  diffStructured: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'With diffWith: add a second MCP content block — JSON with kind reframe.structuralDiff, version, sceneA, sceneB, sceneNames, result (DiffResult)',
    ),
  diffStructuredDetail: z
    .enum(['full', 'summary'])
    .optional()
    .default('full')
    .describe(
      'When diffStructured is true: full = result.entries + result.summary; summary = result.summary only (smaller JSON)',
    ),
  diffTextDetail: z
    .enum(['full', 'summary'])
    .optional()
    .default('full')
    .describe(
      'When diffWith is set: summary = one-line counts in main text only; full = per-node diff lines (default)',
    ),

  treeMaxDepth: z
    .number()
    .int()
    .min(1)
    .max(256)
    .optional()
    .default(MCP_LIMITS.inspectTreeDefaultMaxDepth)
    .describe('Max depth of the ASCII node tree (deeper children summarized).'),

  treeMaxLines: z
    .number()
    .int()
    .min(50)
    .max(100_000)
    .optional()
    .default(MCP_LIMITS.inspectTreeDefaultMaxLines)
    .describe('Cap lines in the ASCII tree (truncates with a flag in stats line).'),
};

// ─── Handler ───────────────────────────────────────────────────

export async function handleInspect(input: {
  sceneId?: string;
  tree?: boolean;
  audit?: boolean | { minFontSize?: number; minContrast?: number };
  assert?: Array<{ type: string; value?: any }>;
  designMd?: string;
  diffWith?: string;
  diffStructured?: boolean;
  diffStructuredDetail?: 'full' | 'summary';
  diffTextDetail?: 'full' | 'summary';
  treeMaxDepth?: number;
  treeMaxLines?: number;
}) {
  const session = getSession();
  session.recordToolCall('inspect');

  // ── Session overview (no sceneId) ────────────────────────────

  if (!input.sceneId) {
    const scenes = listScenes();
    const lines: string[] = [];

    lines.push(`reframe v${VERSION}`);
    lines.push('');

    if (scenes.length === 0) {
      lines.push('No scenes in session.');
      lines.push('Create one with reframe_edit or import HTML with reframe_compile.');
    } else {
      lines.push(`Scenes (${scenes.length}):`);
      for (const s of scenes) {
        lines.push(`  ${s.id} [${s.slug}] "${s.name}" ${s.size} — ${s.nodes} nodes (${s.age} ago)`);
      }
    }

    // Session stats
    const stats = session.stats;
    const parts: string[] = [];
    if (stats.toolCallOrder.length > 0) parts.push(`${stats.toolCallOrder.length} tool calls`);
    if (stats.totalImports > 0) parts.push(`${stats.totalImports} imports`);
    if (stats.totalAudits > 0) parts.push(`${stats.totalAudits} audits`);
    if (stats.totalExports > 0) parts.push(`${stats.totalExports} exports`);
    if (stats.totalWorkflows > 0) parts.push(`${stats.totalWorkflows} workflows`);
    if (parts.length > 0) {
      lines.push('');
      lines.push(`Session: ${parts.join(', ')}`);
    }

    // Recommendations
    const summary = session.getSummary();
    if (summary) {
      const recIdx = summary.indexOf('Recommended next:');
      if (recIdx !== -1) {
        lines.push('');
        lines.push(summary.slice(recIdx));
      }
    }

    // ── Progressive context: design reference ──────────────────
    // This replaces the need for massive CLAUDE.md — agents get
    // contextual reference material when they ask for session overview.

    lines.push('');
    lines.push('---');
    lines.push('## Design Language Reference');
    lines.push('');
    lines.push('### Atoms');
    lines.push('display(text, fontSize, fontWeight, letterSpacing, fills) — hero text');
    lines.push('heading(text, level:1-6) — section headers');
    lines.push('body(text, muted?, fontSize?) — paragraphs');
    lines.push('button(text, variant:filled/outline/ghost, size:sm/md/lg) — clickable');
    lines.push('badge(text) · stat(value, label) · divider() · link(text)');
    lines.push('');
    lines.push('### Layout');
    lines.push('stack(pad, gap, align, fills) — vertical | row(pad, gap, justify, align) — horizontal');
    lines.push('card(pad, gap, fills, cornerRadius) — container | page(w:1440) — root');
    lines.push('grid(columns, gap) — CSS grid | center(pad, gap) — centered content');
    lines.push('');
    lines.push('### Spacing Guide');
    lines.push('Hero: pad [120-160, 80]  Section: pad [80-100, 80]  Card: pad 24-32 gap 16-24');
    lines.push('Button: pad [12-16, 24-32] minHeight 44  Gap sections: 48-80  Gap cards: 16-24');
    lines.push('');
    lines.push('### Key INode Props');
    lines.push('fills: ["#hex"] | opacity | cornerRadius | effects: [{type:"DROP_SHADOW",...}]');
    lines.push('layoutMode: NONE/HORIZONTAL/VERTICAL/GRID | layoutGrow: 1 | itemSpacing (gap)');
    lines.push('padding: number | paddingTop/Right/Bottom/Left | clipsContent');
    lines.push('primaryAxisAlign: MIN/CENTER/MAX/SPACE_BETWEEN | counterAxisAlign: MIN/CENTER/MAX/STRETCH');
    lines.push('fontSize | fontWeight | fontFamily | lineHeight | letterSpacing | textAlignHorizontal');
    lines.push('states: { hover: { fills: [...] } } | responsive: [{ maxWidth: 768, props: {...} }]');
    lines.push('');
    lines.push('### Design Tokens (via reframe_edit)');
    lines.push('defineTokens: DESIGN.md → token collection → auto-bind to matching nodes');
    lines.push('setMode: switch light/dark (re-resolves all token bindings)');
    lines.push('Token names: color.<role>, type.<role>.size, space.xs/sm/md/lg, radius.sm/md/lg');

    // Brand-specific context if active
    if (session.activeBrand) {
      const ds = session.activeDesignSystem;
      if (ds) {
        lines.push('');
        lines.push(`### Active Brand: ${session.activeBrand}`);
        const primary = ds.colors?.primary ?? '';
        const bg = ds.colors?.background ?? '';
        const font = ds.typography?.hierarchy?.[0]?.fontFamily ?? 'Inter';
        const heroSize = ds.typography?.hierarchy?.[0]?.fontSize ?? 56;
        const heroWeight = ds.typography?.hierarchy?.[0]?.fontWeight ?? 700;
        const radiusScale = ds.layout?.borderRadiusScale?.join('/') ?? '';
        if (primary) lines.push(`Primary: ${primary} | Background: ${bg} | Font: ${font}`);
        if (heroSize) lines.push(`Display: ${heroSize}px/${heroWeight} | Radius scale: ${radiusScale}px`);
      }
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }

  // ── Scene inspection ─────────────────────────────────────────

  let graph: SceneGraph;
  let rootId: string;
  try {
    ({ graph, rootId } = resolveScene({ sceneId: input.sceneId }));
  } catch (err: any) {
    return { content: [{ type: 'text' as const, text: err.message }] };
  }

  const sceneId = input.sceneId!;

  return runWithHostAsync(new StandaloneHost(graph), async () => {
  const rawRoot = graph.getNode(rootId)!;
  ensureSceneLayout(graph, rootId);

  const sections: string[] = [];
  sections.push(`Inspect: "${rawRoot.name}" (${Math.round(rawRoot.width)}×${Math.round(rawRoot.height)})`);

  // Parse design system: explicit input > session active > none
  const designMdText = input.designMd ?? session.activeDesignMd ?? undefined;
  const ds = designMdText
    ? session.getOrParseDesignMd(designMdText, parseDesignMd)
    : undefined;

  // ── a. Tree ──────────────────────────────────────────────────

  if (input.tree !== false) {
    const depthCap = input.treeMaxDepth ?? MCP_LIMITS.inspectTreeDefaultMaxDepth;
    const linesCap = input.treeMaxLines ?? MCP_LIMITS.inspectTreeDefaultMaxLines;
    const info = inspectScene(graph, rootId, { treeMaxDepth: depthCap, treeMaxLines: linesCap });
    sections.push('');
    sections.push('--- Tree ---');
    sections.push(info.tree);
    sections.push('');
    sections.push(`Stats: ${info.stats.total} nodes, depth ${info.stats.maxDepth}, ` +
      `${info.stats.textNodes} text, ${info.stats.autoLayoutFrames} auto-layout` +
      (info.treeTruncated ? ' (tree truncated — raise treeMaxDepth/treeMaxLines or narrow scope)' : ''));
    const typeEntries = Object.entries(info.stats.byType).map(([t, c]) => `${t}: ${c}`).join(', ');
    if (typeEntries) sections.push(`Types: ${typeEntries}`);
  }

  // ── a.5. Semantic skeleton ─────────────────────────────────────
  // Reads `node.semanticRole` set by reframe_compile and lists slots in
  // tree order. Re-runs classification on demand if the scene is unmarked
  // (e.g. imported from outside the reframe pipeline).
  try {
    let skeleton = readSemanticSkeleton(graph, rootId);
    if (skeleton.length === 0) {
      // Lazy classify on first inspect of an un-tagged scene.
      await classifyScene(graph, rootId, {
        designSystem: ds as any,
        multiSlot: true,
      });
      skeleton = readSemanticSkeleton(graph, rootId);
    }
    if (skeleton.length > 0) {
      sections.push('');
      sections.push('--- Semantic skeleton ---');
      // Group by role for the summary line. Display roles in the banner
      // vocabulary (`title`, `description`, …) so inspect matches the same
      // labels compile's own `Semantic: title=4, …` line prints — the two
      // outputs are meant to be read side by side and must agree.
      const labelOf = (role: string) => (SEMANTIC_TO_BANNER as Record<string, string>)[role] ?? role;
      const byRole = new Map<string, number>();
      for (const slot of skeleton) {
        const label = labelOf(slot.role);
        byRole.set(label, (byRole.get(label) ?? 0) + 1);
      }
      const dist = [...byRole]
        .sort(([, a], [, b]) => b - a)
        .map(([r, n]) => `${r}=${n}`)
        .join(', ');
      sections.push(`${skeleton.length} tagged: ${dist}`);
      // Per-slot listing capped at 20 entries to keep inspect output sane
      const cap = 20;
      const visible = skeleton.slice(0, cap);
      for (const slot of visible) {
        const text = slot.text ? ` "${slot.text.replace(/\s+/g, ' ').slice(0, 32)}"` : '';
        const wh = `${Math.round(slot.bounds.w)}×${Math.round(slot.bounds.h)}`;
        sections.push(`  [${labelOf(slot.role)}] ${slot.name} ${wh}${text}`);
      }
      if (skeleton.length > cap) {
        sections.push(`  … and ${skeleton.length - cap} more`);
      }
    }
  } catch (err: any) {
    // Semantic view is best-effort — never block inspect.
    sections.push('');
    sections.push(`--- Semantic skeleton --- (skipped: ${err?.message ?? 'unknown'})`);
  }

  // ── b. Audit ─────────────────────────────────────────────────

  if (input.audit !== false) {
    const auditOpts = typeof input.audit === 'object' ? input.audit : {};
    const minFS = auditOpts.minFontSize ?? 8;
    const minC = auditOpts.minContrast ?? 3;

    const wrappedRoot = new StandaloneNode(graph, rawRoot);

    const rules = buildInspectAuditRules(ds as any, { minFontSize: minFS, minContrast: minC });

    const issues = audit(wrappedRoot, rules, ds as any);

    // Record in session
    session.recordAudit({
      sceneId,
      sceneName: rawRoot.name ?? 'unnamed',
      timestamp: Date.now(),
      issueCount: issues.length,
      fixCount: 0,
      passed: issues.filter(i => i.severity === 'error').length === 0,
      rules: issues.map(i => i.rule),
    });

    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const infos = issues.filter(i => i.severity === 'info');

    sections.push('');
    sections.push(`--- Audit (${rules.length} rules) ---`);
    if (ds) sections.push(`Design system: "${ds.brand}"`);

    if (issues.length === 0) {
      sections.push('PASS — all checks passed.');
    } else {
      const status = errors.length > 0 ? 'FAIL' : 'WARN';
      sections.push(`Result: ${status} — ${errors.length} error, ${warnings.length} warning, ${infos.length} info`);

      // Show top issues with actionable fix suggestions (limit to 10 most important)
      const actionable = [...errors, ...warnings].slice(0, 10);
      const infoSummary = infos.length;

      for (const issue of actionable) {
        const icon = issue.severity === 'error' ? '[x]' : '[!]';
        sections.push(`${icon} ${issue.rule}: ${issue.message}`);
        // Actionable fix suggestion
        if (issue.fix) {
          sections.push(`    → reframe_edit: update "${issue.nodeName ?? issue.nodeId}" props: { ${issue.fix.property}: ${issue.fix.css} }`);
        } else if (issue.rule === 'contrast-minimum' && issue.nodeName) {
          sections.push(`    → reframe_edit: update "${issue.nodeName}" props: { fills: ["#fafafa"] } (lighten text) or darken background`);
        } else if (issue.rule === 'min-touch-target' && issue.nodeName) {
          sections.push(`    → reframe_edit: update "${issue.nodeName}" props: { minHeight: 44, paddingTop: 12, paddingBottom: 12 }`);
        } else if (issue.rule === 'cta-visibility' && issue.nodeName) {
          sections.push(`    → reframe_edit: update "${issue.nodeName}" props: { fontSize: 16, paddingTop: 14, paddingBottom: 14, paddingLeft: 32, paddingRight: 32 }`);
        }
      }
      if (infoSummary > 0) {
        sections.push(`[i] ${infoSummary} info-level suggestions (non-blocking)`);
      }
    }
  }

  // ── c. Assert ────────────────────────────────────────────────

  if (input.assert && input.assert.length > 0) {
    const wrappedRoot = new StandaloneNode(graph, rawRoot);

    let builder = assertDesign(wrappedRoot);

    for (const a of input.assert) {
      switch (a.type) {
        case 'minContrast':
          builder = builder.hasMinContrast(a.value ?? 4.5);
          break;
        case 'fitsWithin':
          builder = builder.fitsWithin(a.value?.width ?? rawRoot.width, a.value?.height ?? rawRoot.height);
          break;
        case 'noOverlapping':
          builder = builder.noOverlapping();
          break;
        case 'minFontSize':
          builder = builder.hasMinFontSize(a.value ?? 8);
          break;
        case 'noEmptyText':
          builder = builder.noEmptyText();
          break;
        case 'noZeroSize':
          builder = builder.noZeroSize();
          break;
        case 'noTextOverflow':
          builder = builder.noTextOverflow();
          break;
        case 'minLineHeight':
          builder = builder.hasMinLineHeight(a.value ?? 1.2);
          break;
      }
    }

    const results = builder.run();
    const formatted = formatAssertions(results);

    session.trackAssert(sceneId);

    sections.push('');
    sections.push('--- Assertions ---');
    sections.push(formatted);
  }

  // ── d. Diff ──────────────────────────────────────────────────

  let structuredDiffJson: string | null = null;

  if (input.diffWith) {
    let graphB, rootIdB;
    try {
      ({ graph: graphB, rootId: rootIdB } = resolveScene({ sceneId: input.diffWith }));
    } catch (err: any) {
      sections.push('');
      sections.push('--- Diff ---');
      sections.push(`Error: ${err.message}`);
      return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
    }

    const nodeA = new StandaloneNode(graph, rawRoot);
    const rawRootB = graphB.getNode(rootIdB)!;

    const diff = await runWithHostAsync(new StandaloneHost(graphB), async () => {
      ensureSceneLayout(graphB, rootIdB);
      const nodeB = new StandaloneNode(graphB, rawRootB);
      return diffTrees(nodeA, nodeB);
    });
    const diffTextDetail = input.diffTextDetail === 'summary' ? 'summary' : 'full';
    const formatted = formatDiff(diff, { detail: diffTextDetail });

    session.trackDiff(sceneId, input.diffWith);

    sections.push('');
    sections.push(`--- Diff: "${rawRoot.name}" vs "${rawRootB.name}" ---`);
    sections.push(formatted);

    if (input.diffStructured) {
      const detail = input.diffStructuredDetail === 'summary' ? 'summary' : 'full';
      structuredDiffJson = JSON.stringify({
        kind: 'reframe.structuralDiff',
        version: 1,
        detail,
        sceneA: sceneId,
        sceneB: input.diffWith,
        sceneNames: { a: rawRoot.name ?? null, b: rawRootB.name ?? null },
        result: detail === 'summary' ? { summary: diff.summary } : diff,
      });
    }
  }

  // ── Next step hint (concise — agent knows the workflow from tool descriptions) ──
  const hasErrors = sections.some(s => s.includes('[x]'));
  const hasWarnings = sections.some(s => s.includes('[!]'));
  if (hasErrors || hasWarnings) {
    sections.push('');
    sections.push(`Fix issues with reframe_edit, then re-inspect.`);
  }

  const content: Array<{ type: 'text'; text: string }> = [{ type: 'text', text: sections.join('\n') }];
  if (structuredDiffJson !== null) {
    content.push({ type: 'text', text: structuredDiffJson });
  }

  return { content };
  });
}
