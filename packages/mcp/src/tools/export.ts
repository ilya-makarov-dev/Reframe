/**
 * reframe_export — Unified export tool.
 *
 * Unified export tool (replaces old per-format tools).
 * old export tools into a single tool with a `format` parameter.
 */

import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, sep } from 'path';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { exportToReact, exportToReactTree } from '../../../core/src/exporters/react.js';
import { exportToAnimatedHtml } from '../../../core/src/exporters/animated-html.js';
import { exportToLottie } from '../../../core/src/exporters/lottie.js';
import { buildLottiePreviewHtml } from '../../../core/src/exporters/lottie-preview.js';
import { exportSite } from '../../../core/src/exporters/site.js';
// transition exporter removed — was niche resize-preview animation
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { runWithHostAsync } from '../../../core/src/host/context.js';
import { validateTimeline, computeDuration } from '../../../core/src/animation/timeline.js';
import { presets, stagger as staggerFn, listPresets } from '../../../core/src/animation/presets.js';
import type { ITimeline, INodeAnimation } from '../../../core/src/animation/types.js';
import { exportToRaster, initCanvasKit } from '../../../core/src/exporters/raster.js';
import { exportSvgFromGraph } from '../engine.js';
import { resolveScene, getScene, listScenes, getExportsBaseDir } from '../store.js';
import { getSession } from '../session.js';
import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { makeToolJsonErrorResult } from '../tool-result.js';

// ─── Schema ───────────────────────────────────────────────────

export const exportInputSchema = {
  sceneId: z.string().describe('Scene ID to export.'),
  format: z.enum(['html', 'svg', 'png', 'pdf', 'react', 'animated_html', 'lottie', 'site'])
    .describe('Output format. "site" bundles multiple scenes into a clickable multi-page HTML app with routing.'),

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
      delay: z.number().optional(),
      duration: z.number().optional(),
    })).optional(),
    stagger: z.object({
      nodeNames: z.array(z.string()),
      preset: z.string(),
      staggerDelay: z.number().optional().default(100),
    }).optional(),
    loop: z.boolean().optional().default(false),
    speed: z.number().optional().default(1),
  }).optional().describe('Animation config — required for animated_html and lottie formats'),

  controls: z.boolean().optional().default(true).describe('Include play/pause in animated HTML'),
};

// ─── Timeline builder ─────────────────────────────────────────

function buildTimeline(
  graph: SceneGraph,
  rootId: string,
  animateConfig: {
    presets?: Array<{ nodeName: string; preset: string; delay?: number; duration?: number }>;
    stagger?: { nodeNames: string[]; preset: string; staggerDelay?: number };
    loop?: boolean;
    speed?: number;
  },
): { timeline: ITimeline; warnings: string[] } {
  const animations: INodeAnimation[] = [];
  const warnings: string[] = [];
  const availablePresets = listPresets();

  // Resolve node name → id
  const nameToId = new Map<string, string>();
  function walkNames(id: string) {
    const n = graph.getNode(id);
    if (!n) return;
    nameToId.set(n.name, id);
    for (const cid of n.childIds) walkNames(cid);
  }
  walkNames(rootId);
  const availableNodes = [...nameToId.keys()];

  // Helper: resolve node name, warn if missing
  function resolveNode(nodeName: string): string | undefined {
    const nodeId = nameToId.get(nodeName);
    if (!nodeId) {
      warnings.push(`Node "${nodeName}" not found. Available: ${availableNodes.join(', ')}`);
    }
    return nodeId;
  }

  // Preset animations
  if (animateConfig.presets) {
    for (const p of animateConfig.presets) {
      const presetDef = presets[p.preset];
      if (!presetDef) {
        warnings.push(`Unknown preset "${p.preset}". Available: ${availablePresets.join(', ')}`);
        continue;
      }
      const nodeId = resolveNode(p.nodeName);
      const anim = presetDef.create(p.duration ? { duration: p.duration } : undefined);
      animations.push({
        ...anim,
        nodeId,
        nodeName: p.nodeName,
        delay: p.delay ?? 0,
      });
    }
  }

  // Stagger
  if (animateConfig.stagger) {
    const s = animateConfig.stagger;
    if (!presets[s.preset]) {
      warnings.push(`Unknown stagger preset "${s.preset}". Available: ${availablePresets.join(', ')}`);
    } else {
      const ids: string[] = [];
      const resolvedNames: string[] = [];
      for (const name of s.nodeNames) {
        const id = nameToId.get(name);
        if (id) {
          ids.push(id);
          resolvedNames.push(name);
        } else {
          warnings.push(`Stagger: node "${name}" not found, skipping. Available: ${availableNodes.join(', ')}`);
        }
      }
      if (ids.length > 0) {
        const staggered = staggerFn(ids, s.preset, {
          staggerDelay: s.staggerDelay ?? 100,
        });
        for (let i = 0; i < staggered.length; i++) {
          (staggered[i] as any).nodeName = resolvedNames[i];
        }
        animations.push(...(staggered as INodeAnimation[]));
      }
    }
  }

  return {
    timeline: {
      animations,
      loop: animateConfig.loop ?? false,
      speed: animateConfig.speed ?? 1,
    },
    warnings,
  };
}

