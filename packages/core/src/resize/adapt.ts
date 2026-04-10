/**
 * Reframe — Headless Adaptation
 *
 * Full-power adaptation pipeline without Figma/session dependencies.
 * Uses ClusterScalePipeline + semantic classification + guide postprocess
 * + layout profile + design system.
 *
 * This is what MCP and CLI should call instead of the simplified scaleTree.
 */

import type { INode } from '../host/types';
import { NodeType } from '../host/types';
import { setHost } from '../host/context';
import { SceneGraph } from '../engine/scene-graph';
import { StandaloneHost } from '../adapters/standalone/adapter';
import { StandaloneNode, getStandaloneNode } from '../adapters/standalone/node';
import { createClusterScalePipeline } from './pipelines/cluster-scale';
import { createReflowPipeline } from './pipelines/reflow';
import { analyzeFrame } from './pipelines/analyzer';
import { assignSemanticTypes } from './postprocess/semantic-classifier';
import { collectAllDescendants } from './postprocess/layout-utils';
import { applyGuidePostProcess } from './postprocess/guide-scaler-guide-flow';
import { ensureUniqueDirectChildNames } from './postprocess/dedupe-root-child-names';
import { resolveBannerLayoutProfile } from './layout-profile';
import { layoutGuide } from './data/guides';
import { pickBestGuideKeyForDimensions } from './orchestration/guide-picker';
import { initYoga } from '../engine/yoga-init';
import { ensureSceneLayout } from '../engine/layout';
import type { DesignSystem } from '../design-system/types';
import type { BannerElementType, GuideSize } from './contracts/types';

// ─── Types ─────────────────────────────────────────────────────

export type AdaptStrategy = 'smart' | 'contain' | 'cover' | 'stretch' | 'reflow';

export interface AdaptOptions {
  /** Scaling strategy (default: 'smart'). */
  strategy?: AdaptStrategy;
  /** Design system for brand-aware adaptation. */
  designSystem?: DesignSystem;
  /** Enable guide-based postprocessing (semantic slot placement). */
  useGuide?: boolean;
  /** Preserve proportions of content elements (default: true). */
  preserveProportions?: boolean;
}

export interface AdaptResult {
  /** Adapted root INode. */
  root: INode;
  /** Backing SceneGraph. */
  graph: SceneGraph;
  /** Semantic classification of source elements (if performed). */
  semanticTypes?: Map<string, BannerElementType>;
  /** Layout profile of source frame. */
  layoutProfile?: { layoutClass: string; confidence: number };
  /** Frame analysis (text/image/vector detection). */
  analysis?: ReturnType<typeof analyzeFrame>;
  /** Execution stats. */
  stats: {
    strategy: string;
    durationMs: number;
    sourceWidth: number;
    sourceHeight: number;
    targetWidth: number;
    targetHeight: number;
    usedGuide: boolean;
    guideKey?: string;
  };
}

// ─── Main Function ─────────────────────────────────────────────

/**
 * Adapt a source INode tree to target dimensions using the full pipeline.
 *
 * This is the headless equivalent of handleScale — no session state,
 * no UI notifications, no Figma dependencies.
 *
 * @param source - The source frame INode (must be a Frame type).
 * @param targetWidth - Target width in pixels.
 * @param targetHeight - Target height in pixels.
 * @param options - Adaptation options.
 */
