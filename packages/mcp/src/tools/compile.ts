/**
 * reframe_compile — Unified compilation tool.
 *
 * Merges compose, produce, from_html, and batch into a single entry point.
 *
 * Two input paths:
 *   1. Compiler path: content + designMd + sizes → compiler → INode → audit → export
 *   2. HTML path: html → importFromHtml → INode → audit → export
 *
 * Both paths converge at: INode SceneGraph → audit+autofix → export.
 */

import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { importFromHtml } from '../../../core/src/importers/html.js';
import { compileTemplate, autoPickLayout } from '../../../core/src/compiler/index.js';
import { build } from '../../../core/src/builder.js';
import { resolveBlueprint } from '../../../core/src/ui/blueprint.js';
import { fromDesignMd } from '../../../core/src/ui/theme.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { exportToReact } from '../../../core/src/exporters/react.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { runWithHostAsync } from '../../../core/src/host/context.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import { audit } from '../../../core/src/audit.js';
import { buildInspectAuditRules } from '../../../core/src/inspect-audit-rules.js';
import { runAutoFixLoop } from './_auto-fix.js';
import { exportSvgFromGraph } from '../engine.js';
import { storeScene, getScene, resaveScene, getExportsBaseDir, getWorkspaceRoot, getReframeDir } from '../store.js';
import { autoSaveScene } from './project.js';
import { getSession } from '../session.js';
import { MCP_LIMITS } from '../limits.js';
import { makeToolJsonErrorResult } from '../tool-result.js';

function countNodesInGraph(graph: any, rootId: string): number {
  let count = 0;
  function walk(id: string) { const n = graph.getNode(id); if (!n) return; count++; for (const c of n.childIds) walk(c); }
  walk(rootId);
  return count;
}

// ─── Schema ───────────────────────────────────────────────────

export const compileInputSchema = {
  // Path 1: Compiler (preferred)
  content: z.object({
    headline: z.string().optional(),
    subheadline: z.string().optional(),
    cta: z.string().optional(),
    body: z.string().optional(),
    disclaimer: z.string().optional(),
    imageUrl: z.string().optional(),
    logoUrl: z.string().optional(),
  }).optional().describe('Structured content \u2192 compiler path. No HTML needed.'),

  layout: z.enum(['centered', 'left-aligned', 'split', 'stacked', 'auto']).optional().default('auto'),

  // Path 2: Blueprint (full @reframe/ui power via JSON)
  blueprint: z.record(z.any()).optional().describe(
    'UI component tree in JSON. Each node: { type, children?, ...props }. ' +
    'Types: page, stack, row, center, heading, body, button, card, badge, tag, stat, divider, ' +
    'hero, features, pricing, testimonials, cta, navbar, footer, logos, stats, ' +
    'table, tabs, accordion, progress, toggle, modal, toast, alert, ' +
    'checkbox, radio, slider, sidebar, breadcrumb, pagination, input, select, image. ' +
    'Theme from designMd auto-applies to all components.'
  ),

  // Path 3: HTML import
  html: z.string().optional().describe('HTML/CSS string to import. Use content, blueprint, html, OR file.'),
  file: z.string().optional().describe('Path to HTML file to import (e.g. .reframe/src/home.html). Alternative to html — engine reads the file. Use after editing source HTML.'),

  // Shared
  designMd: z.string().optional().describe('DESIGN.md content. Required for compiler, optional for HTML.'),
  brand: z.string().optional().describe(
    'Optional slug — same as reframe_design: fetches DESIGN.md via local clone / GitHub raw (loadBrandDesignMd). No built-in catalog. Alternative to designMd.',
  ),
  name: z.string().optional().describe('Scene name prefix.'),

  // Single size or multi-size
  width: z.number().optional(),
  height: z.number().optional(),
  sizes: z.array(z.object({
    width: z.number(),
    height: z.number(),
    name: z.string().optional(),
    layout: z.enum(['centered', 'left-aligned', 'split', 'stacked', 'auto']).optional(),
  })).optional().describe('Multi-size: compile same content to N sizes.'),

  // Audit
  audit: z.union([z.boolean(), z.object({
    autoFix: z.boolean().optional().default(true),
    maxPasses: z.number().optional().default(3),
    minFontSize: z.number().optional().default(8),
    minContrast: z.number().optional().default(3),
  })]).optional().default(true),

  // Export
  exports: z.array(z.enum(['html', 'svg', 'react'])).optional().default(['html']),
};

