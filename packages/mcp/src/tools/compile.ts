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
import { importFromHtml, resolveDeferredAbsolutePositions } from '../../../core/src/importers/html.js';
import { compileTemplate, autoPickLayout } from '../../../core/src/compiler/index.js';
import { build } from '../../../core/src/builder.js';
import { resolveBlueprint } from '../../../core/src/ui/blueprint.js';
import { fromDesignMd } from '../../../core/src/ui/theme.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { classifyScene } from '../../../core/src/semantic/index.js';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { exportToReact } from '../../../core/src/exporters/react.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { runWithHostAsync } from '../../../core/src/host/context.js';
import { parseDesignMd } from '../../../core/src/design-system/index.js';
import { hashDesignMdContent } from '../../../core/src/project/types.js';
import { coreProjectIo } from '../project-io.js';
import { audit } from '../../../core/src/audit.js';
import { buildInspectAuditRules } from '../../../core/src/inspect-audit-rules.js';
import { runAutoFixLoop } from './_auto-fix.js';
import { exportSvgFromGraph } from '../engine.js';
import { storeScene, getScene, resaveScene, getExportsBaseDir, getWorkspaceRoot, getReframeDir } from '../store.js';
import { renderPreview } from './_preview.js';
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
  exports: z.array(z.enum(['html', 'svg', 'react', 'png', 'pdf'])).optional().default(['html']),

  // AI classification (opt-in: uses LLM to assign semantic roles if classify callback available)
  aiClassify: z.boolean().optional().default(false).describe('Use AI (LLM) for semantic role classification. Falls back to heuristic if unavailable.'),

  layoutBackend: z.enum(['yoga', 'taffy']).optional().default('yoga').describe('Layout engine: yoga (default, mature flexbox) or taffy (Rust, spec-faithful CSS Grid). Taffy requires yoga-layout-taffy npm package.'),

  preview: z.boolean().optional().default(true).describe(
    'Return an inline PNG preview of the primary compiled scene alongside the text report. '
    + 'Set false for multi-size / batch compiles where the preview payload is not worth the bytes.',
  ),

  // ─── Variants composition (Phase 0 additive) ─────────────────
  // When present, this request compiles N scenes as a variants composition.
  // Constraint: all scenes[i].brand must be equal (or all undefined) —
  // Phase 0 supports same-brand-only. Cross-brand variants = future
  // extension activated by real user signal.
  variants: z.object({
    scenes: z.array(z.record(z.any())).min(2).describe(
      'N compile inputs (2+). Each is a standard CompileInput shape (content/blueprint/html/file/designMd/brand/name/sizes/...). '
      + 'All scenes[i].brand must be equal — throw on mismatch.',
    ),
  }).optional().describe(
    'Variants composition: compile N scenes with shared brand resolution. '
    + 'Returns structured JSON with per-scene results + shared brand.',
  ),

  // ─── Flow composition (Phase 0 Flow kind) ────────────────────
  // When present, this request compiles a flow — a stateful sequence of
  // scenes with transitions and cross-step data. Persisted to
  // `.reframe/flows/<flowId>/` as flow.json (spec) + state.json (live
  // data). Constraints mirror variants: same-brand across all steps,
  // no per-step designMd override, step names must be unique.
  // Transitions default to linear Next buttons (0→1, 1→2, …) when omitted.
  flow: z.object({
    flowId: z.string().describe(
      'Stable id for the flow — becomes the .reframe/flows/<flowId>/ directory name. Used in URL (?flow=<flowId>) and as the state.json anchor.',
    ),
    name: z.string().optional().describe('Optional human label for the flow (e.g. "Signup", "Onboarding").'),
    steps: z.array(z.record(z.any())).min(2).describe(
      'N step compile inputs (2+). Each is a standard CompileInput shape. All steps[i].brand must be equal; per-step designMd is unsupported in Phase 0.',
    ),
    transitions: z.array(z.object({
      from: z.number().int(),
      to: z.number().int(),
      label: z.string().optional(),
      condition: z.string().optional(),
    })).optional().describe(
      'Transition graph. Omit for linear flow (auto-generates 0→1, 1→2, … with "Next" labels). Phase 0: condition is reserved, always treated as true.',
    ),
  }).optional().describe(
    'Flow composition: compile N step scenes, write flow.json + init state.json. '
    + 'Returns structured JSON with per-step results + flowId + generated transitions.',
  ),
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
  exports?: Array<'html' | 'svg' | 'react' | 'png' | 'pdf'>;
  aiClassify?: boolean;
  layoutBackend?: 'yoga' | 'taffy';
  preview?: boolean;
  /** Phase 0 additive: variants composition. See handleVariantsCompile. */
  variants?: { scenes: CompileInput[] };
  /** Phase 0 Flow kind composition. See handleFlowCompile. */
  flow?: {
    flowId: string;
    name?: string;
    steps: CompileInput[];
    transitions?: Array<{ from: number; to: number; label?: string; condition?: string }>;
  };
  /** Phase 0 Sampler kind composition (Week 3 #25). See handleSamplerCompile. */
  sampler?: {
    samplerId: string;
    name?: string;
    cells: CompileInput[];
    grid: {
      columns: number;
      rows?: number;
      gap?: number;
      cellWidth?: number;
      cellHeight?: number;
      labels?: string[];
    };
  };
}

// ─── Handler ──────────────────────────────────────────────────