export async function adapt(
  source: INode,
  targetWidth: number,
  targetHeight: number,
  options: AdaptOptions = {},
): Promise<AdaptResult> {
  const t0 = Date.now();
  const strategy = options.strategy ?? 'smart';
  const preserveProportions = options.preserveProportions ?? true;
  const useGuide = options.useGuide ?? (strategy === 'smart');

  // Yoga must be initialized before any layout pass. initYoga() is idempotent
  // so this is safe to call on every adapt() invocation. Without this, headless
  // callers (CLI, scripts) get a tree with all positions at (0, 0), which
  // silently breaks every classifier and signal collector that filters by Y.
  await initYoga();

  // Compute layout on the source so descendants get real (x, y, w, h) values.
  // The HTML importer leaves auto-layout positions unset; without this pass
  // the semantic classifier and layout-profile classifier both degrade to
  // useless: position-based heuristics either match all nodes or none.
  // We try to find the source graph and call ensureSceneLayout on it.
  const sourceGraph = (source as any).graph as SceneGraph | undefined;
  if (sourceGraph) {
    ensureSceneLayout(sourceGraph, source.id);
  }

  // Analyze source
  const analysis = analyzeFrame(source);

  // Semantic classification — walk ALL descendants, not just direct children.
  // The original `[...source.children]` only saw depth-1 nodes, which for any
  // sectioned design (email, landing page) means classifier sees zero text
  // and assigns nothing. Walking descendants gives the classifier the full
  // candidate set its heuristics were designed for.
  //
  // Multi-slot mode: long-form designs have many titles, many CTAs, many
  // section backgrounds. Single-slot (banner) mode is preserved as the
  // default for non-adapt callers via the assignSemanticTypes API.
  let semanticTypes: Map<string, BannerElementType> | undefined;
  const descendants = collectAllDescendants(source).filter(n => n !== source);
  if (descendants.length > 0) {
    semanticTypes = assignSemanticTypes(
      descendants,
      source,
      options.designSystem,
      { multiSlot: true },
    );
  }

  // Layout profile
  let layoutProfile: { layoutClass: string; confidence: number } | undefined;
  if (source.type === NodeType.Frame) {
    const lp = resolveBannerLayoutProfile(source);
    layoutProfile = { layoutClass: lp.layoutClass, confidence: lp.confidence };
  }

  // Auto-upgrade `smart` → `reflow` for long-form vertical content whose
  // aspect ratio is shifting non-trivially. Cluster-scale is correct for
  // banners and hero compositions (pixel-perfect proportional scaling),
  // but wrecks landing pages and emails — text stays at scaled positions
  // instead of re-flowing in flex, and audit lights up with false or
  // real overflow warnings. Reflow handles the flex-stack shape cleanly.
  //
  // Both strategies still exist as explicit options; this block just
  // picks the right one when the caller says "smart" without specifying.
  // Heuristic: source must be VERTICAL auto-layout AND aspect delta
  // against the target must exceed 15%. Either missing → keep the
  // existing cluster-scale smart path unchanged.
  const effectiveStrategy: AdaptStrategy = (() => {
    if (strategy !== 'smart') return strategy;
    if ((source as any).layoutMode !== 'VERTICAL') return 'smart';
    const srcAspect = source.width / source.height;
    const tgtAspect = targetWidth / targetHeight;
    const aspectDelta = Math.abs(srcAspect - tgtAspect) / Math.max(srcAspect, tgtAspect);
    return aspectDelta > 0.15 ? 'reflow' : 'smart';
  })();

  // Execute scaling pipeline
  const pipeline = createClusterScalePipeline();
  let result: INode;

  if (effectiveStrategy === 'reflow') {
    // Reflow is a flex-first strategy for long-form content (landing
    // pages, emails). It bypasses cluster-scale entirely and leaves the
    // source tree shape intact; Yoga does the work via ensureSceneLayout
    // at the end of the pipeline.
    const reflowPipeline = createReflowPipeline();
    result = await reflowPipeline.execute(source, targetWidth, targetHeight);
  } else if (effectiveStrategy === 'contain') {
    result = await pipeline.executeUniformLetterbox(source, targetWidth, targetHeight, {
      letterboxFit: 'contain',
      contentAwareLetterbox: false,
    });
  } else if (effectiveStrategy === 'cover') {
    result = await pipeline.executeUniformLetterbox(source, targetWidth, targetHeight, {
      letterboxFit: 'cover',
      contentAwareLetterbox: false,
    });
  } else if (effectiveStrategy === 'stretch') {
    result = await pipeline.execute(source, targetWidth, targetHeight, false, false);
  } else {
    // 'smart' fallback — uniform letterbox for guide compatibility
    result = await pipeline.executeUniformLetterbox(source, targetWidth, targetHeight, {
      letterboxFit: 'contain',
      contentAwareLetterbox: false,
    });
  }

  // Guide-based postprocessing (semantic slot placement)
  let guideKey: string | undefined;
  if (useGuide && effectiveStrategy === 'smart') {
    guideKey = pickBestGuideKeyForDimensions(targetWidth, targetHeight, layoutGuide.guides);
    const guide = guideKey ? layoutGuide.guides[guideKey] : undefined;

    if (guide) {
      await applyGuidePostProcess(
        result,
        targetWidth,
        targetHeight,
        guide,
        semanticTypes,
        { afterUniformLetterbox: true },
      );
    }
  }

  // Clamp text nodes that overflow the target frame — cluster-scale
  // path only. Reflow re-runs Yoga at the end of its pipeline so every
  // text node already has the correct wrapped dimensions; running the
  // clamp on top of that would double-scale from stale pre-Yoga widths
  // and re-introduce sub-8px fonts that audit rejects.
  if (effectiveStrategy !== 'reflow') {
    clampTextToFit(result, targetWidth, targetHeight);
  }

  // Cluster-scale overflow fallback → reflow. When a cluster-scale
  // strategy (contain/cover/stretch/smart) leaves descendants extending
  // past the target frame (Y bleed on tall resizes, X bleed when
  // aspect ratio flips), we discard the cluster-scale result and
  // re-run through ReflowPipeline. This replaces the Session-1
  // compressive Y clamp — that clamp was a band-aid that squished
  // proportions and made line-heights look wrong. Reflow actually
  // re-flows the tree through Yoga, which is correct for this shape.
  //
  // Only triggers when the overshoot is meaningful (>5%) so clean
  // cluster-scale results stay on the cluster-scale path and don't get
  // silently rewritten by the flex engine.
  let fellBackToReflow = false;
  if (effectiveStrategy !== 'reflow') {
    const overshoot = measureOvershoot(result, targetWidth, targetHeight);
    if (overshoot > 0.05) {
      const reflowPipeline = createReflowPipeline();
      // Delete the failed cluster-scale clone so the graph doesn't
      // accumulate dead subtrees — remove() drops it and its descendants.
      try { result.remove?.(); } catch {}
      result = await reflowPipeline.execute(source, targetWidth, targetHeight);
      fellBackToReflow = true;
    }
  }

  // Reflect the fallback in the effective strategy so callers (and the
  // MCP resize tool's display) can tell the pipeline actually rerouted
  // to reflow. Without this the label keeps saying `contain` on a
  // scene that's fundamentally a reflowed one, which made debugging
  // the fallback chain confusing during MCP testing.
  const reportedStrategy: AdaptStrategy = fellBackToReflow ? 'reflow' : effectiveStrategy;

  // Deduplicate names
  ensureUniqueDirectChildNames(result);

  // Get the backing graph from the result node
  // The result comes from clone() which creates nodes in the same graph
  // For standalone usage, extract it
  const resultGraph = extractGraph(result);

  return {
    root: result,
    graph: resultGraph,
    semanticTypes,
    layoutProfile,
    analysis,
    stats: {
      strategy: reportedStrategy,
      durationMs: Date.now() - t0,
      sourceWidth: source.width,
      sourceHeight: source.height,
      targetWidth,
      targetHeight,
      usedGuide: !!guideKey,
      guideKey,
    },
  };
}

