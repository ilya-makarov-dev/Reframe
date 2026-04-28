/**
 * reframe_export — Unified export tool.
 *
 * Unified export tool (replaces old per-format tools).
 * old export tools into a single tool with a `format` parameter.
 */

import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname, sep } from 'path';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { exportToReact, exportToReactTree } from '../../../core/src/exporters/react.js';
import { exportToAnimatedHtml } from '../../../core/src/exporters/animated-html.js';
import { exportToLottie } from '../../../core/src/exporters/lottie.js';
import { buildLottiePreviewHtml } from '../../../core/src/exporters/lottie-preview.js';
// transition exporter removed — was niche resize-preview animation
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { runWithHostAsync } from '../../../core/src/host/context.js';
import { validateTimeline, computeDuration } from '../../../core/src/animation/timeline.js';
import { presets, stagger as staggerFn, listPresets } from '../../../core/src/animation/presets.js';
import { buildTimeline as buildTimelineCore } from '../../../core/src/animation/timeline-builder.js';
import type { ITimeline, INodeAnimation } from '../../../core/src/animation/types.js';
import { exportToRaster, initCanvasKit } from '../../../core/src/exporters/raster.js';
import { exportSvgFromGraph } from '../engine.js';
import { resolveScene, getScene, getExportsBaseDir, getWorkspaceRoot } from '../store.js';
import { getSession } from '../session.js';
import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { makeToolJsonErrorResult } from '../tool-result.js';

// ─── Schema ───────────────────────────────────────────────────

