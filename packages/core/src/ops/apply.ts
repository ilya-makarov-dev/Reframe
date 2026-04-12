/**
 * Operation dispatcher — applies a single Operation to a SceneGraph and
 * returns an OperationResult. Pure over the graph (no I/O): history
 * persistence lives in `project/history.ts`; this module only mutates.
 *
 * Contract for callers:
 *   - Missing-node errors return `ok: false` rather than throwing.
 *   - Unknown op types return `ok: false`, never throw — forward-compat when
 *     a newer schema is replayed on older code.
 *   - Ops are idempotent when the target node and inputs are unchanged:
 *     replaying the same op twice produces the same graph state.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { NodeMeta, TokenBindings } from '../engine/types';
import type { DesignSystem } from '../design-system/types';
import type { ITimeline, INodeAnimation } from '../animation/types';
import { getPreset } from '../animation/presets';
import type { Operation, OperationResult, ReplayResult } from './types';
import { autoBindTokens } from './auto-bind-tokens';

export interface ApplyContext {
  /** Scene root id — required so autoBindTokens can default its rootId. */
  rootId: string;
  /** DesignSystem — required for bindToken and autoBindTokens. */
  designSystem?: DesignSystem;
  /**
   * Phase 6: project directory — required for component ops
   * (extractComponent, instantiateComponent, unlinkInstance). When absent,
   * those ops return ok=false with an instructive error. The engine replay
   * path populates this from the compileHtmlIntoProject context, so
   * replayed component ops "just work" without the caller threading dir
   * through every call site.
   */
  projectDir?: string;
  /**
   * Phase 6: dependency-injected component registry functions. Broken out
   * so apply.ts stays free of a direct import from project/components.ts,
   * which imports from serialize.ts, which imports types from here — a
   * circular chain that would otherwise require dynamic import. Callers
   * (io.ts::compileHtmlIntoProject) provide these bindings at call time.
   */
  componentAPI?: {
    saveComponentMaster: (
      projectDir: string,
      name: string,
      graph: SceneGraph,
      rootId: string,
      options?: { description?: string },
    ) => unknown;
    createInstancePlaceholder: (
      graph: SceneGraph,
      parentId: string,
      componentName: string,
      overrides?: Record<string, Record<string, unknown>>,
      options?: { id?: string; name?: string; x?: number; y?: number },
    ) => SceneNodeLike;
  };
}

/** Structural duck type so ApplyContext doesn't transitively import SceneNode. */
type SceneNodeLike = { id: string };

/**
 * Apply one Operation to a graph. Returns a structured result with the
 * success flag, affected ids, and a one-line summary for logging.
 */
