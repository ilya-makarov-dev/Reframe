/**
 * reframe_inspect (v2) — Unified inspection tool.
 *
 * Merges: audit, assert, inspect, info, diff, preview into one tool.
 * Returns a composite report with only the sections the caller requests.
 */

import { z } from 'zod';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../../core/src/host/context.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import {
  audit,
  textOverflow, nodeOverflow, minFontSize as minFontSizeRule, noEmptyText, noZeroSize,
  noHiddenNodes, contrastMinimum, minTouchTarget,
  fontInPalette, colorInPalette, fontWeightCompliance, fontSizeRoleMatch,
  borderRadiusCompliance, spacingGridCompliance,
  visualHierarchy, contentDensity, visualBalance, ctaVisibility,
  exportFidelity,
  type AuditRule,
} from '../../../core/src/audit.js';
import { assertDesign, formatAssertions } from '../../../core/src/assert.js';
import { diffTrees, formatDiff } from '../../../core/src/diff.js';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { inspectScene, exportScene, createSceneFromJson } from '../engine.js';
import { resolveScene, listScenes, getScene } from '../store.js';
import { getSession } from '../session.js';
import { VERSION } from '../version.js';

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
};

// ─── Handler ───────────────────────────────────────────────────

export async function handleInspect(input: {
  sceneId?: string;
  tree?: boolean;
  audit?: boolean | { minFontSize?: number; minContrast?: number };
  assert?: Array<{ type: string; value?: any }>;
  designMd?: string;
  diffWith?: string;
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
      // Extract just the recommendations section if present
      const recIdx = summary.indexOf('Recommended next:');
      if (recIdx !== -1) {
        lines.push('');
        lines.push(summary.slice(recIdx));
      }
    }

    return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
  }

  // ── Scene inspection ─────────────────────────────────────────

  let graph, rootId;
  try {
    ({ graph, rootId } = resolveScene({ sceneId: input.sceneId }));
  } catch (err: any) {
    return { content: [{ type: 'text' as const, text: err.message }] };
  }

  const rawRoot = graph.getNode(rootId)!;
  const sections: string[] = [];
  sections.push(`Inspect: "${rawRoot.name}" (${Math.round(rawRoot.width)}×${Math.round(rawRoot.height)})`);

  // Parse design system if provided
  const ds = input.designMd
    ? session.getOrParseDesignMd(input.designMd, parseDesignMd)
    : undefined;

  // ── a. Tree ──────────────────────────────────────────────────

  if (input.tree !== false) {
    const info = inspectScene(graph, rootId);
    sections.push('');
    sections.push('--- Tree ---');
    sections.push(info.tree);
    sections.push('');
    sections.push(`Stats: ${info.stats.total} nodes, depth ${info.stats.maxDepth}, ` +
      `${info.stats.textNodes} text, ${info.stats.autoLayoutFrames} auto-layout`);
    const typeEntries = Object.entries(info.stats.byType).map(([t, c]) => `${t}: ${c}`).join(', ');
    if (typeEntries) sections.push(`Types: ${typeEntries}`);
  }

  // ── b. Audit ─────────────────────────────────────────────────

  if (input.audit !== false) {
    const auditOpts = typeof input.audit === 'object' ? input.audit : {};
    const minFS = auditOpts.minFontSize ?? 8;
    const minC = auditOpts.minContrast ?? 3;

    setHost(new StandaloneHost(graph));
    const wrappedRoot = new StandaloneNode(graph, rawRoot);

    // Build all 19 rules
    const rules: AuditRule[] = [
      // Structural (8)
      textOverflow(),
      nodeOverflow(),
      minFontSizeRule(minFS),
      noEmptyText(),
      noZeroSize(),
      noHiddenNodes(),
      contrastMinimum(minC),
      minTouchTarget(),
      // Design system (6)
      fontWeightCompliance(),
      fontSizeRoleMatch(),
      borderRadiusCompliance(),
      spacingGridCompliance(),
      // Layout intelligence (4)
      visualHierarchy(),
      contentDensity(),
      visualBalance(),
      ctaVisibility(),
      // Export fidelity (1)
      exportFidelity(),
    ];

    // Palette rules require DESIGN.md
    if (ds) {
      rules.push(fontInPalette());
      rules.push(colorInPalette());
    }

    const issues = audit(wrappedRoot, rules, ds as any);

    // Record in session
    session.recordAudit({
      sceneId: input.sceneId,
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
    setHost(new StandaloneHost(graph));
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

    session.trackAssert(input.sceneId);

    sections.push('');
    sections.push('--- Assertions ---');
    sections.push(formatted);
  }

  // ── d. Diff ──────────────────────────────────────────────────

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

    setHost(new StandaloneHost(graph));
    const nodeA = new StandaloneNode(graph, rawRoot);

    setHost(new StandaloneHost(graphB));
    const rawRootB = graphB.getNode(rootIdB)!;
    const nodeB = new StandaloneNode(graphB, rawRootB);

    const diff = diffTrees(nodeA, nodeB);
    const formatted = formatDiff(diff);

    session.trackDiff(input.sceneId, input.diffWith);

    sections.push('');
    sections.push(`--- Diff: "${rawRoot.name}" vs "${rawRootB.name}" ---`);
    sections.push(formatted);
  }

  // ── Next step guidance ──────────────────────────────────────
  const hasIssues = sections.some(s => s.includes('[x]') || s.includes('[!]'));
  sections.push('');
  if (hasIssues) {
    sections.push(`Fix with reframe_edit, then reframe_inspect again. Loop until clean.`);
    sections.push(`Then export for user to review: reframe_export({ sceneId: "${input.sceneId}", format: "html" })`);
  } else {
    sections.push(`Design is clean. Export for user to review: reframe_export({ sceneId: "${input.sceneId}", format: "html" })`);
    sections.push(`User will review and may request changes → edit → inspect → export again.`);
  }

  return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
}
