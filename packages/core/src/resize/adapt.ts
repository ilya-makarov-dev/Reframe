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
import { StandaloneNode } from '../adapters/standalone/node';
import { createClusterScalePipeline } from './pipelines/cluster-scale';
import { analyzeFrame } from './pipelines/analyzer';
import { assignSemanticTypes } from './postprocess/semantic-classifier';
import { applyGuidePostProcess } from './postprocess/guide-scaler-guide-flow';
import { ensureUniqueDirectChildNames } from './postprocess/dedupe-root-child-names';
import { resolveBannerLayoutProfile } from './layout-profile';
import { layoutGuide } from './data/guides';
import { pickBestGuideKeyForDimensions } from './orchestration/guide-picker';
import type { DesignSystem } from '../design-system/types';
import type { BannerElementType, GuideSize } from './contracts/types';

// ─── Types ─────────────────────────────────────────────────────

export type AdaptStrategy = 'smart' | 'contain' | 'cover' | 'stretch';

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

  // Analyze source
  const analysis = analyzeFrame(source);

  // Semantic classification
  let semanticTypes: Map<string, BannerElementType> | undefined;
  if (source.children) {
    semanticTypes = assignSemanticTypes(
      [...source.children],
      source,
      options.designSystem,
    );
  }

  // Layout profile
  let layoutProfile: { layoutClass: string; confidence: number } | undefined;
  if (source.type === NodeType.Frame) {
    const lp = resolveBannerLayoutProfile(source);
    layoutProfile = { layoutClass: lp.layoutClass, confidence: lp.confidence };
  }

  // Execute scaling pipeline
  const pipeline = createClusterScalePipeline();
  let result: INode;

  if (strategy === 'contain') {
    result = await pipeline.executeUniformLetterbox(source, targetWidth, targetHeight, {
      letterboxFit: 'contain',
      contentAwareLetterbox: false,
    });
  } else if (strategy === 'cover') {
    result = await pipeline.executeUniformLetterbox(source, targetWidth, targetHeight, {
      letterboxFit: 'cover',
      contentAwareLetterbox: false,
    });
  } else if (strategy === 'stretch') {
    result = await pipeline.execute(source, targetWidth, targetHeight, false, false);
  } else {
    // 'smart' — uniform letterbox for guide compatibility
    result = await pipeline.executeUniformLetterbox(source, targetWidth, targetHeight, {
      letterboxFit: 'contain',
      contentAwareLetterbox: false,
    });
  }

  // Guide-based postprocessing (semantic slot placement)
  let guideKey: string | undefined;
  if (useGuide && strategy === 'smart') {
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

  // Clamp text nodes that overflow the target frame
  clampTextToFit(result, targetWidth, targetHeight);

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
      strategy,
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

  const rawRoot = graph.getNode(rootId);
  if (!rawRoot) throw new Error(`Node ${rootId} not found`);

  const source = new StandaloneNode(graph, rawRoot);
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
        const newFontSize = Math.max(Math.round(fontSize * scale * 10) / 10, 6);
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