export function applyOperation(
  graph: SceneGraph,
  op: Operation,
  context: ApplyContext,
): OperationResult {
  switch (op.type) {
    case 'setProps': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'setProps');
      graph.updateNode(op.nodeId, op.props as any);
      return {
        ok: true,
        affectedNodeIds: [op.nodeId],
        summary: `setProps ${op.nodeId} (${Object.keys(op.props).length} props)`,
      };
    }

    case 'bindToken': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'bindToken');
      // Merge with any existing bindings so explicit bindToken after an
      // autoBindTokens pass keeps the auto bindings for other properties.
      const currentBindings = node.meta?.tokenBindings ?? {};
      const nextBindings: TokenBindings = { ...currentBindings, [op.property]: op.token };
      const newMeta: NodeMeta = { ...(node.meta ?? {}), tokenBindings: nextBindings };
      graph.updateNode(op.nodeId, { meta: newMeta } as any);
      return {
        ok: true,
        affectedNodeIds: [op.nodeId],
        summary: `bindToken ${op.property}=${op.token} on ${op.nodeId}`,
      };
    }

    case 'autoBindTokens': {
      if (!context.designSystem) {
        return {
          ok: false,
          affectedNodeIds: [],
          error: 'autoBindTokens requires an active designSystem in the apply context',
        };
      }
      const rootId = op.rootId ?? context.rootId;
      const result = autoBindTokens(graph, rootId, context.designSystem, {
        colorTolerance: op.colorTolerance,
        fontSizeTolerance: op.fontSizeTolerance,
      });
      return {
        ok: true,
        affectedNodeIds: result.boundNodes,
        summary: `autoBindTokens bound=${result.boundNodes.length} skipped=${result.skippedNodes.length}`,
      };
    }

    case 'addState': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'addState');
      // Replace rather than deep-merge the state payload — replay idempotence
      // relies on "second apply of the same op = same final state".
      const states = { ...(node.states ?? {}), [op.state]: op.props };
      graph.updateNode(op.nodeId, { states } as any);
      return {
        ok: true,
        affectedNodeIds: [op.nodeId],
        summary: `addState ${op.state} on ${op.nodeId}`,
      };
    }

    case 'setResponsive': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'setResponsive');
      const existing = node.responsive ?? [];
      // Replace an existing breakpoint with the same maxWidth; otherwise push.
      const filtered = existing.filter(r => r.maxWidth !== op.maxWidth);
      const next = [...filtered, { maxWidth: op.maxWidth, props: op.props as any }];
      // Sort descending by maxWidth so exporters / responsive consumers can
      // pick the first matching rule at a given viewport width.
      next.sort((a, b) => b.maxWidth - a.maxWidth);
      graph.updateNode(op.nodeId, { responsive: next } as any);
      return {
        ok: true,
        affectedNodeIds: [op.nodeId],
        summary: `setResponsive maxWidth=${op.maxWidth} on ${op.nodeId}`,
      };
    }

    // ── Phase 5: animation ops ──────────────────────────
    case 'addPresetAnimation': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'addPresetAnimation');
      const preset = getPreset(op.preset);
      if (!preset) {
        return {
          ok: false,
          affectedNodeIds: [],
          error: `addPresetAnimation: unknown preset "${op.preset}"`,
        };
      }
      const base = preset.create(op.config as any ?? {});
      const animation: INodeAnimation = {
        nodeId: op.nodeId,
        name: `${op.preset}@${op.nodeId}`,
        ...base,
        delay: op.delay ?? 0,
      };
      addAnimationToGraph(graph, animation);
      return {
        ok: true,
        affectedNodeIds: [op.nodeId],
        summary: `addPresetAnimation ${op.preset} on ${op.nodeId}`,
      };
    }

    case 'addAnimation': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'addAnimation');
      // Deep-copy the incoming payload so replay won't alias a reference held
      // by the history log reader — mutating a replayed op must not poison
      // subsequent replays.
      const cloned: INodeAnimation = {
        ...(JSON.parse(JSON.stringify(op.animation)) as INodeAnimation),
        nodeId: op.nodeId,
      };
      if (!cloned.keyframes || cloned.keyframes.length < 2) {
        return {
          ok: false,
          affectedNodeIds: [],
          error: `addAnimation: animation must have at least 2 keyframes`,
        };
      }
      addAnimationToGraph(graph, cloned);
      return {
        ok: true,
        affectedNodeIds: [op.nodeId],
        summary: `addAnimation on ${op.nodeId}`,
      };
    }

    case 'clearAnimations': {
      const timeline = graph.timeline as ITimeline | null;
      if (!timeline || !timeline.animations) {
        return { ok: true, affectedNodeIds: [], summary: `clearAnimations (no timeline)` };
      }
      const before = timeline.animations.length;
      timeline.animations = timeline.animations.filter(a => a.nodeId !== op.nodeId);
      const removed = before - timeline.animations.length;
      return {
        ok: true,
        affectedNodeIds: removed > 0 ? [op.nodeId] : [],
        summary: `clearAnimations removed=${removed} on ${op.nodeId}`,
      };
    }

    // ── Phase 6: component ops ──────────────────────────
    case 'extractComponent': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'extractComponent');
      if (!context.projectDir || !context.componentAPI) {
        return {
          ok: false,
          affectedNodeIds: [],
          error: 'extractComponent requires projectDir + componentAPI in the apply context',
        };
      }
      // Save the subtree as a component master on disk.
      context.componentAPI.saveComponentMaster(
        context.projectDir, op.name, graph, op.nodeId, { description: op.description },
      );
      // Replace the subtree with an INSTANCE placeholder under the same
      // parent, at the same position, with the same id so downstream ops
      // targeting this node keep working. Collapse-hydrate on next load
      // will re-inflate it from the master.
      const parent = node.parentId ? graph.getNode(node.parentId) : null;
      if (!parent) {
        return {
          ok: false,
          affectedNodeIds: [],
          error: 'extractComponent: target has no parent (cannot replace scene root)',
        };
      }
      // Snapshot fields we need to preserve on the replacement instance.
      const keepId = node.id;
      const keepName = node.name;
      const keepX = node.x;
      const keepY = node.y;
      const keepMeta = { ...(node.meta ?? {}), componentName: op.name };
      // Delete the original subtree first so the placeholder slot is free.
      // deleteNode cascades to children, matching Phase 6 contract (the
      // subtree is now on disk as a master, the scene only needs a pointer).
      graph.deleteNode(node.id);
      // Re-create placeholder with the SAME id. createInstancePlaceholder
      // accepts an explicit id via options.id, which we pass so downstream
      // callers that already held a reference to this node id keep working.
      const inst = (context.componentAPI as any).createInstancePlaceholder(
        graph, parent.id, op.name, {},
        { id: keepId, name: keepName, x: keepX, y: keepY },
      );
      // Meta is set via createInstancePlaceholder's internal write, but we
      // merge in any agent-side meta fields that were on the original node.
      graph.updateNode(inst.id, { meta: keepMeta } as any);
      return {
        ok: true,
        affectedNodeIds: [inst.id],
        summary: `extractComponent "${op.name}" from ${keepId} (placeholder id=${inst.id})`,
      };
    }

    case 'instantiateComponent': {
      const parent = graph.getNode(op.parentId);
      if (!parent) return miss(op.parentId, 'instantiateComponent');
      if (!context.componentAPI) {
        return {
          ok: false,
          affectedNodeIds: [],
          error: 'instantiateComponent requires componentAPI in the apply context',
        };
      }
      const inst = context.componentAPI.createInstancePlaceholder(
        graph, op.parentId, op.componentName, op.overrides ?? {},
        { name: op.name },
      );
      return {
        ok: true,
        affectedNodeIds: [inst.id],
        summary: `instantiateComponent ${op.componentName} under ${op.parentId}`,
      };
    }

    case 'unlinkInstance': {
      const node = graph.getNode(op.nodeId);
      if (!node) return miss(op.nodeId, 'unlinkInstance');
      // Drop the componentName link and clear overrides. The cloned
      // children stay in place — they are now plain scene content, not a
      // hydrated instance. We also change type to FRAME so serialize
      // records it as a normal container.
      const newMeta = { ...(node.meta ?? {}) } as any;
      delete newMeta.componentName;
      graph.updateNode(op.nodeId, {
        type: 'FRAME' as any,
        overrides: {},
        meta: newMeta,
      } as any);
      return {
        ok: true,
        affectedNodeIds: [op.nodeId],
        summary: `unlinkInstance ${op.nodeId}`,
      };
    }

    default: {
      // Forward-compat: older binaries replaying a newer history won't throw.
      const unknown: any = op;
      return {
        ok: false,
        affectedNodeIds: [],
        error: `Unknown operation type "${unknown.type ?? '<undefined>'}"`,
      };
    }
  }
}

