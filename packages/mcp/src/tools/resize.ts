/**
 * reframe_resize — semantic-aware multi-size adaptation.
 *
 * Wraps the resize subsystem (`adaptFromGraph`) into an MCP tool so the
 * agent can ask for many sizes in one call: e.g. take an email at 680×1080
 * and produce mobile-email 375×1334, social-square 1080×1080, story
 * 1080×1920, leaderboard 728×90 — each as its own session scene with
 * semantic classification, layout profile, optional auto-export to HTML.
 *
 * Strategy semantics (passed straight through to adapt()):
 *   - smart   — letterbox-contain with guide post-process; the default
 *               that picks a known JSON guide for the target dimensions.
 *               Best for similar-aspect adaptations (vertical → mobile,
 *               vertical → social story).
 *   - contain — uniform letterbox to fit, no cropping. Margins on the
 *               opposite axis. Good for "show everything, accept margins".
 *   - cover   — uniform letterbox to fill, may crop. Good for "fill the
 *               canvas at any cost" — backgrounds, hero images.
 *   - stretch — non-uniform per-axis scaling (sX, sY differ). Distorts
 *               aspect. Use only for truly stretchable content.
 */

import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { adaptFromGraph } from '../../../core/src/resize/adapt.js';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import { storeScene, getScene, getExportsBaseDir } from '../store.js';
import { getSession } from '../session.js';

// ─── Schema ───────────────────────────────────────────────────

export const resizeInputSchema = {
  sceneId: z.string()
    .describe('Source scene ID (sN). Must already exist in the session — typically created by reframe_compile or reframe_edit.'),

  sizes: z.array(z.object({
    width: z.number().int().positive().describe('Target width in px'),
    height: z.number().int().positive().describe('Target height in px'),
    name: z.string().optional()
      .describe('Optional human name for the resulting scene (e.g. "mobile-email"). Defaults to "<source> <w>x<h>".'),
    strategy: z.enum(['smart', 'contain', 'cover', 'stretch', 'reflow']).optional().default('smart')
      .describe('Adaptation strategy. "smart" = letterbox-contain + guide post-process (default). "reflow" = flex-first re-layout for long-form content (landing pages, emails) — re-flows the tree through Yoga instead of proportional scaling.'),
  }))
    .min(1).max(20)
    .describe('Target sizes to adapt to. One call can produce up to 20 size variants.'),

  exportHtml: z.boolean().optional().default(true)
    .describe('Auto-export each adapted scene to .reframe/exports/<sceneId>-<w>x<h>.html. Default true.'),

  designMd: z.string().optional()
    .describe('DESIGN.md for brand-aware classification (button-pill detection, font-size matching). Falls back to session active brand.'),
};

interface ResizeInput {
  sceneId: string;
  sizes: Array<{ width: number; height: number; name?: string; strategy?: 'smart' | 'contain' | 'cover' | 'stretch' | 'reflow' }>;
  exportHtml?: boolean;
  designMd?: string;
}

// ─── Handler ──────────────────────────────────────────────────

