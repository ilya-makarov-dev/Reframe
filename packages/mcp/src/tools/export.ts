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
import { exportToSvg } from '../../../core/src/exporters/svg.js';
import { exportToReact } from '../../../core/src/exporters/react.js';
import { exportToAnimatedHtml } from '../../../core/src/exporters/animated-html.js';
import { exportToLottie } from '../../../core/src/exporters/lottie.js';
import { exportSite } from '../../../core/src/exporters/site.js';
import { StandaloneNode } from '../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../../core/src/host/context.js';
import { validateTimeline, computeDuration } from '../../../core/src/animation/timeline.js';
import { presets, stagger as staggerFn, listPresets } from '../../../core/src/animation/presets.js';
import type { ITimeline, INodeAnimation } from '../../../core/src/animation/types.js';
import { exportScene } from '../engine.js';
import { resolveScene, getScene, listScenes } from '../store.js';
import { getSession } from '../session.js';
import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';

// ─── Constants ────────────────────────────────────────────────

const MAX_INLINE_BYTES = 50_000; // 50KB — larger exports get size-only summary

// ─── Schema ───────────────────────────────────────────────────

export const exportInputSchema = {
  sceneId: z.string().describe('Scene ID to export'),
  format: z.enum(['html', 'svg', 'png', 'react', 'animated_html', 'lottie', 'site'])
    .describe('Output format. "site" bundles multiple scenes into a clickable multi-page HTML app with routing and transitions'),

  // HTML options
  fullDocument: z.boolean().optional().default(true),
  dataAttributes: z.boolean().optional().default(false),
  cssClasses: z.boolean().optional().default(false),

  // SVG options
  xmlDeclaration: z.boolean().optional().default(true),

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
  format: 'html' | 'svg' | 'png' | 'react' | 'animated_html' | 'lottie' | 'site';
  fullDocument?: boolean;
  dataAttributes?: boolean;
  cssClasses?: boolean;
  xmlDeclaration?: boolean;
  componentName?: string;
  typescript?: boolean;
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
  const sections: string[] = [];

  // ─── 1. Resolve scene ───────────────────────────────────────
  let graph: SceneGraph;
  let rootId: string;

  try {
    ({ graph, rootId } = resolveScene({ sceneId }));
  } catch (err: any) {
    return { content: [{ type: 'text' as const, text: err.message }] };
  }

  try {
    const { computeAllLayouts } = await import('../../../core/src/engine/layout.js');
    computeAllLayouts(graph, rootId);
  } catch {
    /* layout optional for degenerate trees */
  }

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
      sections.push(`Timeline validation errors: ${errors.join(', ')}`);
      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
      };
    }

    if (built.timeline.animations.length === 0) {
      sections.push('No valid animations produced (check node names and preset names above).');
      return {
        content: [{ type: 'text' as const, text: sections.join('\n') }],
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
        const sceneData = { root: exportScene(graph, rootId) };
        content = exportToSvg(sceneData as any);
        break;
      }

      case 'react': {
        setHost(new StandaloneHost(graph));
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

      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown format: ${format}` }],
        };
    }
  } catch (err: any) {
    return {
      content: [{ type: 'text' as const, text: `Export error (${format}): ${err.message}` }],
    };
  }

  // ─── 5. Auto-save to file + return result ──────────────────
  const stored = getScene(sceneId);
  const slug = stored?.slug ?? sceneId;

  // Auto-save exported file to .reframe/exports/
  const extMap: Record<string, string> = {
    html: 'html', svg: 'svg', react: 'tsx', animated_html: 'html',
    lottie: 'json', site: 'html', png: 'png',
  };
  const ext = extMap[format] ?? format;
  const exportDir = join(process.cwd(), '.reframe', 'exports');
  if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
  const fileName = format === 'site' ? `site.${ext}` : `${slug}.${ext}`;
  const filePath = join(exportDir, fileName);
  try {
    writeFileSync(filePath, content, 'utf-8');
  } catch {}

  const absPath = filePath.replace(/\\/g, '/');
  sections.push(`Exported **${format === 'site' ? 'site' : slug}** → [${fileName}](${absPath}) (${(content.length / 1024).toFixed(1)}KB)`);
  if (format === 'site') {
    sections.push(`Open [site.html](${absPath}) in browser — clickable multi-page app with navigation.`);
    sections.push(`Or: http://localhost:4100/site`);
  } else {
    sections.push(`Preview: [open file](${absPath}) or http://localhost:4100/preview/${sceneId}`);
  }

  return {
    content: [{ type: 'text' as const, text: sections.join('\n') }],
  };
}