/**
 * Apply a list of operations in order. Does NOT stop on failure — each op is
 * attempted independently, matching the "graceful degradation" contract for
 * stale ids after source-HTML edits.
 */
export function replayOperations(
  graph: SceneGraph,
  ops: Operation[],
  context: ApplyContext,
): ReplayResult {
  let applied = 0;
  let failed = 0;
  const results: OperationResult[] = [];
  for (const op of ops) {
    const r = applyOperation(graph, op, context);
    results.push(r);
    if (r.ok) applied++;
    else failed++;
  }
  return { applied, failed, results };
}

function miss(nodeId: string, op: string): OperationResult {
  return {
    ok: false,
    affectedNodeIds: [],
    error: `${op}: node "${nodeId}" not found (source HTML may have removed this subtree)`,
  };
}

/**
 * Append an animation to the scene's timeline, creating the timeline on
 * demand. Existing animations that target the same node with the same name
 * are replaced rather than duplicated so replay stays idempotent.
 */
function addAnimationToGraph(graph: SceneGraph, animation: INodeAnimation): void {
  const existing = (graph.timeline as ITimeline | null) ?? {
    name: 'scene',
    animations: [],
  };
  // Drop any prior animation with the same (nodeId, name) — replay of the
  // same op twice should leave the timeline in the same state, not double.
  const filtered = existing.animations.filter(a => {
    if (a.nodeId !== animation.nodeId) return true;
    return a.name !== animation.name;
  });
  filtered.push(animation);
  graph.timeline = { ...existing, animations: filtered };
}
