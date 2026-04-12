/**
 * Phase 8 — Orphan garbage collection.
 *
 * When a scene graph mutates (ops applied, scene re-compiled, variant
 * refreshed), nodes can disappear — and any thread or annotation
 * anchored to a vanished node needs to be marked orphaned so the
 * activity stream can surface it as an event requiring user decision.
 *
 * This module provides one function: `sweepOrphans(projectDir, sceneSlug,
 * graph)`. It walks the live graph, collects the current INode id set,
 * and calls `orphanMissingAnchors` on both the thread store and the
 * annotation store with that set.
 *
 * Best-effort: any failure is swallowed silently. A broken annotation
 * store must NEVER break a scene save — the mutation is always more
 * important than its GC consequences.
 */

import type { SceneGraph } from '../engine/scene-graph.js';
import {
  orphanMissingAnchors as orphanMissingThreads,
  type Thread,
} from './threads/index.js';
import {
  orphanMissingAnchors as orphanMissingAnnotations,
  type Annotation,
} from './annotations/index.js';

export interface OrphanSweepResult {
  threadsOrphaned: Thread[];
  annotationsOrphaned: Annotation[];
}

/**
 * Collect every live INode id from the graph into a Set. Used as the
 * `liveAnchors` input for both orphan sweepers. This is cheap — we do
 * one iteration over graph.getAllNodes().
 */
export function collectLiveAnchors(graph: SceneGraph): Set<string> {
  const live = new Set<string>();
  for (const node of graph.getAllNodes()) {
    live.add(node.id);
  }
  return live;
}

/**
 * Sweep threads + annotations for the given scene, marking any whose
 * anchor is no longer in the live graph as orphaned. Safe to call on
 * every scene save — does nothing when no annotations exist.
 *
 * The `reason` string is stored on orphaned items so the UI can show
 * "orphaned by: <op X>" instead of a mysterious state change.
 */
export function sweepOrphans(
  projectDir: string,
  sceneSlug: string,
  graph: SceneGraph,
  reason?: string,
): OrphanSweepResult {
  const result: OrphanSweepResult = {
    threadsOrphaned: [],
    annotationsOrphaned: [],
  };
  try {
    const live = collectLiveAnchors(graph);
    result.threadsOrphaned = orphanMissingThreads(
      projectDir,
      live,
      sceneSlug,
      reason ?? 'scene graph mutation',
    );
    result.annotationsOrphaned = orphanMissingAnnotations(
      projectDir,
      live,
      sceneSlug,
      reason ?? 'scene graph mutation',
    );
  } catch {
    // Best-effort — never break the caller's mutation.
  }
  return result;
}