/**
 * Adapt from a SceneGraph (for MCP/CLI where you have JSON → SceneGraph).
 *
 * Sets up StandaloneHost, wraps the root node, and calls adapt().
 */
export async function adaptFromGraph(
  graph: SceneGraph,
  rootId: string,
  targetWidth: number,
  targetHeight: number,
  options: AdaptOptions = {},
): Promise<AdaptResult> {
  const host = new StandaloneHost(graph);
  setHost(host);

  // Use the cached factory — `new StandaloneNode(...)` would create an
  // instance separate from the cache, then descendants reached through
  // `child.parent` (which goes through the cache) would never be `===`
  // to it. That silently broke `isDirectChild(node, frame)` checks
  // throughout the resize subsystem.
  const source = getStandaloneNode(graph, rootId);
  if (!source) throw new Error(`Node ${rootId} not found`);

  return adapt(source, targetWidth, targetHeight, options);
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Try to extract the SceneGraph backing an INode.
 * For StandaloneNode, we can access it. Otherwise, create a new one.
 */
function extractGraph(node: INode): SceneGraph {
  // StandaloneNode stores graph as private field — use bracket access
  if ('graph' in (node as any)) {
    return (node as any).graph;
  }
  // Fallback: return empty graph (caller should handle)
  return new SceneGraph();
}

/**
 * Post-process: clamp all text nodes so they fit within the target frame.
 * Scales down fontSize and dimensions for nodes that overflow.
 * This catches deeply nested text that ClusterScalePipeline didn't reach.
 */
function clampTextToFit(root: INode, targetW: number, targetH: number): void {
  const graph = extractGraph(root);
  const hasGraph = graph.nodes?.size > 0;

  // Compute overall scale factor from source to target
  const overallScale = Math.min(targetW / root.width, targetH / root.height);

  function scaleValue(v: number | undefined): number | undefined {
    return v != null ? Math.round(v * overallScale * 10) / 10 : undefined;
  }

  function walk(node: INode): void {
    if (node.type === NodeType.Text) {
      const fontSize = node.fontSize as number;
      if (typeof fontSize !== 'number' || fontSize <= 0) return;

      let scale = 1;

      if (node.width > targetW * 0.95) {
        scale = Math.min(scale, (targetW * 0.9) / node.width);
      }
      if (node.height > targetH * 0.95) {
        scale = Math.min(scale, (targetH * 0.9) / node.height);
      }

      if (scale < 1) {
        // Floor at 8px to match the audit's `min-font-size` minimum —
        // the previous 6px floor produced text that the very next audit
        // pass would immediately flag. Cluster-scale fits-within work is
        // supposed to produce compliant output, not a new pile of
        // warnings for the fix loop to chew on.
        const newFontSize = Math.max(Math.round(fontSize * scale * 10) / 10, 8);
        const newWidth = Math.round(node.width * scale);
        const newHeight = Math.round(node.height * scale);

        if (hasGraph) {
          graph.updateNode(node.id, {
            fontSize: newFontSize,
            width: newWidth,
            height: newHeight,
          });
        } else {
          try { node.fontSize = newFontSize; } catch {}
          try { (node as any).width = newWidth; } catch {}
          try { (node as any).height = newHeight; } catch {}
        }
      }
    }

    // Scale padding on frames that weren't resized by the pipeline
    if (node.type === NodeType.Frame && overallScale < 0.9) {
      const updates: any = {};
      if (node.paddingTop && node.paddingTop > 4) updates.paddingTop = scaleValue(node.paddingTop);
      if (node.paddingRight && node.paddingRight > 4) updates.paddingRight = scaleValue(node.paddingRight);
      if (node.paddingBottom && node.paddingBottom > 4) updates.paddingBottom = scaleValue(node.paddingBottom);
      if (node.paddingLeft && node.paddingLeft > 4) updates.paddingLeft = scaleValue(node.paddingLeft);
      if (Object.keys(updates).length > 0) {
        if (hasGraph) {
          graph.updateNode(node.id, updates);
        } else {
          for (const [k, v] of Object.entries(updates)) {
            try { (node as any)[k] = v; } catch {}
          }
        }
      }
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
}

/**
 * Quantify how badly a cluster-scale result overflows the target frame.
 *
 * Walks descendants in the root's local coordinate space (accumulating
 * parent offsets manually — cheaper and more robust than the
 * absPosCache) and returns the worst bleed on either axis, normalized
 * against the target dimension: `(maxRight − targetWidth) / targetWidth`
 * or `(maxBottom − targetHeight) / targetHeight`, whichever is larger.
 *
 * Used by adapt() to decide whether to discard the cluster-scale
 * result and re-run through reflow. A return value under ~0.05 means
 * "close enough, keep the cluster-scale result"; anything larger
 * signals the caller asked cluster-scale to handle a shape it can't,
 * and reflow is the correct fallback.
 */
function measureOvershoot(root: INode, targetWidth: number, targetHeight: number): number {
  let maxRight = 0;
  let maxBottom = 0;

  const walk = (node: INode, parentX: number, parentY: number): void => {
    const absX = parentX + (node.x ?? 0);
    const absY = parentY + (node.y ?? 0);
    const right = absX + node.width;
    const bottom = absY + node.height;
    if (right > maxRight) maxRight = right;
    if (bottom > maxBottom) maxBottom = bottom;
    if (node.children) {
      for (const child of node.children) {
        if ((child as any).layoutPositioning === 'ABSOLUTE') continue;
        walk(child, absX, absY);
      }
    }
  };
  // Start with root offsets at 0 — we measure in the root's local frame.
  for (const child of root.children ?? []) {
    if ((child as any).layoutPositioning === 'ABSOLUTE') continue;
    walk(child, 0, 0);
  }

  const xBleed = targetWidth > 0 ? Math.max(0, maxRight - targetWidth) / targetWidth : 0;
  const yBleed = targetHeight > 0 ? Math.max(0, maxBottom - targetHeight) / targetHeight : 0;
  return Math.max(xBleed, yBleed);
}