export async function handleResize(input: ResizeInput) {
  const session = getSession();
  session.recordToolCall('resize');

  // Resolve source scene
  const stored = getScene(input.sceneId);
  if (!stored) {
    return {
      content: [{
        type: 'text' as const,
        text: `RESIZE ERROR: scene "${input.sceneId}" not found in session. Run reframe_compile first.`,
      }],
    };
  }

  // Pick design system: explicit > session > none
  let ds: any | undefined;
  const designMdText = input.designMd ?? session.activeDesignMd ?? undefined;
  if (designMdText) {
    try {
      ds = session.getOrParseDesignMd(designMdText, parseDesignMd);
    } catch { /* best-effort */ }
  }

  const lines: string[] = [];
  lines.push(`# Resize from ${input.sceneId} "${stored.name}" (${Math.round(stored.width)}×${Math.round(stored.height)}) → ${input.sizes.length} target(s)`);
  if (ds) lines.push(`Brand: ${ds.brand ?? 'custom'}`);
  lines.push('');

  const exportDir = getExportsBaseDir();
  if ((input.exportHtml ?? true) && !existsSync(exportDir)) {
    mkdirSync(exportDir, { recursive: true });
  }

  let succeeded = 0;
  let failed = 0;

  for (const target of input.sizes) {
    const tName = target.name ?? `${target.width}x${target.height}`;
    const tHeader = `## ${tName} — ${target.width}×${target.height}`;
    lines.push(tHeader);

    let result: Awaited<ReturnType<typeof adaptFromGraph>>;
    const t0 = Date.now();
    try {
      result = await adaptFromGraph(
        stored.graph,
        stored.rootId,
        target.width,
        target.height,
        {
          strategy: target.strategy ?? 'smart',
          designSystem: ds,
          useGuide: true,
          preserveProportions: true,
        },
      );
    } catch (err: any) {
      lines.push(`✗ ERROR: ${err?.message ?? err}`);
      lines.push('');
      failed++;
      continue;
    }
    const ms = Date.now() - t0;

    // Store the adapted scene as a new session scene so it can be inspected/
    // exported/edited via existing MCP tools. Slug carries the dimensions to
    // avoid collisions when adapting one source into many sizes.
    const childName = `${stored.name} ${tName}`;
    const childSlug = `${(stored.slug ?? input.sceneId).replace(/[^a-z0-9-]+/gi, '-')}-${target.width}x${target.height}`;
    const newSceneId = storeScene(
      result.graph,
      result.root.id,
      undefined,
      { name: childName, slug: childSlug },
    );
    succeeded++;

    // Compose semantic distribution + layout profile summary
    const dist = result.semanticTypes
      ? [...distribution(result.semanticTypes)].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')
      : '(none)';
    const lp = result.layoutProfile;

    // Show the *effective* strategy from stats — `smart` auto-upgrades
    // to `reflow` for long-form VERTICAL sources, and the caller
    // deserves to see which pipeline actually ran (otherwise "smart"
    // is indistinguishable from the reflow fallback).
    const requestedStrategy = target.strategy ?? 'smart';
    const actualStrategy = result.stats.strategy;
    const strategyLabel = actualStrategy === requestedStrategy
      ? actualStrategy
      : `${requestedStrategy} → ${actualStrategy}`;
    lines.push(`✓ **${newSceneId}** "${childName}" — adapted in ${ms}ms (${strategyLabel})`);
    if (lp) lines.push(`  layoutClass: ${lp.layoutClass} (confidence ${lp.confidence.toFixed(2)})`);
    lines.push(`  semantic: ${dist}`);
    if (result.stats.usedGuide && result.stats.guideKey) {
      lines.push(`  guide: ${result.stats.guideKey}`);
    }

    // Export to HTML if requested
    if (input.exportHtml ?? true) {
      try {
        const html = exportToHtml(result.graph, result.root.id, { fullDocument: true });
        const filename = `${newSceneId}-${target.width}x${target.height}.html`;
        const filepath = join(exportDir, filename);
        writeFileSync(filepath, html);
        const sizeKB = (html.length / 1024).toFixed(1);
        lines.push(`  → [${filename}](${filepath.replace(/\\/g, '/')}) (${sizeKB}KB)`);
      } catch (err: any) {
        lines.push(`  → export failed: ${err?.message ?? err}`);
      }
    }

    lines.push('');
  }

  // Summary
  lines.push('---');
  lines.push(`Done: **${succeeded} succeeded**, ${failed} failed of ${input.sizes.length} requested.`);
  if (succeeded > 0) {
    lines.push(`Use \`reframe_inspect\` on any of the new scene IDs above to see the adapted tree, semantic skeleton, and audit results.`);
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function distribution(map: Map<string, string>): Map<string, number> {
  const out = new Map<string, number>();
  for (const role of map.values()) {
    out.set(role, (out.get(role) ?? 0) + 1);
  }
  return out;
}
