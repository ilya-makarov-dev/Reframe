/**
 * Timeline builder — declarative animation config → ITimeline.
 *
 * Converts the compact configuration shape the agent / UI writes
 * (`{ presets, stagger, sequences, loop, speed }`) into a fully-hydrated
 * ITimeline with resolved INodeAnimation[] entries, ready to feed into
 * `exportToAnimatedHtml` / `timelineToCss` / `exportToLottie`.
 *
 * Lives in core (not in the MCP tools layer) so standalone consumers —
 * CLI tools, test harnesses, downstream integrations — can build
 * timelines without re-implementing preset resolution and stagger math.
 *
 * Three composition modes, mixable in one config:
 *   presets[]   — one preset per node with optional delay + per-preset
 *                 duration/easing/distance override.
 *   stagger     — one preset applied across N nodes with a `staggerDelay`
 *                 between them. Used for feature-card reveals, list-item
 *                 enters, grid cascade effects.
 *   sequences[] — multi-preset chain per node with cumulative delay
 *                 (step i starts after step {i-1} minus `overlap`).
 *                 Useful for "enter then pulse" style punches.
 *
 * Returns the timeline + a list of human-readable warnings so callers
 * can surface "node 'X' not found" diagnostics to the user without
 * having to re-traverse the tree themselves.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import type { ITimeline, INodeAnimation } from './types.js';
import { presets, stagger as staggerFn, listPresets } from './presets.js';

export interface TimelineBuildConfig {
  presets?: Array<{
    nodeName: string;
    preset: string;
    delay?: number;
    duration?: number;
    easing?: string;
    distance?: number;
  }>;
  stagger?: {
    nodeNames: string[];
    preset: string;
    staggerDelay?: number;
    duration?: number;
    easing?: string;
    distance?: number;
  };
  sequences?: Array<{
    nodeName: string;
    chain: Array<{
      preset: string;
      duration?: number;
      easing?: string;
      distance?: number;
    }>;
    delay?: number;
    overlap?: number;
  }>;
  loop?: boolean;
  speed?: number;
}

export interface TimelineBuildResult {
  timeline: ITimeline;
  warnings: string[];
}

export function buildTimeline(
  graph: SceneGraph,
  rootId: string,
  animateConfig: TimelineBuildConfig,
): TimelineBuildResult {
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

  function resolveNode(nodeName: string): string | undefined {
    const nodeId = nameToId.get(nodeName);
    if (!nodeId) {
      warnings.push(`Node "${nodeName}" not found. Available: ${availableNodes.join(', ')}`);
    }
    return nodeId;
  }

  function buildCreateConfig(opts: { duration?: number; easing?: string; distance?: number }): Record<string, any> {
    const cfg: Record<string, any> = {};
    if (opts.duration !== undefined) cfg.duration = opts.duration;
    if (opts.easing !== undefined) cfg.easing = opts.easing;
    if (opts.distance !== undefined) cfg.distance = opts.distance;
    return cfg;
  }

  if (animateConfig.presets) {
    for (const p of animateConfig.presets) {
      const presetDef = (presets as Record<string, any>)[p.preset];
      if (!presetDef) {
        warnings.push(`Unknown preset "${p.preset}". Available: ${availablePresets.join(', ')}`);
        continue;
      }
      const nodeId = resolveNode(p.nodeName);
      const anim = presetDef.create(buildCreateConfig(p));
      animations.push({
        ...anim,
        nodeId,
        nodeName: p.nodeName,
        delay: p.delay ?? 0,
      });
    }
  }

  if (animateConfig.stagger) {
    const s = animateConfig.stagger;
    if (!(presets as Record<string, any>)[s.preset]) {
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
        const staggerConfig = buildCreateConfig(s);
        const staggered = staggerFn(ids, s.preset, {
          staggerDelay: s.staggerDelay ?? 100,
          ...(s.duration !== undefined && { duration: s.duration }),
          config: staggerConfig,
        });
        for (let i = 0; i < staggered.length; i++) {
          (staggered[i] as any).nodeName = resolvedNames[i];
        }
        animations.push(...(staggered as INodeAnimation[]));
      }
    }
  }

  if (animateConfig.sequences) {
    for (const seq of animateConfig.sequences) {
      const nodeId = resolveNode(seq.nodeName);
      const baseDelay = seq.delay ?? 0;
      const overlap = seq.overlap ?? 0;
      let cumulativeDelay = baseDelay;
      for (const step of seq.chain) {
        const presetDef = (presets as Record<string, any>)[step.preset];
        if (!presetDef) {
          warnings.push(`Sequence on "${seq.nodeName}": unknown preset "${step.preset}". Available: ${availablePresets.join(', ')}`);
          continue;
        }
        const anim = presetDef.create(buildCreateConfig(step));
        animations.push({
          ...anim,
          nodeId,
          nodeName: seq.nodeName,
          delay: cumulativeDelay,
        });
        cumulativeDelay += anim.duration - overlap;
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