// ─── Handler ──────────────────────────────────────────────────

export async function handleExport(input: {
  sceneId: string;
  format: 'html' | 'svg' | 'png' | 'pdf' | 'react' | 'animated_html' | 'lottie' | 'site';
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
}) {
  const { format, sceneId } = input;

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

  if ((format === 'animated_html' || format === 'lottie') && input.animate) {
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
  } else if ((format === 'animated_html' || format === 'lottie') && !input.animate) {
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
        content = exportToHtml(graph, rootId, {
          fullDocument: input.fullDocument ?? true,
          dataAttributes: input.dataAttributes ?? false,
          cssClasses: input.cssClasses ?? false,
        });
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

      case 'animated_html': {
        content = exportToAnimatedHtml(graph, rootId, timeline!, {
          fullDocument: true,
          controls: input.controls ?? true,
        });
        break;
      }

      case 'lottie': {
        const lottie = exportToLottie(graph, rootId, timeline!);
        content = JSON.stringify(lottie);
        break;
      }

      case 'site': {
        // Bundle scenes into a multi-page site. Filtering policy:
        //  1. If the requested sceneId belongs to a project group (e.g.
        //     compiled with name="site/home" → group="site"), only bundle
        //     scenes that share that group. This is the common case —
        //     the agent is exporting a coherent micro-site, not the
        //     entire ad-hoc session of 65 grid variants and rebrands.
        //  2. Otherwise fall back to bundling every scene. Old behavior
        //     stays available for ad-hoc multi-scene previews.
        const allScenes = listScenes();
        const sourceStored = getScene(sceneId);
        const sourceGroup = sourceStored?.group;
        const filtered = sourceGroup
          ? allScenes.filter(s => getScene(s.id)?.group === sourceGroup)
          : allScenes;
        if (filtered.length < 2) {
          const hint = sourceGroup
            ? `Site export from group "${sourceGroup}" found only ${filtered.length} scene. Compile additional pages with name="${sourceGroup}/<page>" first.`
            : 'Site export requires at least 2 scenes. Create more scenes with reframe_compile or reframe_edit first.';
          return { content: [{ type: 'text' as const, text: hint }] };
        }
        const sitePages = filtered.map(s => {
          const stored = getScene(s.id)!;
          return {
            slug: stored.slug,
            name: stored.name ?? stored.slug,
            graph: stored.graph,
            rootId: stored.rootId,
          };
        });
        content = exportSite(sitePages, {
          title: sitePages.map(p => p.name).join(' | '),
          transition: 'fadeSlideUp',
        });
        break;
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
    html: 'html', svg: 'svg', react: 'tsx', animated_html: 'animated.html',
    lottie: 'lottie.json', site: 'html', png: 'png', pdf: 'pdf',
  };
  const ext = extMap[format] ?? format;
  const exportDir = getExportsBaseDir();
  if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
  const fileName = format === 'site' ? `site.${ext}` : `${slug}.${ext}`;
  const filePath = join(exportDir, fileName);
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
    site: null,           // handled below
    animated_html: '',    // served via HTML render (keyframes applied)
    lottie: '.lottie',
    png: null,            // no live render — link to file
  };
  let previewUrl: string;
  if (format === 'site') {
    previewUrl = 'http://localhost:4100/site';
  } else if (previewExtMap[format] == null) {
    // File-only formats — direct file URL.
    previewUrl = `file:///${absPath.replace(/\\/g, '/')}`;
  } else {
    previewUrl = `http://localhost:4100/preview/${sceneId}${previewExtMap[format]}`;
  }
  sections.push(`Exported **${format === 'site' ? 'site' : slug}**  ${previewUrl} → [${fileName}](${absPath}) (${(content.length / 1024).toFixed(1)}KB)`);
  if (lottiePreviewPath) {
    const previewAbs = lottiePreviewPath.replace(/\\/g, '/');
    sections.push(`  → [${slug}.lottie.preview.html](${previewAbs}) (open in browser to play)`);
  }

  return {
    content: [{ type: 'text' as const, text: sections.join('\n') }],
  };
  });
}
