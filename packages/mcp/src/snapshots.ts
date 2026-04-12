/**
 * In-memory snapshot store for user-initiated "Save" points.
 *
 * Ops history (handled separately in core/src/project/history.ts) is
 * a per-edit log — every reframe_edit call appends an op. Snapshots
 * are DIFFERENT — they're explicit checkpoints the user creates when
 * they want a known-good state to restore to. Think git tags vs git
 * reflog: ops are reflog, snapshots are tags.
 *
 * Each snapshot is a full serialized scene graph, stored by sceneId.
 * Restoring a snapshot replaces the in-memory graph in one atomic
 * operation (via replaceSessionSceneGraph), so there's no N-call undo
 * loop and no history scan. Load = instant.
 *
 * Snapshots are memory-only for now. Adding disk persistence later
 * just means `JSON.stringify(snapshot) → fs.writeFileSync` on save
 * and the reverse on server start.
 */

import type { SceneGraph } from '../../core/src/engine/scene-graph.js';
import { serializeSceneNode, deserializeToGraph, type INodeJSON } from '../../core/src/serialize.js';

export interface Snapshot {
  /** Stable id — `snap-<timestamp>-<random>`. Used as the restore key. */
  id: string;
  /** User-provided label. Falls back to a timestamp-based auto name. */
  label: string;
  /** Unix ms when the snapshot was created. */
  createdAt: number;
  /** Session scene id this snapshot belongs to. */
  sceneId: string;
  /** Session scene slug at save time (for display / cross-session lookup). */
  sceneSlug: string;
  /** Scene graph revision at save time. */
  revision: number;
  /** Node count — displayed in the history panel as context. */
  nodeCount: number;
  /** Serialized graph JSON (as INodeJSON tree for restore). */
  serialized: INodeJSON;
  /** Root node id at save time. */
  rootId: string;
}

// sceneId → ordered list of snapshots (oldest first)
const snapshotsBySceneId = new Map<string, Snapshot[]>();

const MAX_SNAPSHOTS_PER_SCENE = 30;

/**
 * Create a new snapshot of a scene's current graph state.
 * Returns the created Snapshot or null if the scene isn't found.
 */
export function createSnapshot(
  sceneId: string,
  sceneSlug: string,
  graph: SceneGraph,
  rootId: string,
  revision: number,
  nodeCount: number,
  label?: string,
): Snapshot {
  const id = `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const snap: Snapshot = {
    id,
    label: label && label.trim().length > 0
      ? label.trim()
      : `Save ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    createdAt: Date.now(),
    sceneId,
    sceneSlug,
    revision,
    nodeCount,
    serialized: serializeSceneNode(graph, rootId),
    rootId,
  };

  const list = snapshotsBySceneId.get(sceneId) ?? [];
  list.push(snap);
  // Cap the per-scene list — oldest entries are evicted so users don't
  // accumulate unbounded memory by leaving the tab open overnight.
  while (list.length > MAX_SNAPSHOTS_PER_SCENE) list.shift();
  snapshotsBySceneId.set(sceneId, list);

  return snap;
}

/** List snapshots for a scene, newest first. */
export function listSnapshots(sceneId: string): Snapshot[] {
  const list = snapshotsBySceneId.get(sceneId) ?? [];
  // Return newest first for display without mutating the canonical list
  return [...list].reverse();
}

/** Get a specific snapshot by id. */
export function getSnapshot(sceneId: string, snapshotId: string): Snapshot | undefined {
  const list = snapshotsBySceneId.get(sceneId);
  if (!list) return undefined;
  return list.find(s => s.id === snapshotId);
}

/** Delete a snapshot by id. */
export function deleteSnapshot(sceneId: string, snapshotId: string): boolean {
  const list = snapshotsBySceneId.get(sceneId);
  if (!list) return false;
  const idx = list.findIndex(s => s.id === snapshotId);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}

/**
 * Restore a snapshot into a fresh SceneGraph. The caller is responsible
 * for swapping it into the session store via replaceSessionSceneGraph.
 */
export function restoreSnapshot(snapshot: Snapshot): { graph: SceneGraph; rootId: string } | null {
  try {
    const result = deserializeToGraph(snapshot.serialized);
    return result;
  } catch {
    return null;
  }
}

/** Clear all snapshots for a scene (used on scene delete). */
export function clearSnapshots(sceneId: string): void {
  snapshotsBySceneId.delete(sceneId);
}

/** Clear everything (testing / reset). */
export function clearAllSnapshots(): void {
  snapshotsBySceneId.clear();
}