export async function handleCompile(input: CompileInput) {
  // ─── Variants dispatch (Phase 0 additive) ───────────────────
  // If the request carries a `variants` field, route to the variants
  // handler. Zero impact on single-scene callers — they never set this
  // field. All existing logic below runs unchanged for single compiles.
  if (input.variants) {
    // Mutual exclusion: variants is a composition input. Combining it
    // with single-scene input fields (html/file/content/blueprint) is
    // ambiguous — caller probably meant one or the other. Silent drop
    // would be a bug; throw explicitly with actionable error code.
    const conflictingFields: string[] = [];
    if (input.html !== undefined) conflictingFields.push('html');
    if (input.file !== undefined) conflictingFields.push('file');
    if (input.content !== undefined) conflictingFields.push('content');
    if (input.blueprint !== undefined) conflictingFields.push('blueprint');
    if (input.flow !== undefined) conflictingFields.push('flow');
    if (conflictingFields.length > 0) {
      return makeToolJsonErrorResult(
        `variants-compile cannot be combined with single-scene input fields or other compositions (${conflictingFields.join(', ')}). Pick one mode: single scene (content/blueprint/html/file), variants (variants.scenes[]), OR flow (flow.steps[]).`,
        'compile.input_mode_conflict',
        { conflictingFields },
      );
    }
    return handleVariantsCompile(input.variants);
  }

  // ─── Flow dispatch (Phase 0 Flow kind) ──────────────────────
  if (input.flow) {
    const conflictingFields: string[] = [];
    if (input.html !== undefined) conflictingFields.push('html');
    if (input.file !== undefined) conflictingFields.push('file');
    if (input.content !== undefined) conflictingFields.push('content');
    if (input.blueprint !== undefined) conflictingFields.push('blueprint');
    if (input.sampler !== undefined) conflictingFields.push('sampler');
    // variants already checked above; if both set, variants wins the
    // dispatch — by the time we reach here, input.variants is undefined.
    if (conflictingFields.length > 0) {
      return makeToolJsonErrorResult(
        `flow-compile cannot be combined with single-scene input fields (${conflictingFields.join(', ')}). Flow requires its own steps[] array.`,
        'compile.input_mode_conflict',
        { conflictingFields },
      );
    }
    return handleFlowCompile(input.flow);
  }

  // ─── Sampler dispatch (Week 3 #25 Sampler kind) ─────────────
  if (input.sampler) {
    const conflictingFields: string[] = [];
    if (input.html !== undefined) conflictingFields.push('html');
    if (input.file !== undefined) conflictingFields.push('file');
    if (input.content !== undefined) conflictingFields.push('content');
    if (input.blueprint !== undefined) conflictingFields.push('blueprint');
    if (conflictingFields.length > 0) {
      return makeToolJsonErrorResult(
        `sampler-compile cannot be combined with single-scene input fields (${conflictingFields.join(', ')}). Sampler requires its own cells[] array.`,
        'compile.input_mode_conflict',
        { conflictingFields },
      );
    }
    return handleSamplerCompile(input.sampler);
  }

  const t0 = Date.now();
  const session = getSession();
  session.recordToolCall('compile');

  // ─── Deterministic binding: default `name` to the active canvas ──
  // When this MCP runs as a subprocess of the in-app agent, the sidecar
  // sets `REFRAME_ACTIVE_SCENE_SLUG=<slug>` on spawn. Without this
  // guard the model is free to invent a name from the prompt
  // ("pricing", "hero", …) and the compile creates a brand-new scene
  // instead of updating the canvas the user is looking at. The slug is
  // the source of truth for identity — same slug = same scene. Agents
  // can still compile to a NEW scene by explicitly passing `name:
  // "<something-else>"` (e.g. "-dark", "-v2") when the user asked for
  // a variant. No override when running standalone (no env var set).
  if (!input.name) {
    const activeSlug = process.env.REFRAME_ACTIVE_SCENE_SLUG;
    if (activeSlug) input.name = activeSlug;
  }

  // ─── Layout backend ──
  if (input.layoutBackend && input.layoutBackend !== 'yoga') {
    try {
      const { setLayoutBackend } = await import('../../../core/src/engine/yoga-init.js');
      setLayoutBackend(input.layoutBackend);
    } catch {
      // Already initialized or backend not available — ignore
    }
  }

  // ─── Normalize html → file → html (always go through disk) ──
  // When inline html is provided, persist it to .reframe/src/<name>.html FIRST,
  // then read it back via the file path. This ensures the source is always on
  // disk before compilation starts, and the flow is identical whether the caller
  // passed html or file.
  if (input.html && !input.file) {
    try {
      const sceneName = input.name ?? 'untitled';
      const nameParts = sceneName.split('/');
      const group = nameParts.length > 1 ? nameParts.slice(0, -1).join('/') : undefined;
      const leafName = nameParts[nameParts.length - 1];
      const srcSubDir = group ? join(getReframeDir(), 'src', group) : join(getReframeDir(), 'src');
      if (!existsSync(srcSubDir)) mkdirSync(srcSubDir, { recursive: true });
      const srcFileName = `${leafName}.html`;
      const srcPath = join(srcSubDir, srcFileName);
      writeFileSync(srcPath, input.html, 'utf-8');
      // Now switch to file-based flow
      input.file = srcPath;
    } catch {
      // If disk write fails, fall through with inline html as before
    }
  }
  if (input.file) {
    const filePath = input.file.includes(':') || input.file.startsWith('/')
      ? input.file
      : resolve(getWorkspaceRoot(), input.file);
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
      // Persist as activeBrand in project.json so subsequent forked MCP
      // calls (edit / inspect / export) read the same brand from disk
      // instead of falling back to whatever was last extracted globally.
      try {
        const projectDir = getWorkspaceRoot();
        const manifest = coreProjectIo().loadProject(projectDir);
        if (manifest.brands?.[input.brand]) {
          coreProjectIo().setActiveBrand(projectDir, input.brand);
        }
      } catch { /* best-effort */ }
    } else {
      return makeToolJsonErrorResult(
        `Brand "${input.brand}" not found. Use reframe_design (url/html/slug) or pass designMd.`,
        'compile.brand_not_found',
        { brand: input.brand },
      );
    }
  }
  // Brand fallback policy:
  //   - If the user passed raw HTML with no explicit brand, they are declaring
  //     their own design — do NOT silently re-theme it with whichever brand
  //     happened to be active on disk. (This used to convert neutral landings
  //     into Shopify-green overnight.)
  //   - For the compiler path (content/blueprint), DESIGN.md is REQUIRED, so
  //     fall back to session / project activeBrand to avoid a hard error.
  const needsBrandFallback = !input.designMd && !input.html;
  if (needsBrandFallback && session.activeDesignMd) {
    input.designMd = session.activeDesignMd;
  }
  if (needsBrandFallback && !input.designMd) {
    try {
      const projectDir = getWorkspaceRoot();
      const manifest = coreProjectIo().loadProject(projectDir);
      if (manifest.activeBrand) {
        const loaded = coreProjectIo().loadBrandFromProject(projectDir, manifest.activeBrand);
        if (loaded) {
          input.designMd = loaded.content;
          const ds = session.getOrParseDesignMd(loaded.content, parseDesignMd);
          session.setBrand(manifest.activeBrand, loaded.content, ds);
        }
      }
    } catch { /* best-effort */ }
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

  // ─── Inherit prior dimensions when re-compiling a known slug ─
  //
  // When the caller passes `file` + `name` without explicit
  // width/height AND a scene with that slug already exists in the
  // project, reuse the prior scene's dimensions. Without this, the
  // agent's typical "edit source HTML, recompile" loop drops the
  // canvas height back to the importer default (≈1080) on every
  // iteration — any scene taller than 1080 appears cropped + shows
  // fresh "content-overflow" warnings until the agent remembers to
  // pass height= every time. Explicit width/height still win.
  if (!input.width && !input.height && input.name) {
    try {
      const projectDir = getWorkspaceRoot();
      const manifest = coreProjectIo().loadProject(projectDir);
      const slugs = [input.name, input.name.split('/').pop()].filter(Boolean) as string[];
      const prior = manifest?.scenes?.find((s: any) => slugs.includes(s.slug) || slugs.includes(s.id));
      if (prior?.width && prior?.height) {
        input.width = prior.width;
        input.height = prior.height;
      }
    } catch { /* best effort — fall through to importer defaults */ }
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
  } else if (useBlueprint && input.blueprint) {
    // Blueprint path: pull dimensions from the blueprint root (w/h or width/height).
    // Reject 0/negative/missing explicitly instead of falling through to the
    // generic "provide width+height" error.
    const bp = input.blueprint as any;
    const bpW = bp.w ?? bp.width ?? 0;
    const bpH = bp.h ?? bp.height ?? 0;
    if (!bpW || !bpH || bpW <= 0 || bpH <= 0) {
      return makeToolJsonErrorResult(
        `Invalid blueprint dimensions: got width=${bpW}, height=${bpH}. Provide positive w/h on the blueprint root, or pass width+height at the top level.`,
        'compile.blueprint_dimensions_invalid',
        { width: bpW, height: bpH },
      );
    }
    sizes.push({
      width: bpW,
      height: bpH,
      name: input.name ?? 'Scene',
    });
  } else if (input.html || input.file) {
    // HTML import: use whichever explicit dimension the caller passed
    // (usually just `width` for a viewport hint) and let HUG resolve
    // the other axis. Falling back to 0/0 here meant importFromHtml
    // got `width: undefined` and leaned on `ctx.defaultWidth = 1920`
    // for every `position: absolute; right: Npx` resolution, so a
    // badge pinned with `right: 40px` to a card that actually lives
    // in a 1440 canvas ended up at `left: 1780` (1920 − 100 − 40)
    // instead of `left: 1300` (1440 − 100 − 40).
    sizes.push({
      width: input.width ?? 0,
      height: input.height ?? 0,
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
        // When the caller explicitly passed sizes[] (multi-size compile),
        // OR passed top-level width/height on the compile call, we treat
        // those as a HARD override on the root node. Without this the
        // HTML's inline `style="width:1440px"` ALWAYS wins — so a user
        // who calls `reframe_compile({ width: 1920 })` expecting a
        // 1920-wide render gets a 1440 scene with the HTML's own
        // wrapper dimensions. Explicit intent from the caller is the
        // stronger signal; the inline width is a default that the
        // caller overrides by asking for a different viewport.
        const isMultiSize = Array.isArray(input.sizes) && input.sizes.length > 0;
        const hasExplicitViewport = typeof input.width === 'number' || typeof input.height === 'number';
        const importResult = await importFromHtml(input.html!, {
          name: input.name,
          width: size.width || undefined,
          height: size.height || undefined,
          forceRootSize: isMultiSize || hasExplicitViewport,
          // Phase 1 round-trip: deterministic h:<hash> ids derived from DOM path.
          // Re-compiling the same source HTML yields the same node ids, so
          // reframe_edit operations survive source edits — the whole point of
          // having a programmable design runtime instead of a one-shot compiler.
          stableIds: true,
        });
        graph = importResult.graph;
        rootId = importResult.rootId;
        // Surface importer warnings inline (script/iframe/style stripping)
        if (importResult.stats.unsupported.length > 0) {
          for (const u of importResult.stats.unsupported) {
            sections.push(`  [!] importer: ${u}`);
          }
        }
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

    // Resolve `right:` / `bottom:` offsets on absolute children now
    // that both parent widths AND child HUG sizes have been finalized
    // by Yoga. The importer only had default dimensions to work with,
    // so badges pinned with `right: 40px` were computed against the
    // 100-default badge width instead of the HUG-measured content
    // width, landing them ~40px off their intended anchor.
    resolveDeferredAbsolutePositions(graph, rootId);

    // ── SEMANTIC CLASSIFICATION ────────────────────────────
    // Tag every node with a semantic role so downstream consumers
    // (inspect, edit, export, audit) can address slots by meaning
    // instead of by raw nodeId. Multi-slot mode picks up multiple
    // titles/CTAs/sections in long-form designs (emails, landings).
    let semanticSummary = '';
    try {
      const classifyResult = await classifyScene(graph, rootId, {
        designSystem: ds as any,
        multiSlot: true,
        // When aiClassify is enabled, use lower confidence threshold for
        // more aggressive role assignment (catches more nodes)
        ...(input.aiClassify ? { preserveExisting: false } : {}),
      });
      const dist = Object.entries(classifyResult.distribution)
        .filter(([k]) => k !== 'other')
        .sort(([, a], [, b]) => b - a)
        .map(([role, n]) => `${role}=${n}`)
        .join(', ');
      // When aiClassify enabled, also run the node-property detector to fill gaps
      // at a lower confidence threshold (catches buttons, badges, inputs the
      // frame-aware classifier misses)
      if (input.aiClassify) {
        const { autoDetectRoles } = await import('../../../core/src/semantic/index.js');
        const extraDetected = autoDetectRoles(graph, rootId, 0.4); // lower threshold
        classifyResult.classified += extraDetected;
      }

      const updatedDist = Object.entries(classifyResult.distribution)
        .filter(([k]) => k !== 'other')
        .sort(([, a], [, b]) => b - a)
        .map(([role, n]) => `${role}=${n}`)
        .join(', ');
      if (dist || updatedDist) {
        semanticSummary = `Semantic: ${updatedDist || dist} (${classifyResult.classified}/${classifyResult.candidates} nodes)${input.aiClassify ? ' [enhanced]' : ''}`;
      }
    } catch (err: any) {
      // Classifier is best-effort — never block compile if it fails.
      semanticSummary = `Semantic: skipped (${err?.message ?? 'unknown error'})`;
    }

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
          // Re-run layout before every audit pass. Auto-fix mutations
          // (padding, gap, font-weight) cascade through ancestor sizes,
          // and spatial rules (sibling-overlap, content-overflow) read
          // cached y/height — without a fresh Yoga pass they fire on
          // phantom collisions between top-level sections after brand
          // inheritance settles padding/font specs.
          //
          // Safe in compile.ts because `auditDs` is the brand passed to
          // THIS compile call, not the session-global activeBrand —
          // unlike the same trick in edit.ts which had to be reverted to
          // avoid cross-brand color-in-palette contamination.
          ensureSceneLayout(graph, rootId);
          const wrappedRoot = new StandaloneNode(graph, graph.getNode(rootId)!);
          return audit(wrappedRoot, rules, auditDs as any);
        },
        { autoFix: doAutoFix, maxPasses },
      );

      const errors = finalIssues.filter(i => i.severity === 'error');

      if (allFixed.length > 0) {
        // Collapse duplicate fixes: "contrast-minimum: auto-corrected" x6 → "contrast-minimum: auto-corrected (×6)"
        // Per-rule grouping: noisy rules like spacing-grid produce hundreds of
        // distinct messages ("left 124px → 128px", "left 292px → 296px", ...)
        // that drown the log. Collapse those into "spacing-grid: 752 grid
        // alignments" instead of listing every value pair.
        const NOISY_RULES = new Set(['spacing-grid']);
        const fixCounts = new Map<string, number>();
        const noisyCounts = new Map<string, number>();
        for (const f of allFixed) {
          const ruleName = f.split(':')[0];
          if (NOISY_RULES.has(ruleName)) {
            noisyCounts.set(ruleName, (noisyCounts.get(ruleName) ?? 0) + 1);
          } else {
            fixCounts.set(f, (fixCounts.get(f) ?? 0) + 1);
          }
        }
        const parts = [...fixCounts].map(([f, n]) => n > 1 ? `${f} (×${n})` : f);
        for (const [ruleName, n] of noisyCounts) {
          parts.push(`${ruleName}: ${n} grid alignments`);
        }
        auditSummary += `Auto-fixed: ${parts.join(', ')}\n`;
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

    // Brand resolution for the scene metadata (persisted on saveScene). Priority:
    //   1. Explicit brand passed to the compile call
    //   2. Session's active brand (set earlier by reframe_design or by brand lookup above)
    //   3. None — scene is brand-agnostic
    // The hash pins the scene to the exact DESIGN.md content it was compiled against
    // so subsequent loads can detect drift via detectBrandDrift().
    const resolvedBrand = input.brand || session.activeBrand || undefined;
    const resolvedBrandHash = input.designMd ? hashDesignMdContent(input.designMd) : undefined;

    const sceneId = storeScene(graph, rootId, undefined, {
      name: sceneName,
      brand: resolvedBrand,
      brandHash: resolvedBrandHash,
    });
    sceneIds.push(sceneId);
    autoSaveScene(sceneId, graph, rootId);

    session.trackImport(
      sceneId,
      sceneName,
      Math.round(root.width ?? size.width),
      Math.round(root.height ?? size.height),
      !!input.designMd,
    );

    // ── LINK SOURCE FILE TO SCENE ──────────────────────────
    // Source HTML was already persisted to disk before compilation (html→file normalization).
    // Here we just record the relative path + group on the stored scene for project tracking.
    if (input.html) {
      try {
        const nameParts = (input.name ?? sceneName).split('/');
        const group = nameParts.length > 1 ? nameParts.slice(0, -1).join('/') : undefined;
        const leafName = nameParts[nameParts.length - 1];
        const srcRelative = group ? `src/${group}/${leafName}.html` : `src/${leafName}.html`;
        const stored = getScene(sceneId);
        if (stored) {
          stored.sourceFile = srcRelative;
          stored.group = group;
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
          case 'png': {
            const { exportToRaster, initCanvasKit } = await import('../../../core/src/exporters/raster.js');
            await initCanvasKit();
            const pngBytes = await exportToRaster(graph, rootId, { format: 'png', scale: 1 });
            const { getExportsBaseDir: getPngDir } = await import('../store.js');
            const pngPath = require('path').join(getPngDir(), `${sceneName}.png`);
            require('fs').mkdirSync(require('path').dirname(pngPath), { recursive: true });
            require('fs').writeFileSync(pngPath, pngBytes);
            exportResults.png = `[binary ${pngBytes.length} bytes]`;
            break;
          }
          case 'pdf': {
            const { exportToPdf } = await import('../../../core/src/exporters/pdf.js');
            const pdfBytes = await exportToPdf(graph, rootId, { title: sceneName });
            const { getExportsBaseDir: getPdfDir } = await import('../store.js');
            const pdfPath = require('path').join(getPdfDir(), `${sceneName}.pdf`);
            require('fs').mkdirSync(require('path').dirname(pdfPath), { recursive: true });
            require('fs').writeFileSync(pdfPath, pdfBytes);
            exportResults.pdf = `[binary ${pdfBytes.length} bytes]`;
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

    if (semanticSummary) {
      sections.push(`    ${semanticSummary}`);
    }

    // Aesthetic quality score (quick, adds ~2ms)
    try {
      const { computeAestheticScore, scoreToRating } = await import('../../../core/src/aesthetic/index.js');
      const aesthetic = computeAestheticScore(graph, rootId);
      sections.push(`    Quality: ${Math.round(aesthetic.overall * 100)}% ${scoreToRating(aesthetic.overall)} (alignment:${Math.round(aesthetic.alignment * 100)} harmony:${Math.round(aesthetic.harmony * 100)} readability:${Math.round(aesthetic.readability * 100)})`);
    } catch { /* aesthetic scoring optional */ }

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

  const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }> =
    [{ type: 'text', text: sections.join('\n') }];

  // Inline PNG of the primary compiled scene so multimodal agents can see
  // what they just imported without an extra reframe_export round-trip.
  // Multi-size compiles preview the first size only to keep payloads small.
  if (input.preview !== false && sceneIds.length > 0) {
    const primaryId = sceneIds[0];
    const primary = getScene(primaryId);
    if (primary) {
      try {
        const image = await renderPreview(primary.graph, primary.rootId);
        if (image) content.push(image);
      } catch { /* additive — never block compile on preview failure */ }
    }
  }

  return { content };
}

// ─── Variants composition handler (Phase 0) ──────────────────
//
// N-scene compile with same-brand enforcement. Each scene runs through the
// existing single-scene pipeline via a recursive handleCompile call — no
// duplicated compile logic. Shared designMd is resolved once and forwarded
// to each scene to skip N× brand disk loads.
//
// Phase 0 constraint: all scenes[i].brand must be equal (or all undefined).
// Mismatched presence OR different brand strings → throw. Cross-brand
// variants = future extension activated by real user signal, not built
// pre-emptively.
//
// Response envelope: text-only JSON (no per-variant inline PNG — the caller
// renders the composition-level preview via CompositionRenderer). Each
// scene's full single-compile response is preserved verbatim so callers
// can extract per-scene audit / error / storedScene as needed.
async function handleVariantsCompile(input: { scenes: CompileInput[] }) {
  const { scenes } = input;

  // Defensive validation — schema already enforces min(2), but handler
  // may be called from non-validated paths (tests, internal refactors).
  if (!Array.isArray(scenes) || scenes.length < 2) {
    return makeToolJsonErrorResult(
      'variants-compile requires at least 2 scenes',
      'compile.variants.too_few',
      { count: scenes?.length ?? 0 },
    );
  }

  // Same-brand enforcement. Each scene's brand must match scenes[0].brand
  // exactly — including undefined=undefined (all scenes rely on session
  // brand or inline designMd). Mixed presence is a mismatch.
  const firstBrand = scenes[0].brand;
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].brand !== firstBrand) {
      return makeToolJsonErrorResult(
        'variants-compile requires same-brand across all scenes (Phase 0 constraint; cross-brand variants = future chat-signal activation)',
        'compile.variants.brand_mismatch',
        {
          brands: scenes.map(s => s.brand ?? null),
          firstBrand: firstBrand ?? null,
        },
      );
    }
  }

  // Per-scene designMd override guard. Phase 0 constraint: all variants
  // share brand AND designMd — shared designMd resolved once from the
  // common brand, forwarded to each scene. If a scene carries its own
  // designMd, the intent is ambiguous: is the shared version overridden
  // silently, kept, or is the caller testing two designMd's? Throw
  // explicitly. Per-variant designMd overrides = future chat-signal
  // activation when a real use-case appears (e.g. same brand, different
  // token overrides per variant).
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].designMd !== undefined) {
      return makeToolJsonErrorResult(
        `variants-compile: scene[${i}] carries an explicit designMd. Phase 0 requires all variants to share brand AND designMd (shared resolution). Per-scene designMd override = future signal activation.`,
        'compile.variants.custom_designmd_unsupported',
        { sceneIndex: i, name: scenes[i].name ?? null },
      );
    }
  }

  // Duplicate-name guard (on RESOLVED names = user-supplied OR auto-fill).
  // Each variant ends up under a scene slug via storeScene; duplicate
  // names silently overwrite earlier storage and lose the first variant.
  // Detect before any compile runs. Covers:
  //   explicit: [{name:'hero'}, {name:'hero'}]                → caught
  //   implicit collision: [{name:'variant-1'}, {}]            → caught
  //     (second auto-fills to 'variant-1', colliding with first)
  //   all-auto: [{}, {}, {}] → ['variant-0','variant-1','variant-2'] → clean
  const requestedNames = scenes.map((s, i) => s.name ?? `variant-${i}`);
  const seenNames = new Set<string>();
  for (const n of requestedNames) {
    if (seenNames.has(n)) {
      return makeToolJsonErrorResult(
        `variants-compile: duplicate scene name "${n}" — each variant must map to a unique scene slug (either pass distinct names or omit all to get auto-assigned variant-0/1/2…)`,
        'compile.variants.duplicate_name',
        { names: requestedNames },
      );
    }
    seenNames.add(n);
  }

  // Shared designMd resolution: single load, propagated to each scene
  // input that didn't supply one. Avoids N× loadBrandDesignMd calls.
  let sharedDesignMd: string | undefined;
  if (firstBrand) {
    const loaded = await loadBrandDesignMd(firstBrand);
    if (loaded) sharedDesignMd = loaded;
  }

  // Per-scene compile. Unique name per variant to avoid storeScene
  // collision. Preview forced off per-scene — composition caller renders
  // its own composite preview.
  const sceneResults: Array<{
    index: number;
    name: string;
    /**
     * INTENTIONAL: full MCP tool-response envelope, not extracted audit
     * body. Preserves everything the single-compile returned (audit
     * sections, error paths, stored-scene metadata, per-size results
     * when scene has sizes[]) so callers get one-to-one fidelity.
     * Parse `result.content[0].text` to get the human-readable compile
     * report. Do NOT "simplify" to just the audit body — that loses
     * error paths and stored-scene id.
     */
    result: Awaited<ReturnType<typeof handleCompile>>;
  }> = [];

  for (let i = 0; i < scenes.length; i++) {
    const base = scenes[i];
    const sceneInput: CompileInput = { ...base };
    // Propagate resolved designMd so the recursive handleCompile skips its
    // own loadBrandDesignMd + session.setBrand path. Clearing `brand` here
    // avoids N× idempotent session writes when all variants share a brand.
    if (sharedDesignMd) {
      if (!sceneInput.designMd) sceneInput.designMd = sharedDesignMd;
      sceneInput.brand = undefined;
    }
    sceneInput.name = requestedNames[i];
    sceneInput.preview = false;

    const result = await handleCompile(sceneInput);
    sceneResults.push({
      index: i,
      name: sceneInput.name,
      result,
    });
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            kind: 'variants',
            sharedBrand: firstBrand ?? null,
            scenes: sceneResults,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ─── Flow composition handler (Phase 0) ──────────────────────
//
// Compile N step scenes as a flow entity, write flow.json + init
// state.json on disk. Same constraints as variants: single brand,
// single designMd, distinct step names. Transitions default to linear
// when omitted (each step i gets a Next button going to i+1, last step
// has no outgoing transition).
//
// Flow is a first-class persisted entity (not URL-only). Scenes live
// under .reframe/scenes/ like any scene; the flow is a view over them
// written to .reframe/flows/<flowId>/. Editing a scene outside the flow
// context still affects the flow next time it mounts — scenes are
// shared with the project.
async function handleFlowCompile(input: {
  flowId: string;
  name?: string;
  steps: CompileInput[];
  transitions?: Array<{ from: number; to: number; label?: string; condition?: string }>;
}) {
  const { flowId, name, steps, transitions: transitionsOverride } = input;

  if (!flowId || typeof flowId !== 'string') {
    return makeToolJsonErrorResult(
      'flow-compile requires a non-empty flowId',
      'compile.flow.missing_id',
    );
  }

  if (!Array.isArray(steps) || steps.length < 2) {
    return makeToolJsonErrorResult(
      'flow-compile requires at least 2 steps',
      'compile.flow.too_few_steps',
      { count: steps?.length ?? 0 },
    );
  }

  // Same-brand enforcement — mirrors variants-compile.
  const firstBrand = steps[0].brand;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].brand !== firstBrand) {
      return makeToolJsonErrorResult(
        'flow-compile requires same-brand across all steps (Phase 0 constraint; cross-brand flows = future chat-signal activation)',
        'compile.flow.brand_mismatch',
        {
          brands: steps.map(s => s.brand ?? null),
          firstBrand: firstBrand ?? null,
        },
      );
    }
  }

  // Per-step designMd override guard — mirrors variants.
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].designMd !== undefined) {
      return makeToolJsonErrorResult(
        `flow-compile: step[${i}] carries an explicit designMd. Phase 0 requires all steps to share brand AND designMd. Per-step designMd override = future signal activation.`,
        'compile.flow.custom_designmd_unsupported',
        { stepIndex: i, name: steps[i].name ?? null },
      );
    }
  }

  // Duplicate-name guard on resolved names. Step slugs end up in
  // storeScene — collisions silently overwrite like variants.
  const requestedNames = steps.map((s, i) => s.name ?? `${flowId}-step-${i}`);
  const seenNames = new Set<string>();
  for (const n of requestedNames) {
    if (seenNames.has(n)) {
      return makeToolJsonErrorResult(
        `flow-compile: duplicate step name "${n}" — each step must map to a unique scene slug (pass distinct names or omit all to get auto-assigned <flowId>-step-0/1/2…)`,
        'compile.flow.duplicate_name',
        { names: requestedNames },
      );
    }
    seenNames.add(n);
  }

  // Shared designMd resolution.
  let sharedDesignMd: string | undefined;
  if (firstBrand) {
    const loaded = await loadBrandDesignMd(firstBrand);
    if (loaded) sharedDesignMd = loaded;
  }

  // Linear transitions default: step[i] → step[i+1] with "Next" label.
  // Caller overrides by passing explicit transitions.
  const transitions = transitionsOverride ?? (() => {
    const out: Array<{ from: number; to: number; label: string }> = [];
    for (let i = 0; i < steps.length - 1; i++) {
      out.push({ from: i, to: i + 1, label: 'Next' });
    }
    return out;
  })();

  // Per-step compile via existing single-scene handleCompile.
  const stepResults: Array<{
    index: number;
    name: string;
    result: Awaited<ReturnType<typeof handleCompile>>;
  }> = [];

  for (let i = 0; i < steps.length; i++) {
    const base = steps[i];
    const sceneInput: CompileInput = { ...base };
    if (sharedDesignMd) {
      if (!sceneInput.designMd) sceneInput.designMd = sharedDesignMd;
      sceneInput.brand = undefined;
    }
    sceneInput.name = requestedNames[i];
    sceneInput.preview = false;

    const result = await handleCompile(sceneInput);
    stepResults.push({
      index: i,
      name: sceneInput.name,
      result,
    });
  }

  // Write flow.json + initial state.json to .reframe/flows/<flowId>/.
  const { writeFlowSpec, writeFlowState, readFlowState } = await import('../../../core/src/project/flow-store.js');
  const projectDir = getWorkspaceRoot();
  const now = new Date().toISOString();

  try {
    writeFlowSpec(projectDir, {
      flowId,
      name,
      stepSceneIds: requestedNames,
      transitions,
      createdAt: now,
      updatedAt: now,
    });

    // Initialize state if absent; preserve existing state if re-compiling
    // the flow (author edits a step and re-runs — currentStep + data stick).
    const existing = readFlowState(projectDir, flowId);
    writeFlowState(projectDir, existing);
  } catch (err: any) {
    return makeToolJsonErrorResult(
      `flow-compile: failed to write flow spec to disk: ${err?.message ?? String(err)}`,
      'compile.flow.write_failed',
      { flowId, projectDir },
    );
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            kind: 'flow',
            flowId,
            name: name ?? null,
            sharedBrand: firstBrand ?? null,
            stepSceneIds: requestedNames,
            transitions,
            steps: stepResults,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ─── Sampler compile (Week 3 #25) ────────────────────────────
//
// Sampler = N×M grid of pre-compiled scene cells around one canonical
// composition. Use cases: catalog view, specimen showcase, brand × density
// × radius matrices. Same-brand invariant matches Flow.
//
// Cell slugs are NAMESPACED by samplerId — `${samplerId}-cell-${i}` for
// auto-named cells. Prevents cross-sampler collisions: two samplers
// auto-naming `cell-0` would otherwise share storage and overwrite each
// other on re-compile. The `compile.sampler.invalid_id` /
// `compile.sampler.reserved_id` regex guards prevent samplerIds that
// would themselves collide with the namespace pattern.
//
// Render strategy: skeleton-upfront + upgrade-on-click + LRU demote.
// See packages/editor/src/canvas-dom/sampler-renderer.ts for the
// canonical capability boundary doc.
async function handleSamplerCompile(input: {
  samplerId: string;
  name?: string;
  cells: CompileInput[];
  grid: {
    columns: number;
    rows?: number;
    gap?: number;
    cellWidth?: number;
    cellHeight?: number;
    labels?: string[];
  };
}) {
  const { samplerId, name, cells, grid } = input;

  if (!samplerId || typeof samplerId !== 'string') {
    return makeToolJsonErrorResult(
      'sampler-compile requires a non-empty samplerId',
      'compile.sampler.missing_id',
    );
  }

  // Strict id regex — alphanumeric + dash. Filesystem-safe (Linux/macOS/
  // Windows), URL-safe, easy to parse. Underscore intentionally excluded
  // to keep cell-namespace separator (`-cell-`) unambiguous.
  if (!/^[a-zA-Z0-9-]+$/.test(samplerId)) {
    return makeToolJsonErrorResult(
      `sampler-compile: samplerId "${samplerId}" must match /^[a-zA-Z0-9-]+$/`,
      'compile.sampler.invalid_id',
      { samplerId },
    );
  }

  // Reserved-pattern check — prevents samplerIds that would collide with
  // the cell namespace once expanded. e.g. samplerId="foo-cell" produces
  // cell slugs "foo-cell-cell-0" (legal but confusing); samplerId="cell-7"
  // collides with a hypothetical standalone scene named cell-7.
  if (samplerId.endsWith('-cell') || /^cell-\d+$/.test(samplerId)) {
    return makeToolJsonErrorResult(
      `sampler-compile: samplerId "${samplerId}" is reserved (must not end with "-cell" or match "cell-N" — collides with namespaced cell slugs)`,
      'compile.sampler.reserved_id',
      { samplerId },
    );
  }

  if (!Array.isArray(cells) || cells.length < 4) {
    return makeToolJsonErrorResult(
      'sampler-compile requires at least 4 cells (below this a grid is unnecessary)',
      'compile.sampler.too_few_cells',
      { count: cells?.length ?? 0 },
    );
  }

  // Grid validation — columns positive, rows × columns covers cells.
  if (!grid || typeof grid.columns !== 'number' || grid.columns < 1) {
    return makeToolJsonErrorResult(
      `sampler-compile: grid.columns must be a positive integer (got ${grid?.columns})`,
      'compile.sampler.invalid_grid',
      { grid },
    );
  }
  if (grid.rows !== undefined && grid.rows * grid.columns < cells.length) {
    return makeToolJsonErrorResult(
      `sampler-compile: grid.rows × grid.columns (${grid.rows}×${grid.columns} = ${grid.rows * grid.columns}) is smaller than cells.length (${cells.length})`,
      'compile.sampler.invalid_grid',
      { grid, cellCount: cells.length },
    );
  }
  if (grid.labels !== undefined && grid.labels.length !== cells.length) {
    return makeToolJsonErrorResult(
      `sampler-compile: grid.labels length (${grid.labels.length}) must match cells length (${cells.length})`,
      'compile.sampler.invalid_grid',
      { labelCount: grid.labels.length, cellCount: cells.length },
    );
  }

  // Same-brand enforcement — mirrors variants/flow.
  const firstBrand = cells[0].brand;
  for (let i = 1; i < cells.length; i++) {
    if (cells[i].brand !== firstBrand) {
      return makeToolJsonErrorResult(
        'sampler-compile requires same-brand across all cells (Phase 0 constraint; cross-brand sampler = future signal activation)',
        'compile.sampler.brand_mismatch',
        {
          brands: cells.map((c) => c.brand ?? null),
          firstBrand: firstBrand ?? null,
        },
      );
    }
  }

  // Per-cell designMd override guard — mirrors variants/flow.
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].designMd !== undefined) {
      return makeToolJsonErrorResult(
        `sampler-compile: cell[${i}] carries an explicit designMd. Phase 0 requires all cells to share brand AND designMd. Per-cell designMd override = future signal activation.`,
        'compile.sampler.custom_designmd_unsupported',
        { cellIndex: i, name: cells[i].name ?? null },
      );
    }
  }

  // Resolved namespaced cell names. Auto-name = `${samplerId}-cell-${i}`.
  // Duplicate guard runs on the resolved names so an explicit cell name
  // colliding with another cell's auto-fill is still caught.
  const requestedNames = cells.map((c, i) => c.name ?? `${samplerId}-cell-${i}`);
  const seenNames = new Set<string>();
  for (const n of requestedNames) {
    if (seenNames.has(n)) {
      return makeToolJsonErrorResult(
        `sampler-compile: duplicate cell name "${n}" — each cell must map to a unique scene slug (pass distinct names or omit all to get auto-assigned ${samplerId}-cell-0/1/2…)`,
        'compile.sampler.duplicate_name',
        { names: requestedNames },
      );
    }
    seenNames.add(n);
  }

  // Shared designMd resolution.
  let sharedDesignMd: string | undefined;
  if (firstBrand) {
    const loaded = await loadBrandDesignMd(firstBrand);
    if (loaded) sharedDesignMd = loaded;
  }

  // Per-cell compile via single-scene handleCompile.
  const cellResults: Array<{
    index: number;
    name: string;
    result: Awaited<ReturnType<typeof handleCompile>>;
  }> = [];

  for (let i = 0; i < cells.length; i++) {
    const base = cells[i];
    const sceneInput: CompileInput = { ...base };
    if (sharedDesignMd) {
      if (!sceneInput.designMd) sceneInput.designMd = sharedDesignMd;
      sceneInput.brand = undefined;
    }
    sceneInput.name = requestedNames[i];
    sceneInput.preview = false;

    const result = await handleCompile(sceneInput);
    cellResults.push({
      index: i,
      name: sceneInput.name,
      result,
    });
  }

  // Write sampler.json to .reframe/samplers/<samplerId>/.
  const { writeSamplerSpec } = await import('../../../core/src/project/sampler-store.js');
  const projectDir = getWorkspaceRoot();
  const now = new Date().toISOString();

  try {
    writeSamplerSpec(projectDir, {
      samplerId,
      name,
      sharedBrand: firstBrand,
      cellSceneIds: requestedNames,
      grid,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err: any) {
    return makeToolJsonErrorResult(
      `sampler-compile: failed to write sampler spec to disk: ${err?.message ?? String(err)}`,
      'compile.sampler.write_failed',
      { samplerId, projectDir },
    );
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            kind: 'sampler',
            samplerId,
            name: name ?? null,
            sharedBrand: firstBrand ?? null,
            cellSceneIds: requestedNames,
            cellCount: cells.length,
            grid,
            cells: cellResults,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ─── Brand DESIGN.md loader ──────────────────────────────────

const BRAND_ALIASES: Record<string, string> = {
  linear: 'linear.app', mistral: 'mistral.ai', xai: 'x.ai',
  together: 'together.ai', opencode: 'opencode.ai',
};

/** Fetch DESIGN.md by brand slug via npx getdesign. Caches in project .reframe/brands/. */
export async function loadBrandDesignMd(brand: string): Promise<string | null> {
  const brandKey = BRAND_ALIASES[brand.toLowerCase()] ?? brand.toLowerCase();

  // Check cache at BOTH possible locations:
  //   - workspace-rooted (compile time has resolved cwd)
  //   - getReframeDir-rooted (MCP sidecar may have a different cwd than the
  //     workspace root, in which case these diverge — previously the cache
  //     miss would force an npx fetch even though the file was on disk)
  const candidates = [
    join(getWorkspaceRoot(), '.reframe', 'brands', brandKey, 'DESIGN.md'),
    join(getReframeDir(), 'brands', brandKey, 'DESIGN.md'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      // Guard: a 0-byte or whitespace-only file is treated as a corrupted
      // cache entry — fall through to re-fetch rather than returning empty
      // content that confuses downstream parsers.
      if (content.trim().length > 0) return content;
    }
  }

  // Fetch via npm. Writes to workspace-rooted cache (authoritative).
  const outDir = join(getWorkspaceRoot(), '.reframe', 'brands', brandKey);
  const outFile = join(outDir, 'DESIGN.md');
  try {
    mkdirSync(outDir, { recursive: true });
    execSync(`npx getdesign add ${brandKey} --out "${outFile}"`, {
      timeout: 30000,
      stdio: 'pipe',
      shell: process.platform === 'win32' ? true : undefined as any,
    });
    if (existsSync(outFile)) {
      const content = readFileSync(outFile, 'utf-8');
      if (content.trim().length > 0) return content;
    }
  } catch {}

  return null;
}