export const exportInputSchema = {
  sceneId: z.string().describe('Scene ID to export.'),
  format: z.enum(['html', 'svg', 'png', 'pdf', 'react', 'lottie', 'video', 'pptx', 'bundle', 'react-spa'])
    .describe('Output format. `html` respects `animate:true` to embed the scene timeline as inline CSS keyframes / GSAP (replaces the old "animated_html" format). `video` produces an MP4 via hyperframes render (Puppeteer + FFmpeg). `pptx` emits a PowerPoint deck — one PNG-backed slide per scene (use sceneIds for multi-slide decks). Multi-page projects: call `reframe_export format=html` per scene — no "site" format needed.'),

  // HTML options
  fullDocument: z.boolean().optional().default(true),
  dataAttributes: z.boolean().optional().default(false),
  cssClasses: z.boolean().optional().default(false),

  // SVG options
  xmlDeclaration: z.boolean().optional().default(true),
  svgIncludeNames: z.boolean().optional().default(false).describe('Include node names as data attributes in SVG'),
  svgBackground: z.string().optional().describe('Optional background color (e.g. white, #fff)'),

  // React options
  componentName: z.string().optional(),
  typescript: z.boolean().optional().default(true),
  /**
   * React multi-file tree options. When any of these are truthy, the
   * exporter emits a file tree instead of a single component string.
   * The engine does the transformation deterministically — no LLM.
   */
  reactTree: z.boolean().optional().describe(
    'Emit a multi-file React project tree (sections split by semanticRole, entry page, tokens).'
    + ' Set to true for production-ready output; omit for the single-file dump.',
  ),
  reactTarget: z.enum(['inline', 'css-modules', 'tailwind', 'styled-components']).optional().describe(
    'Styling strategy for the emitted tree. "inline" + "css-modules" fully implemented;'
    + ' "tailwind" + "styled-components" accepted but currently fall back to inline + emit a config sketch.',
  ),
  reactExtractSections: z.boolean().optional().describe(
    'When reactTree is true, split top-level children with semanticRole into section files. Default: true.',
  ),
  reactExtractPrimitives: z.boolean().optional().describe(
    'Phase 2 (scaffolded) — shape-hash dedup into src/components/ui/. Currently no-op.',
  ),
  reactExtractHooks: z.boolean().optional().describe(
    'Phase 3 (scaffolded) — state-bearing nodes into src/hooks/. Currently no-op.',
  ),
  reactOutputBase: z.string().optional().describe('Root dir for emitted paths. Default: "src".'),
  reactPageSlug: z.string().optional().describe('Entry page filename stem. Default: derived from root node name.'),

  // PNG options
  scale: z.number().optional().default(1).describe('Scale factor for PNG (e.g. 2 for retina)'),

  // Animation (for animated_html and lottie formats)
  animate: z.object({
    presets: z.array(z.object({
      nodeName: z.string(),
      preset: z.string(),
      delay: z.number().optional().describe('ms before animation starts'),
      duration: z.number().optional().describe('ms duration override'),
      easing: z.string().optional().describe('EasingPreset override — e.g. "ease-out-cubic", "ease-out-back", "ease-out-elastic", "ease-out-expo", or any named preset in EasingPreset. Passed through to preset keyframes.'),
      distance: z.number().optional().describe('px distance override for slide/reveal presets (slideInLeft/Right/Up/Down, revealLeft/Up). Ignored by non-translate presets.'),
    })).optional(),
    stagger: z.object({
      nodeNames: z.array(z.string()),
      preset: z.string(),
      staggerDelay: z.number().optional().default(100),
      duration: z.number().optional().describe('ms duration override applied to every staggered node'),
      easing: z.string().optional().describe('EasingPreset override applied to every staggered node'),
      distance: z.number().optional().describe('px distance override for slide/reveal presets'),
    }).optional(),
    sequences: z.array(z.object({
      nodeName: z.string(),
      chain: z.array(z.object({
        preset: z.string(),
        duration: z.number().optional(),
        easing: z.string().optional(),
        distance: z.number().optional(),
      })).min(2).describe('Two or more presets played back-to-back on the same node. Next step starts after previous ends (minus overlap).'),
      delay: z.number().optional().describe('ms before the first step starts'),
      overlap: z.number().optional().default(0).describe('ms of overlap between consecutive steps. 0 = pure sequence (next starts when previous ends). 200 = 200ms cross-over. Negative allowed for gap.'),
    })).optional().describe('Compose multiple presets per node. Common uses: `[fadeIn, pulse]` for "enter then attract attention", `[slideInUp, shake]` for "enter then punch". Cumulative delays computed automatically.'),
    loop: z.boolean().optional().default(false),
    speed: z.number().optional().default(1),
  }).optional().describe('Animation config — required for `format: lottie`. For `format: html`, passing this config makes the output animated HTML (GSAP + timeline scrub); omit for plain static HTML. Three composition modes: `presets[]` (single preset per node), `stagger` (same preset across N nodes with delay), `sequences[]` (multiple presets per node with cumulative timing).'),

  controls: z.boolean().optional().default(true).describe('Include play/pause controls when `format: html` has an `animate` config.'),

  // Video options (format: 'video')
  renderVideo: z.boolean().optional().default(false).describe(
    'For format="video" only: spawn `npx hyperframes render` after emitting the composition HTML and return the MP4 path. Requires hyperframes CLI installed (npx fetches on first run; ~100 MB Chromium download on first invocation). Default false — returns the HTML + CLI command for the caller to run.',
  ),
  videoFps: z.number().optional().default(30).describe('For format="video" with renderVideo: frames per second. Default 30.'),
  videoQuality: z.enum(['draft', 'standard', 'high']).optional().default('standard').describe('For format="video" with renderVideo: encoder quality preset. Default "standard".'),

  // Bundle options (T2 #26)
  tweakable: z.boolean().optional().default(false).describe(
    'For format="bundle" only: emit an end-user tweak surface (sliders + color pickers persisted via localStorage) for tokens listed under `## Tweak Surface` in the brand DESIGN.md. Default false — bundle output stays byte-identical to non-tweakable build. Brands without a tweak surface section are no-op (warning logged).',
  ),
};

// ─── Timeline builder ─────────────────────────────────────────
// Moved to @reframe/core `packages/core/src/animation/timeline-builder.ts`
// so standalone consumers (CLI, tests, embedded pipelines) can build
// timelines without pulling in the MCP tool layer. This wrapper keeps
// the internal signature intact for call sites in this file.

function buildTimeline(
  graph: SceneGraph,
  rootId: string,
  animateConfig: {
    presets?: Array<{ nodeName: string; preset: string; delay?: number; duration?: number; easing?: string; distance?: number }>;
    stagger?: { nodeNames: string[]; preset: string; staggerDelay?: number; duration?: number; easing?: string; distance?: number };
    sequences?: Array<{
      nodeName: string;
      chain: Array<{ preset: string; duration?: number; easing?: string; distance?: number }>;
      delay?: number;
      overlap?: number;
    }>;
    loop?: boolean;
    speed?: number;
  },
): { timeline: ITimeline; warnings: string[] } {
  return buildTimelineCore(graph, rootId, animateConfig);
}

// ─── Handler ──────────────────────────────────────────────────

