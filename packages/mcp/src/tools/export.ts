/**
 * reframe_export — Unified export tool.
 *
 * Unified export tool (replaces old per-format tools).
 * old export tools into a single tool with a `format` parameter.
 */

import { z } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { exportToHtml } from '../../../core/src/exporters/html.js';
import { exportToReact } from '../../../core/src/exporters/react.js';
import { exportToAnimatedHtml } from '../../../core/src/exporters/animated-html.js';
import { exportToLottie } from '../../../core/src/exporters/lottie.js';
import { exportSite } from '../../../core/src/exporters/site.js';
import { exportResizeTransition } from '../../../core/src/exporters/transition.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { runWithHostAsync } from '../../../core/src/host/context.js';
import { validateTimeline, computeDuration } from '../../../core/src/animation/timeline.js';
import { presets, stagger as staggerFn, listPresets } from '../../../core/src/animation/presets.js';
import type { ITimeline, INodeAnimation } from '../../../core/src/animation/types.js';
import { exportSvgFromGraph } from '../engine.js';
import { resolveScene, getScene, listScenes, getExportsBaseDir } from '../store.js';
import { getSession } from '../session.js';
import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { ensureSceneLayout } from '../../../core/src/engine/layout.js';
import { makeToolJsonErrorResult } from '../tool-result.js';

// ─── Schema ───────────────────────────────────────────────────

export const exportInputSchema = {
  sceneId: z.string().describe('Scene ID to export. For "transition" format, this is the SOURCE scene — pair with transitionTarget.'),
  format: z.enum(['html', 'svg', 'png', 'react', 'animated_html', 'lottie', 'site', 'transition'])
    .describe('Output format. "site" bundles multiple scenes into a clickable multi-page HTML app with routing and transitions. "transition" exports an HTML that animates source → target geometry, pair with transitionTarget.'),
  transitionTarget: z.string().optional()
    .describe('Target scene ID for "transition" format. Typically a resized version of sceneId produced by reframe_resize.'),
  transitionDuration: z.number().optional().default(1200)
    .describe('Transition tween duration in ms (default 1200).'),
  transitionLoop: z.boolean().optional().default(true)
    .describe('Whether the transition loops back and forth (default true).'),

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
  format: 'html' | 'svg' | 'png' | 'react' | 'animated_html' | 'lottie' | 'site' | 'transition';
  fullDocument?: boolean;
  dataAttributes?: boolean;
  cssClasses?: boolean;
  xmlDeclaration?: boolean;
  svgIncludeNames?: boolean;
  svgBackground?: string;
  componentName?: string;
  typescript?: boolean;
  scale?: number;
  transitionTarget?: string;
  transitionDuration?: number;
  transitionLoop?: boolean;
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
        content = exportToReact(wrappedRoot);
        break;
      }

      case 'png': {
        return {
          content: [{
            type: 'text' as const,
            text: 'PNG export requires CanvasKit runtime. PNG export requires CanvasKit WASM runtime (not available in all environments).',
          }],
        };
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
        // Bundle all scenes in the session into a multi-page site
        const allScenes = listScenes();
        if (allScenes.length < 2) {
          return {
            content: [{ type: 'text' as const, text: 'Site export requires at least 2 scenes. Create more scenes with reframe_compile or reframe_edit first.' }],
          };
        }
        const sitePages = allScenes.map(s => {
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

      case 'transition': {
        // Animated source → target resize preview. Needs a second
        // scene id in `transitionTarget` — typically the resize result
        // produced by reframe_resize from the same source.
        if (!input.transitionTarget) {
          return {
            content: [{ type: 'text' as const, text: 'Transition export requires `transitionTarget` — pass the resized target scene id alongside sceneId (the source).' }],
          };
        }
        const tgt = getScene(input.transitionTarget);
        if (!tgt) {
          return {
            content: [{ type: 'text' as const, text: `Transition target scene "${input.transitionTarget}" not found. List scenes with reframe_inspect.` }],
          };
        }
        const srcSceneForTitle = getScene(sceneId);
        content = exportResizeTransition(
          graph,
          rootId,
          tgt.graph,
          tgt.rootId,
          {
            duration: input.transitionDuration ?? 1200,
            loop: input.transitionLoop ?? true,
            title: `${srcSceneForTitle?.name ?? sceneId} → ${tgt.name ?? input.transitionTarget}`,
          },
        );
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
    lottie: 'lottie.json', site: 'html', png: 'png', transition: 'transition.html',
  };
  const ext = extMap[format] ?? format;
  const exportDir = getExportsBaseDir();
  if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
  // `transition` uses a distinct `.transition.html` suffix so calling
  // it after a regular `html` export doesn't silently overwrite the
  // static HTML file — both artefacts live side-by-side in the exports
  // directory.
  const fileName = format === 'site' ? `site.${ext}` : `${slug}.${ext}`;
  const filePath = join(exportDir, fileName);
  try {
    writeFileSync(filePath, content, 'utf-8');
  } catch {}

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
    transition: '',       // transition IS HTML, preview serves fresh render
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

  return {
    content: [{ type: 'text' as const, text: sections.join('\n') }],
  };
  });
}