// ─── Types ────────────────────────────────────────────────────

interface ContentInput {
  headline?: string;
  subheadline?: string;
  cta?: string;
  body?: string;
  disclaimer?: string;
  imageUrl?: string;
  logoUrl?: string;
}

interface SizeEntry {
  width: number;
  height: number;
  name: string;
  layout?: 'centered' | 'left-aligned' | 'split' | 'stacked' | 'auto';
}

interface CompileInput {
  content?: ContentInput;
  blueprint?: Record<string, any>;
  layout?: 'centered' | 'left-aligned' | 'split' | 'stacked' | 'auto';
  html?: string;
  file?: string;
  designMd?: string;
  brand?: string;
  name?: string;
  width?: number;
  height?: number;
  sizes?: Array<{ width: number; height: number; name?: string; layout?: string }>;
  audit?: boolean | {
    autoFix?: boolean;
    maxPasses?: number;
    minFontSize?: number;
    minContrast?: number;
  };
  exports?: Array<'html' | 'svg' | 'react'>;
}

// ─── Handler ──────────────────────────────────────────────────

export async function handleCompile(input: CompileInput) {
  const t0 = Date.now();
  const session = getSession();
  session.recordToolCall('compile');

  // ─── Resolve file → html ──
  if (input.file && !input.html) {
    const filePath = resolve(getWorkspaceRoot(), input.file);
    if (!existsSync(filePath)) {
      return { content: [{ type: 'text' as const, text: `File not found: ${filePath}` }] };
    }
    input.html = readFileSync(filePath, 'utf-8');
  }

  // ─── Auto-load DESIGN.md: explicit brand → session brand → none ──
  if (!input.designMd && input.brand) {
    const loaded = await loadBrandDesignMd(input.brand);
    if (loaded) {
      input.designMd = loaded;
      // Also set as session brand
      const ds = session.getOrParseDesignMd(loaded, parseDesignMd);
      session.setBrand(input.brand, loaded, ds);
    } else {
      return makeToolJsonErrorResult(
        `Brand "${input.brand}" not found. Use reframe_design (url/html/slug) or pass designMd.`,
        'compile.brand_not_found',
        { brand: input.brand },
      );
    }
  }
  // Fallback to session brand if no explicit brand/designMd
  if (!input.designMd && session.activeDesignMd) {
    input.designMd = session.activeDesignMd;
  }

  // ─── Validate inputs ────────────────────────────────────────

  const useBlueprint = !!input.blueprint;
  const useCompiler = !useBlueprint && !!input.content && !!input.designMd;

  if (!useBlueprint && !useCompiler && !input.html) {
    return {
      content: [{
        type: 'text' as const,
        text: 'Provide content + designMd (compiler path), brand + content (auto-loads DESIGN.md), or html (import path).',
      }],
    };
  }

  // ─── Build size list ────────────────────────────────────────

  const sizes: SizeEntry[] = [];

  if (input.sizes && input.sizes.length > 0) {
    for (const s of input.sizes) {
      sizes.push({
        width: s.width,
        height: s.height,
        name: s.name ?? `${s.width}x${s.height}`,
        layout: (s.layout as SizeEntry['layout']) ?? undefined,
      });
    }
  } else if (input.width && input.height) {
    sizes.push({
      width: input.width,
      height: input.height,
      name: input.name ?? 'Scene',
    });
  } else if (input.html) {
    // HTML import: size comes from the imported document
    sizes.push({
      width: 0,
      height: 0,
      name: input.name ?? 'Imported',
    });
  } else {
    return {
      content: [{
        type: 'text' as const,
        text: 'Provide width + height, sizes[], or html (size auto-detected from HTML).',
      }],
    };
  }

  // ─── Size / payload bounds ──────────────────────────────────

  if (input.html && input.html.length > MCP_LIMITS.compileHtmlMaxChars) {
    return makeToolJsonErrorResult(
      `html exceeds ${MCP_LIMITS.compileHtmlMaxChars} characters (got ${input.html.length}).`,
      'compile.html_too_large',
      { length: input.html.length, max: MCP_LIMITS.compileHtmlMaxChars },
    );
  }
  if (input.designMd && input.designMd.length > MCP_LIMITS.compileDesignMdMaxChars) {
    return makeToolJsonErrorResult(
      `designMd exceeds ${MCP_LIMITS.compileDesignMdMaxChars} characters (got ${input.designMd.length}).`,
      'compile.design_md_too_large',
      { length: input.designMd.length, max: MCP_LIMITS.compileDesignMdMaxChars },
    );
  }
  if (useBlueprint && input.blueprint) {
    let bpLen = 0;
    try {
      bpLen = JSON.stringify(input.blueprint).length;
    } catch {
      return makeToolJsonErrorResult('blueprint could not be serialized to JSON.', 'compile.blueprint_invalid');
    }
    if (bpLen > MCP_LIMITS.compileBlueprintJsonMaxChars) {
      return makeToolJsonErrorResult(
        `blueprint JSON exceeds ${MCP_LIMITS.compileBlueprintJsonMaxChars} characters (got ${bpLen}).`,
        'compile.blueprint_too_large',
        { length: bpLen, max: MCP_LIMITS.compileBlueprintJsonMaxChars },
      );
    }
  }
  if (sizes.length > MCP_LIMITS.compileSizesMaxCount) {
    return makeToolJsonErrorResult(
      `Too many sizes (${sizes.length}); max ${MCP_LIMITS.compileSizesMaxCount}.`,
      'compile.too_many_sizes',
      { count: sizes.length, max: MCP_LIMITS.compileSizesMaxCount },
    );
  }
  for (const s of sizes) {
    const maxD = MCP_LIMITS.compileSizeMaxDimension;
    const needsDims = useBlueprint || useCompiler;
    if (needsDims) {
      if (s.width <= 0 || s.height <= 0 || s.width > maxD || s.height > maxD) {
        return makeToolJsonErrorResult(
          `Invalid size ${s.name}: width/height must be 1…${maxD} for blueprint/compiler paths.`,
          'compile.size_out_of_range',
          { name: s.name, width: s.width, height: s.height, max: maxD },
        );
      }
    } else if (input.html && (s.width !== 0 || s.height !== 0)) {
      if (s.width > maxD || s.height > maxD || s.width < 0 || s.height < 0) {
        return makeToolJsonErrorResult(
          `Invalid HTML import size override for ${s.name}: dimensions must be 0…${maxD}.`,
          'compile.size_out_of_range',
          { name: s.name, width: s.width, height: s.height, max: maxD },
        );
      }
    }
  }

  // ─── Parse design system once ───────────────────────────────

  let ds: ReturnType<typeof parseDesignMd> | undefined;
  if (input.designMd) {
    try {
      ds = session.getOrParseDesignMd(input.designMd, parseDesignMd);
    } catch (err: any) {
      return {
        content: [{
          type: 'text' as const,
          text: `DESIGN.md parse error: ${err.message}`,
        }],
      };
    }
  }

  // ─── Audit config ──────────────────────────────────────────

  const auditEnabled = input.audit !== false;
  const auditOpts = typeof input.audit === 'object' ? input.audit : {};
  const doAutoFix = auditOpts.autoFix !== false;
  const maxPasses = auditOpts.maxPasses ?? 3;
  const minFS = auditOpts.minFontSize ?? 8;
  const minCR = auditOpts.minContrast ?? 3;

  const requestedExports = input.exports ?? ['html'];
  const sections: string[] = [];
  const sceneIds: string[] = [];

  // Design context — show key brand values so agent can iterate with knowledge
  if (ds && useBlueprint) {
    const hero = ds.typography.hierarchy.find((r: any) => r.role === 'hero');
    const body = ds.typography.hierarchy.find((r: any) => r.role === 'body');
    sections.push(`Brand: ${ds.brand}`);
    sections.push(`  Primary: ${ds.colors.primary} | BG: ${ds.colors.background} | Text: ${ds.colors.text}`);
    if (hero) sections.push(`  Hero: ${hero.fontFamily ?? 'default'} ${hero.fontSize}px w${hero.fontWeight} ls:${hero.letterSpacing}px`);
    if (body) sections.push(`  Body: ${body.fontFamily ?? 'default'} ${body.fontSize}px w${body.fontWeight}`);
    sections.push(`  Radius: ${ds.components.button?.borderRadius ?? 8}px | Spacing: ${ds.layout.spacingUnit}px`);
    sections.push('');
  }

  const methodLabel = useBlueprint ? 'BLUEPRINT' : useCompiler ? 'COMPILE' : 'IMPORT';
  const brandLabel = ds ? ` (${ds.brand})` : '';
  if (sizes.length === 1) {
    sections.push(`✓ ${methodLabel}${brandLabel}`);
  } else {
    sections.push(`✓ ${methodLabel} ${sizes.length} sizes${brandLabel}`);
  }

  // ─── Process each size ─────────────────────────────────────

  for (const size of sizes) {
    const sizeT0 = Date.now();
    let graph: any;
    let rootId: string;
    let resolvedLayout: 'centered' | 'left-aligned' | 'split' | 'stacked' | undefined;

    try {
      if (useBlueprint) {
        // ── BLUEPRINT PATH ─────────────────────────────────
        const theme = ds ? fromDesignMd(input.designMd!) : undefined;
        const bp = input.blueprint as any;
        // Override page dimensions per size
        if (bp.type === 'page' || bp.type === 'Page') {
          bp.w = size.width;
          bp.h = size.height;
        }
        const blueprint = resolveBlueprint(bp, theme);
        const built = build(blueprint);
        graph = built.graph;
        rootId = built.root.id;
        ensureSceneLayout(graph, rootId);
        resolvedLayout = 'blueprint' as any;
      } else if (useCompiler) {
        // ── COMPILER PATH ──────────────────────────────────
        const layoutChoice = size.layout ?? input.layout ?? 'auto';
        resolvedLayout = layoutChoice === 'auto'
          ? autoPickLayout(size.width, size.height, input.content!)
          : layoutChoice;

        const blueprint = compileTemplate({
          designSystem: ds!,
          width: size.width,
          height: size.height,
          layout: resolvedLayout,
          content: input.content!,
        });

        const built = build(blueprint);
        graph = built.graph;
        rootId = built.root.id;

        try {
          ensureSceneLayout(graph, rootId);
        } catch (_) {
          // Yoga may not be initialized — layout falls back to blueprint positions
        }
      } else {
        // ── HTML PATH ──────────────────────────────────────
        const importResult = await importFromHtml(input.html!, {
          name: input.name,
          width: size.width || undefined,
          height: size.height || undefined,
        });
        graph = importResult.graph;
        rootId = importResult.rootId;
      }
    } catch (err: any) {
      sections.push(`## ${size.name} \u2014 ERROR`);
      sections.push(`Import/compile failed: ${err.message}`);
      sections.push('');
      continue;
    }

    await runWithHostAsync(new StandaloneHost(graph), async () => {
    const root = graph.getNode(rootId)!;
    ensureSceneLayout(graph, rootId);

    // ── AUDIT + AUTOFIX ────────────────────────────────────
    let auditSummary = '';
    if (auditEnabled) {
      // Check if design system has usable data for brand rules
      let auditDs = ds;
      if (auditDs) {
        const hasColors = auditDs.colors && ((auditDs.colors as any).roles?.size > 0 || (auditDs.colors as any).primary);
        const hasTypo = auditDs.typography && (auditDs.typography as any).hierarchy?.length > 0;
        if (!hasColors && !hasTypo) {
          auditDs = undefined;
        }
      }

      const rules = buildInspectAuditRules(auditDs as any, {
        minFontSize: minFS,
        minContrast: minCR,
      });

      const { finalIssues, allFixed, passCount } = runAutoFixLoop(
        graph, rootId,
        () => {
          const wrappedRoot = new StandaloneNode(graph, graph.getNode(rootId)!);
          return audit(wrappedRoot, rules, auditDs as any);
        },
        { autoFix: doAutoFix, maxPasses },
      );

      const errors = finalIssues.filter(i => i.severity === 'error');

      if (allFixed.length > 0) {
        // Collapse duplicate fixes: "contrast-minimum: auto-corrected" x6 → "contrast-minimum: auto-corrected (×6)"
        const fixCounts = new Map<string, number>();
        for (const f of allFixed) fixCounts.set(f, (fixCounts.get(f) ?? 0) + 1);
        const fixSummary = [...fixCounts].map(([f, n]) => n > 1 ? `${f} (×${n})` : f).join(', ');
        auditSummary += `Auto-fixed: ${fixSummary}\n`;
      }
      const warnings = finalIssues.filter(i => i.severity === 'warning');

      if (errors.length > 0) {
        auditSummary += `Audit: ${errors.length} error${errors.length > 1 ? 's' : ''}\n`;
        for (const i of errors) {
          auditSummary += `  [x] ${i.rule}: ${i.message}\n`;
        }
      } else if (warnings.length > 0) {
        auditSummary += `Audit: PASS with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}\n`;
        for (const i of warnings) {
          auditSummary += `  [!] ${i.rule}: ${i.message}\n`;
          if (i.fix) auditSummary += `      fix: ${i.fix.css}\n`;
        }
      } else {
        auditSummary += `Audit: PASS (${rules.length} rules)\n`;
      }

      // Record audit in session
      session.recordAudit({
        sceneId: '',  // will be set after storeScene
        sceneName: root.name ?? 'unnamed',
        timestamp: Date.now(),
        issueCount: finalIssues.length,
        fixCount: allFixed.length,
        passed: errors.length === 0,
        rules: finalIssues.map(i => i.rule),
      });
    }

    // ── STORE ──────────────────────────────────────────────
    const sceneName = sizes.length > 1
      ? `${input.name ?? 'Scene'}-${size.name}`
      : (input.name ?? size.name ?? root.name);

    const sceneId = storeScene(graph, rootId, undefined, { name: sceneName });
    sceneIds.push(sceneId);
    autoSaveScene(sceneId, graph, rootId);

    session.trackImport(
      sceneId,
      sceneName,
      Math.round(root.width ?? size.width),
      Math.round(root.height ?? size.height),
      !!input.designMd,
    );

    // ── SAVE SOURCE HTML ───────────────────────────────────
    // Persist source HTML so the agent can read/edit it later and re-compile.
    // If name contains '/' (e.g. "site/home"), use the prefix as group and create subdirectory.
    if (input.html) {
      try {
        // Parse group from name: "site/home" → group="site", leaf="home"
        const nameParts = (input.name ?? sceneName).split('/');
        const group = nameParts.length > 1 ? nameParts.slice(0, -1).join('/') : undefined;
        const leafName = nameParts[nameParts.length - 1];
        const srcSubDir = group ? join(getReframeDir(), 'src', group) : join(getReframeDir(), 'src');
        if (!existsSync(srcSubDir)) mkdirSync(srcSubDir, { recursive: true });
        const srcFileName = `${leafName}.html`;
        const srcPath = join(srcSubDir, srcFileName);
        writeFileSync(srcPath, input.html, 'utf-8');
        const srcRelative = group ? `src/${group}/${srcFileName}` : `src/${srcFileName}`;

        // Store source path + group on the scene, then re-save to update manifest
        const stored = getScene(sceneId);
        if (stored) {
          (stored as any).sourceFile = srcRelative;
          (stored as any).group = group;
          resaveScene(sceneId);
        }
      } catch { /* best-effort */ }
    }

    // ── EXPORT ─────────────────────────────────────────────
    const exportResults: Record<string, string> = {};

    for (const fmt of requestedExports) {
      try {
        switch (fmt) {
          case 'html': {
            exportResults.html = exportToHtml(graph, rootId, {
              fullDocument: true,
              dataAttributes: true,
            });
            break;
          }
          case 'svg': {
            exportResults.svg = exportSvgFromGraph(graph, rootId, {
              xmlDeclaration: true,
              includeNames: true,
            });
            break;
          }
          case 'react': {
            const wrappedRoot = new StandaloneNode(graph, graph.getNode(rootId)!);
            exportResults.react = exportToReact(wrappedRoot);
            break;
          }
        }
        session.trackExport(sceneId, fmt);
      } catch (err: any) {
        exportResults[fmt] = `Error: ${err.message}`;
      }
    }

    // ── BUILD SECTION REPORT (compact, agent-friendly) ─────
    const sizeMs = Date.now() - sizeT0;
    const method = useBlueprint ? 'blueprint' : useCompiler ? 'compiled' : 'imported';
    const nodeCount = countNodesInGraph(graph, rootId);
    const dims = `${Math.round(root.width ?? size.width)}×${Math.round(root.height ?? size.height)}`;
    const exportList = Object.entries(exportResults).map(([f, c]) => c.startsWith('Error:') ? `${f}:ERR` : `${f}:${(c.length/1024).toFixed(0)}KB`).join(' ');

    sections.push(`  ${sceneId} "${sceneName}" ${dims} — ${nodeCount} nodes, ${method}, ${sizeMs}ms → ${exportList}`);

    if (auditSummary) {
      // Indent audit under the scene
      for (const line of auditSummary.trimEnd().split('\n')) {
        sections.push(`    ${line}`);
      }
    }

    // Report source HTML path (for agent to read/edit later)
    const stored = getScene(sceneId);
    if (input.html && stored) {
      const srcRelative = (stored as any).sourceFile;
      if (srcRelative) {
        const srcPath = join(getReframeDir(), '..', '.reframe', srcRelative).replace(/\\/g, '/');
        sections.push(`    source: [${srcRelative}](${join(getReframeDir(), srcRelative).replace(/\\/g, '/')})`);
      }
    }

    // Auto-save exports to .reframe/exports/
    const extMap: Record<string, string> = { html: 'html', svg: 'svg', react: 'tsx' };
    const exportDir = getExportsBaseDir();
    if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });

    for (const [fmt, content] of Object.entries(exportResults)) {
      if (content.startsWith('Error:')) {
        sections.push(`  ${fmt}: ${content}`);
      } else {
        const ext = extMap[fmt] ?? fmt;
        const fileName = `${sceneName.toLowerCase().replace(/\s+/g, '-')}.${ext}`;
        const filePath = join(exportDir, fileName);
        try { writeFileSync(filePath, content, 'utf-8'); } catch {}
        sections.push(`    → [${fileName}](${filePath.replace(/\\/g, '/')}) (${(content.length / 1024).toFixed(1)}KB)`);
      }
    }

    sections.push('');
    });
  }

  // ─── Summary ────────────────────────────────────────────────

  const totalMs = Date.now() - t0;
  sections.push(`Done in ${totalMs}ms. Scenes: ${sceneIds.join(', ')}`);

  // Inject brand context for AI's next iteration
  if (session.activeBrand) {
    const ds = session.activeDesignSystem;
    if (ds) {
      const hero = ds.typography.hierarchy[0];
      sections.push('');
      sections.push(`**Active brand: ${session.activeBrand}** — ${ds.colors.primary ?? ''} primary, ${hero?.fontFamily ?? 'Inter'} ${hero?.fontWeight ?? 400}, radius ${ds.layout.borderRadiusScale.slice(1, 4).join('/')}px`);
    }
  }
  sections.push('');
  sections.push(`Next: reframe_inspect({ sceneId: "${sceneIds[0]}" })`);

  return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
}

// ─── Brand DESIGN.md loader ──────────────────────────────────

const BRAND_ALIASES: Record<string, string> = {
  linear: 'linear.app', mistral: 'mistral.ai', xai: 'x.ai',
  together: 'together.ai', opencode: 'opencode.ai',
};

/** Fetch DESIGN.md by brand slug via npx getdesign. Caches in project .reframe/brands/. */
export async function loadBrandDesignMd(brand: string): Promise<string | null> {
  const brandKey = BRAND_ALIASES[brand.toLowerCase()] ?? brand.toLowerCase();
  const outDir = join(getWorkspaceRoot(), '.reframe', 'brands', brandKey);
  const outFile = join(outDir, 'DESIGN.md');

  // Cached locally in project
  if (existsSync(outFile)) return readFileSync(outFile, 'utf-8');

  // Fetch via npm
  try {
    mkdirSync(outDir, { recursive: true });
    execSync(`npx getdesign add ${brandKey} --out "${outFile}"`, {
      timeout: 30000,
      stdio: 'pipe',
    });
    if (existsSync(outFile)) return readFileSync(outFile, 'utf-8');
  } catch {}

  return null;
}