export async function handleExport(input: {
  sceneId: string;
  /** Comma-separated list of sceneIds to include as additional slides (pptx only). */
  sceneIds?: string;
  format: 'html' | 'svg' | 'png' | 'pdf' | 'react' | 'lottie' | 'video' | 'pptx' | 'bundle' | 'react-spa';
  fullDocument?: boolean;
  dataAttributes?: boolean;
  cssClasses?: boolean;
  xmlDeclaration?: boolean;
  svgIncludeNames?: boolean;
  svgBackground?: string;
  componentName?: string;
  typescript?: boolean;
  reactTree?: boolean;
  reactTarget?: 'inline' | 'css-modules' | 'tailwind' | 'styled-components';
  reactExtractSections?: boolean;
  reactExtractPrimitives?: boolean;
  reactExtractHooks?: boolean;
  reactOutputBase?: string;
  reactPageSlug?: string;
  scale?: number;
  animate?: {
    presets?: Array<{ nodeName: string; preset: string; delay?: number; duration?: number }>;
    stagger?: { nodeNames: string[]; preset: string; staggerDelay?: number };
    loop?: boolean;
    speed?: number;
  };
  controls?: boolean;
  renderVideo?: boolean;
  videoFps?: number;
  videoQuality?: 'draft' | 'standard' | 'high';
  tweakable?: boolean;
}) {
  const { format, sceneId } = input;

  // ─── react-spa: dispatch BEFORE scene resolution ───────────
  // Phase 0 scope: Flow-only. The `sceneId` arg is interpreted as a
  // flowId (flows live under .reframe/flows/<flowId>/, sibling to
  // scenes/). Single-scene → use format='bundle'; variants/sampler
  // throw composition.unsupported.
  if (format === 'react-spa') {
    return await handleReactSpaExport(sceneId);
  }

  // ─── 1. Resolve scene ───────────────────────────────────────
  let graph: SceneGraph;
  let rootId: string;

  try {
    ({ graph, rootId } = resolveScene({ sceneId }));
  } catch (err: any) {
    return { content: [{ type: 'text' as const, text: err.message }] };
  }

  ensureSceneLayout(graph, rootId);

  return runWithHostAsync(new StandaloneHost(graph), async () => {
  const sections: string[] = [];

  // ─── 2. Session tracking ────────────────────────────────────
  const session = getSession();
  session.recordToolCall('export');
  session.trackExport(sceneId, format);

  // ─── 3. Build timeline for animated formats ─────────────────
  let timeline: ITimeline | null = null;

  // Animation config drives two routes:
  //   `format: 'lottie'` — mandatory (timeline baked into Lottie JSON)
  //   `format: 'html'` with `animate:{...}` — embeds GSAP timeline into
  //      the emitted HTML (replaces the old `format: 'animated_html'`)
  const wantsAnimation = (format === 'lottie') || (format === 'html' && !!input.animate);
  if (wantsAnimation && input.animate) {
    const built = buildTimeline(graph, rootId, input.animate);
    const errors = validateTimeline(built.timeline);

    for (const w of built.warnings) {
      sections.push(`[!] ${w}`);
    }

    if (errors.length > 0) {
      sections.unshift(`✗ EXPORT FAILED (${format})`);
      sections.push(`Timeline validation errors: ${errors.join(', ')}`);
      sections.push('No file was written. Fix the animation config above and re-run.');
      return {
        content: [{ type: 'text' as const, text: sections.join('\n'), isError: true } as any],
      };
    }

    if (built.timeline.animations.length === 0) {
      sections.unshift(`✗ EXPORT FAILED (${format})`);
      sections.push('No valid animations produced (check node names and preset names above).');
      sections.push('No file was written.');
      return {
        content: [{ type: 'text' as const, text: sections.join('\n'), isError: true } as any],
      };
    }

    timeline = built.timeline;
    session.trackAnimate(sceneId);
    const duration = computeDuration(timeline);
    sections.push(
      `Animation: ${timeline.animations.length} animation${timeline.animations.length > 1 ? 's' : ''}, ` +
      `${duration}ms${timeline.loop ? ' (loop)' : ''}`,
    );
  } else if (format === 'lottie' && !input.animate) {
    return {
      content: [{
        type: 'text' as const,
        text: `Format "${format}" requires an \`animate\` config. Provide presets or stagger animations.`,
      }],
    };
  }

  // ─── 4. Export by format ────────────────────────────────────
  let content: string;

  try {
    switch (format) {
      case 'html': {
        // When `animate` config is provided, route to the animated-HTML
        // exporter (timeline → GSAP + CSS keyframes). Otherwise plain
        // static HTML. Replaces the old `format: 'animated_html'` split.
        if (timeline) {
          content = exportToAnimatedHtml(graph, rootId, timeline, {
            fullDocument: true,
            controls: input.controls ?? true,
          });
        } else {
          content = exportToHtml(graph, rootId, {
            fullDocument: input.fullDocument ?? true,
            dataAttributes: input.dataAttributes ?? false,
            cssClasses: input.cssClasses ?? false,
          });
        }
        break;
      }

      case 'bundle': {
        // Single-file portable HTML — fonts + images inlined as data
        // URIs. Foundation for #20 stateful prototype + #26 always-on
        // tweaks. Async because the inliners issue network fetches.
        const { exportSceneGraphToBundle } = await import('../../../core/src/exporters/bundle.js');

        // T2 #26: when tweakable=true, load the brand DESIGN.md so the
        // bundle exporter can read tweakSurface + resolve initial token
        // values. Brand slug comes from the stored scene metadata; if
        // absent (scene has no brand), tweakable=true is a no-op with
        // a warning logged inside the bundle exporter.
        let designSystem: import('../../../core/src/design-system/types.js').DesignSystem | undefined;
        if (input.tweakable) {
          const stored = getScene(sceneId);
          const brandSlug = stored?.brand;
          if (brandSlug) {
            try {
              const dsmdPath = join(getWorkspaceRoot(), '.reframe', 'brands', brandSlug, 'DESIGN.md');
              if (existsSync(dsmdPath)) {
                const md = readFileSync(dsmdPath, 'utf-8');
                const { parseDesignMd } = await import('../../../core/src/design-system/parser.js');
                designSystem = parseDesignMd(md);
              }
            } catch (err: any) {
              console.warn(`[export bundle tweakable] failed to load DESIGN.md for brand "${brandSlug}":`, err?.message ?? err);
            }
          }
        }

        const result = await exportSceneGraphToBundle(graph, rootId, {
          projectDir: getWorkspaceRoot(),
          tweakable: input.tweakable === true,
          designSystem,
        });
        content = result.html;
        // Surface warnings via the inline summary line emitted later.
        if (result.warnings.length > 0) {
          (input as any)._bundleWarnings = result.warnings;
        }
        break;
      }

      case 'svg': {
        content = exportSvgFromGraph(graph, rootId, {
          xmlDeclaration: input.xmlDeclaration ?? true,
          includeNames: input.svgIncludeNames ?? false,
          background: input.svgBackground,
        });
        break;
      }

      case 'react': {
        const wrappedRoot = new StandaloneNode(graph, graph.getNode(rootId)!);

        // Multi-file tree mode — writes a whole src/ tree to disk.
        // Opt-in via reactTree: true OR presence of any tree-specific
        // option (treat those as implicit enablement to reduce API surface).
        const wantsTree =
          input.reactTree === true
          || input.reactTarget !== undefined
          || input.reactExtractSections !== undefined
          || input.reactExtractPrimitives !== undefined
          || input.reactExtractHooks !== undefined
          || input.reactOutputBase !== undefined
          || input.reactPageSlug !== undefined;

        if (wantsTree) {
          const stored = getScene(sceneId);
          const slug = input.reactPageSlug ?? stored?.slug ?? sceneId;
          const result = exportToReactTree(wrappedRoot, {
            componentName: input.componentName,
            typescript: input.typescript ?? true,
            target: input.reactTarget ?? 'inline',
            extractSections: input.reactExtractSections,
            extractPrimitives: input.reactExtractPrimitives,
            extractHooks: input.reactExtractHooks,
            outputBase: input.reactOutputBase ?? 'src',
            pageSlug: slug,
          });

          // Materialize the file tree under .reframe/exports/<slug>-react/.
          // Keeps outputs scoped per-scene so multiple react exports don't
          // stomp each other.
          const exportDir = getExportsBaseDir();
          if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
          const treeRoot = join(exportDir, `${slug}-react`);
          if (!existsSync(treeRoot)) mkdirSync(treeRoot, { recursive: true });

          let fileCount = 0;
          for (const [relP, body] of Object.entries(result.files)) {
            const abs = join(treeRoot, relP.replace(/\//g, sep));
            const dir = dirname(abs);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(abs, body);
            fileCount++;
          }

          const sectionLines = result.manifest.sections
            .map((s) => `  · ${s.name} (${s.role ?? 'no-role'}) → ${s.path}`)
            .join('\n');
          const noteLines = result.manifest.notes.length > 0
            ? '\n\nNotes:\n  · ' + result.manifest.notes.join('\n  · ')
            : '';

          return {
            content: [{
              type: 'text' as const,
              text:
                `React tree exported → ${treeRoot} (${fileCount} files, target=${result.manifest.target})`
                + `\n\nEntry: ${result.entry}`
                + (sectionLines ? `\nSections:\n${sectionLines}` : '\n(No sections extracted — entry file contains full scene inline.)')
                + (result.manifest.tokensPath ? `\nTokens: ${result.manifest.tokensPath}` : '')
                + noteLines,
            }],
          };
        }

        content = exportToReact(wrappedRoot, {
          componentName: input.componentName,
          typescript: input.typescript ?? true,
        });
        break;
      }

      case 'png': {
        // PNG export via CanvasKit WASM — binary output, early return
        try {
          await initCanvasKit();
          const pngBytes = await exportToRaster(graph, rootId, {
            format: 'png',
            scale: input.scale ?? 1,
          });

          // Write binary to .reframe/exports/
          const pngStored = getScene(sceneId);
          const pngSlug = pngStored?.slug ?? sceneId;
          const pngExportDir = getExportsBaseDir();
          if (!existsSync(pngExportDir)) mkdirSync(pngExportDir, { recursive: true });
          const pngPath = join(pngExportDir, `${pngSlug}.png`);
          writeFileSync(pngPath, pngBytes);

          const w = Math.ceil(graph.getNode(rootId)!.width * (input.scale ?? 1));
          const h = Math.ceil(graph.getNode(rootId)!.height * (input.scale ?? 1));
          const text = `PNG exported → ${pngPath} (${pngBytes.length} bytes, ${w}×${h}px)`;

          // Return the rendered image inline as an MCP image content block
          // when it's small enough. This lets multimodal agents SEE the
          // result of their design pass in the tool response, without a
          // separate Read call. Two caps: 1.5 MB base64 and 2000 px on
          // either axis. The dimension cap matches _preview.ts — chat UIs
          // reject images taller/wider than 2000 px even when the byte
          // payload is small (a 2880×13600 long-scroll export is 1.4 MB
          // but still breaks the session on the receiving end).
          const INLINE_LIMIT = 1_500_000;
          const INLINE_MAX_DIMENSION = 2000;
          const exceedsDim = w > INLINE_MAX_DIMENSION || h > INLINE_MAX_DIMENSION;
          if (exceedsDim) {
            return {
              content: [{
                type: 'text' as const,
                text: `${text}\n(image omitted — ${w}×${h}px exceeds ${INLINE_MAX_DIMENSION}px inline dimension cap; open the file to view)`,
              }],
            };
          }
          if (pngBytes.length <= INLINE_LIMIT) {
            // Convert Uint8Array → base64 without blowing the node stack
            // on large buffers. Buffer.from is zero-copy over the same
            // underlying memory; toString('base64') streams the encoding.
            const base64 = Buffer.from(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength).toString('base64');
            return {
              content: [
                { type: 'image' as const, data: base64, mimeType: 'image/png' },
                { type: 'text' as const, text },
              ],
            };
          }

          return {
            content: [{ type: 'text' as const, text: `${text}\n(image omitted — ${pngBytes.length} bytes exceeds ${INLINE_LIMIT} inline limit)` }],
          };
        } catch (pngErr: any) {
          return makeToolJsonErrorResult(
            `PNG export failed: ${pngErr.message}`,
            'export.png.failed',
            { cause: pngErr.message },
          );
        }
      }

      case 'pdf': {
        // PDF export via CanvasKit → PNG → PDF wrapper
        try {
          const { exportToPdf } = await import('../../../core/src/exporters/pdf.js');
          const pdfBytes = await exportToPdf(graph, rootId, {
            title: getScene(sceneId)?.name ?? sceneId,
          });

          const pdfStored = getScene(sceneId);
          const pdfSlug = pdfStored?.slug ?? sceneId;
          const pdfExportDir = getExportsBaseDir();
          if (!existsSync(pdfExportDir)) mkdirSync(pdfExportDir, { recursive: true });
          const pdfPath = join(pdfExportDir, `${pdfSlug}.pdf`);
          writeFileSync(pdfPath, pdfBytes);

          return {
            content: [{
              type: 'text' as const,
              text: `PDF exported → ${pdfPath} (${pdfBytes.length} bytes)`,
            }],
          };
        } catch (pdfErr: any) {
          return makeToolJsonErrorResult(
            `PDF export failed: ${pdfErr.message}`,
            'export.pdf.failed',
            { cause: pdfErr.message },
          );
        }
      }

      case 'lottie': {
        const lottie = exportToLottie(graph, rootId, timeline!);
        content = JSON.stringify(lottie);
        break;
      }

      case 'video': {
        // Hyperframes composition — emit the HTML shape that `npx
        // hyperframes render <dir>` consumes. We write the composition
        // as `<slug>-video/index.html` + pass back the directory path
        // + the CLI command the user runs to produce MP4. The render
        // itself is NOT invoked here: it needs hyperframes CLI installed
        // globally (or via npx) + runtime Puppeteer + FFmpeg, all of
        // which are caller-side concerns. This exporter's job is the
        // adapter (INode → hyperframes shape); the pipeline stays
        // out-of-process so we don't drag Chromium into the MCP
        // sidecar.
        const { exportToHyperframes } = await import('../../../core/src/exporters/hyperframes.js');
        const storedForVideo = getScene(sceneId);
        const videoResult = exportToHyperframes(graph, rootId, {
          compositionId: storedForVideo?.slug ?? sceneId,
          timeline: timeline ?? null,
        });
        content = videoResult.html;
        break;
      }

      case 'pptx': {
        // PPTX is binary like PNG — write the file ourselves and
        // return a text summary. Multi-slide decks: `input.sceneIds`
        // carries a comma-separated list to include as extra slides
        // beyond the primary sceneId. Order follows the list.
        const { exportToPptx } = await import('../../../core/src/exporters/pptx.js');
        const extraIds = (input.sceneIds || '')
          .split(',').map(s => s.trim()).filter(Boolean)
          .filter(id => id !== sceneId);
        const pptScenes: Array<{ graph: SceneGraph; rootId: string; title?: string }> = [];
        pptScenes.push({ graph, rootId, title: (getScene(sceneId)?.name || sceneId) });
        for (const id of extraIds) {
          try {
            const resolved = resolveScene({ sceneId: id });
            ensureSceneLayout(resolved.graph, resolved.rootId);
            const scn = getScene(id);
            pptScenes.push({ graph: resolved.graph, rootId: resolved.rootId, title: scn?.name || id });
          } catch (e: any) {
            sections.push(`[!] skipped ${id} — ${e?.message ?? e}`);
          }
        }

        const pptxBuf = await exportToPptx(pptScenes, {
          deckTitle: getScene(sceneId)?.name,
          author: 'reframe',
          scale: input.scale ?? 2,
        });

        const pptxStored = getScene(sceneId);
        const pptxSlug = pptxStored?.slug ?? sceneId;
        const pptxExportDir = getExportsBaseDir();
        if (!existsSync(pptxExportDir)) mkdirSync(pptxExportDir, { recursive: true });
        const pptxPath = join(pptxExportDir, `${pptxSlug}.pptx`);
        writeFileSync(pptxPath, pptxBuf);

        const sizeKB = (pptxBuf.length / 1024).toFixed(1);
        sections.unshift(`PPTX exported → ${pptxPath} (${pptScenes.length} slide${pptScenes.length === 1 ? '' : 's'}, ${sizeKB}KB)`);
        return { content: [{ type: 'text' as const, text: sections.join('\n') }] };
      }

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown format: ${format}` }],
        };
    }
  } catch (err: any) {
    const message = `Export error (${format}): ${err.message}`;
    return makeToolJsonErrorResult(message, 'export.failed', { format, cause: err.message });
  }

  // ─── 5. Auto-save to file + return result ──────────────────
  const stored = getScene(sceneId);
  const slug = stored?.slug ?? sceneId;

  // Auto-save exported file to .reframe/exports/
  const extMap: Record<string, string> = {
    html: 'html', svg: 'svg', react: 'tsx',
    lottie: 'lottie.json', png: 'png', pdf: 'pdf',
    // video-format writes a directory, not an extension'd file (see below)
    video: 'html',
    // pptx returns inside its case branch (binary); this entry is for
    // completeness so TS `extMap[format]` is never undefined.
    pptx: 'pptx',
  };
  const ext = extMap[format] ?? format;
  const exportDir = getExportsBaseDir();
  if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
  // video: hyperframes wants `<projectDir>/index.html`, not a loose file.
  // Emit the composition into `<slug>-video/index.html` so callers can
  // run `npx hyperframes render <dir> -o out.mp4` directly.
  let filePath: string;
  if (format === 'video') {
    const videoDir = join(exportDir, `${slug}-video`);
    if (!existsSync(videoDir)) mkdirSync(videoDir, { recursive: true });
    filePath = join(videoDir, 'index.html');
  } else {
    filePath = join(exportDir, `${slug}.${ext}`);
  }
  try {
    writeFileSync(filePath, content, 'utf-8');
  } catch {}

  // Lottie: also write a self-contained preview HTML with lottie-web player
  let lottiePreviewPath: string | undefined;
  if (format === 'lottie') {
    const previewName = `${slug}.lottie.preview.html`;
    lottiePreviewPath = join(exportDir, previewName);
    try {
      const lottieJson = JSON.parse(content);
      const previewHtml = buildLottiePreviewHtml(lottieJson, stored?.name ?? slug);
      writeFileSync(lottiePreviewPath, previewHtml, 'utf-8');
    } catch {}
  }

  // Video: optional auto-render. Spawns `npx hyperframes render` — blocking
  // child_process call. First invocation downloads ~100 MB Chromium;
  // subsequent ~15 s for a 2 s composition at 30 fps. We don't want
  // Chromium + Puppeteer inside the MCP sidecar itself (keeps the in-
  // process memory / startup surface sane), so we shell out. Telemetry
  // is disabled repo-wide (see `npx hyperframes telemetry disable` in
  // Fix log 2026-04-22 entry).
  let videoMp4Path: string | undefined;
  let videoRenderError: string | undefined;
  if (format === 'video' && input.renderVideo) {
    const { spawnSync } = await import('child_process');
    const videoDir = filePath.replace(/[\\/]index\.html$/, '');
    videoMp4Path = join(videoDir, `${slug}.mp4`);
    const fps = String(input.videoFps ?? 30);
    const quality = input.videoQuality ?? 'standard';
    // `npx --yes hyperframes render <dir> -o <out> --fps N --quality Q`.
    // Windows spawn quirks: use shell:true so the global npx shim
    // resolves; args array keeps the path quoting safe.
    const result = spawnSync('npx', ['--yes', 'hyperframes', 'render', videoDir, '-o', videoMp4Path, '--fps', fps, '--quality', quality], {
      encoding: 'utf-8',
      shell: true,
      timeout: 300000, // 5 min cap — first-run Chrome download + real render
    });
    if (result.status !== 0 || !existsSync(videoMp4Path)) {
      videoRenderError = result.stderr?.split('\n').slice(-10).join('\n')
        || result.stdout?.split('\n').slice(-5).join('\n')
        || 'hyperframes render failed without stderr';
      videoMp4Path = undefined;
    }
  }

  const absPath = filePath.replace(/\\/g, '/');
  // Per-format preview URL. HTML/SVG/TSX get a distinct live-rendered
  // endpoint (`/preview/<id>.svg`, `.tsx`, etc.) so opening any one
  // doesn't overwrite another in the browser tab, and static formats
  // that browsers can't render (Lottie, PNG binary, animated_html
  // keyframes) point at the file on disk instead.
  const previewExtMap: Record<string, string | null> = {
    html: '',
    svg: '.svg',
    react: '.tsx',
    lottie: '.lottie',
    png: null,            // no live render — link to file
    pdf: null,
    video: null,
    pptx: null,           // binary zip — browser can't render, download only
  };
  let previewUrl: string;
  if (previewExtMap[format] == null) {
    previewUrl = `file:///${absPath.replace(/\\/g, '/')}`;
  } else {
    previewUrl = `http://localhost:4100/preview/${sceneId}${previewExtMap[format]}`;
  }
  const displayFileName = filePath.split(/[\\/]/).pop() ?? slug;
  sections.push(`Exported **${slug}** (${format})  ${previewUrl} → [${displayFileName}](${absPath}) (${(content.length / 1024).toFixed(1)}KB)`);
  if (format === 'video') {
    const videoDir = filePath.replace(/[\\/]index\.html$/, '').replace(/\\/g, '/');
    if (videoMp4Path) {
      const mp4Abs = videoMp4Path.replace(/\\/g, '/');
      const { statSync: _stat } = await import('fs');
      let mp4Size = '?';
      try { mp4Size = `${(_stat(videoMp4Path).size / 1024).toFixed(1)}KB`; } catch {}
      sections.push(`  → rendered: [${slug}.mp4](${mp4Abs}) (${mp4Size})`);
    } else if (videoRenderError) {
      sections.push(`  → render failed: ${videoRenderError.split('\n').slice(0, 3).join(' · ')}`);
      sections.push(`  → retry manually: \`npx hyperframes render ${videoDir} -o ${videoDir}/${slug}.mp4 --fps 30\``);
    } else {
      sections.push(`  → run: \`npx hyperframes render ${videoDir} -o ${videoDir}/${slug}.mp4 --fps 30\``);
    }
  }
  if (lottiePreviewPath) {
    const previewAbs = lottiePreviewPath.replace(/\\/g, '/');
    sections.push(`  → [${slug}.lottie.preview.html](${previewAbs}) (open in browser to play)`);
  }

  return {
    content: [{ type: 'text' as const, text: sections.join('\n') }],
  };
  });
}

// ─── React-SPA dispatch (#20 Stateful prototype) ─────────────
//
// Loads a Flow spec from .reframe/flows/<flowId>/, plus each step scene
// from .reframe/scenes/<slug>.scene.json + initial state, then hands off
// to exportFlowToReactSpa. Phase 0 scope = Flow only. Single-scene
// callers should use format='bundle'; variants/sampler are
// composition-mismatched.

async function handleReactSpaExport(flowId: string) {
  const projectDir = getWorkspaceRoot();
  if (!projectDir) {
    return makeToolJsonErrorResult(
      'react-spa export requires an open project (no workspace root).',
      'export.react-spa.no_project',
    );
  }
  const fs = await import('node:fs');
  const path = await import('node:path');

  // Detect composition mismatch — single-scene + variants + sampler all
  // throw the same code with format hints.
  const sceneFile = path.join(projectDir, '.reframe', 'scenes', `${flowId}.scene.json`);
  if (fs.existsSync(sceneFile)) {
    return makeToolJsonErrorResult(
      `react-spa expects a flowId; "${flowId}" resolves to a single scene. Use format='bundle' for single-scene portable HTML.`,
      'export.react-spa.unsupported_composition',
      { resolvedAs: 'single', hint: "format='bundle'" },
    );
  }
  const samplerSpec = path.join(projectDir, '.reframe', 'samplers', flowId, 'sampler.json');
  if (fs.existsSync(samplerSpec)) {
    return makeToolJsonErrorResult(
      `react-spa cannot export a sampler grid as a stateful SPA (no per-cell state model in Phase 0). "${flowId}" resolves to a sampler.`,
      'export.react-spa.unsupported_composition',
      { resolvedAs: 'sampler' },
    );
  }

  const { readFlowSpec, readFlowState } = await import('../../../core/src/project/flow-store.js');
  const spec = readFlowSpec(projectDir, flowId);
  if (!spec) {
    return makeToolJsonErrorResult(
      `Flow "${flowId}" not found at ${path.join(projectDir, '.reframe', 'flows', flowId, 'flow.json')}.`,
      'export.react-spa.flow_not_found',
      { flowId },
    );
  }
  const state = readFlowState(projectDir, flowId);

  // Load each step scene from disk.
  const { deserializeScene } = await import('../../../core/src/serialize.js');
  const steps: Array<{ graph: any; rootId: string }> = [];
  for (const slug of spec.stepSceneIds) {
    const stepPath = path.join(projectDir, '.reframe', 'scenes', `${slug}.scene.json`);
    if (!fs.existsSync(stepPath)) {
      return makeToolJsonErrorResult(
        `Flow "${flowId}" references missing step scene "${slug}".`,
        'export.react-spa.step_missing',
        { flowId, slug, stepPath },
      );
    }
    try {
      const env = JSON.parse(fs.readFileSync(stepPath, 'utf8'));
      const { graph } = deserializeScene(env);
      const rootId = env.root?.id ?? env.rootId;
      steps.push({ graph, rootId });
    } catch (err: any) {
      return makeToolJsonErrorResult(
        `Failed to deserialize step scene "${slug}": ${err?.message ?? err}`,
        'export.react-spa.step_load_failed',
        { flowId, slug },
      );
    }
  }

  const { exportFlowToReactSpa } = await import('../../../core/src/exporters/react-spa.js');
  const result = await exportFlowToReactSpa({
    flowId,
    flowName: spec.name,
    steps: steps.map((s) => s.graph),
    stepRootIds: steps.map((s) => s.rootId),
    transitions: spec.transitions,
    state,
  }, { projectDir });

  // Write to disk under .reframe/exports/.
  const exportDir = getExportsBaseDir();
  if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
  const outPath = path.join(exportDir, `${flowId}.react-spa.html`);
  fs.writeFileSync(outPath, result.html, 'utf8');

  const lines: string[] = [];
  const fileUrl = `file:///${outPath.replace(/\\/g, '/')}`;
  lines.push(`Exported **${flowId}** (react-spa)  ${fileUrl} → [${flowId}.react-spa.html](${outPath}) (${(result.sizeBytes / 1024).toFixed(1)}KB)`);
  lines.push(`Inlined: ${result.inlinedAssets.fonts} font face(s), ${result.inlinedAssets.images} image(s)`);
  if (result.sizeWarning) lines.push(`⚠ ${result.sizeWarning}`);
  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
}
