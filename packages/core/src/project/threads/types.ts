/**
 * Phase 8 — Thread model.
 *
 * A Thread is a conversation on a single anchor. Anchors are usually INode
 * ids (the same stable ids the rest of the engine uses), but can also be
 * scene-level ("scene:<slug>"), region-level ("region:<hash>"), or
 * project-level ("project"). Threads group intents and annotations so that
 * "all messages about this button" becomes a first-class query, not a graph
 * traversal of `parentId` pointers.
 *
 * Lifecycle:
 *
 *   active ──resolve──▶ resolved ──archive──▶ archived
 *     │                   ▲
 *     │                   │ reopen
 *     ├──orphan──▶ orphaned
 *     │              │
 *     │              ├── reopen (anchor came back)
 *     │              └── archive
 *     │
 *     └──archive──▶ archived  (hard stop)
 *
 * Threads never delete — archived threads persist for replay / audit.
 *
 * Why this matters: annotations and intents on the same anchor form a
 * conversation. Without a thread concept, the activity stream has to
 * reconstruct "is this comment a reply to that one" from parentId graph
 * edges. With threads, the grouping is explicit and persistent.
 */

import type { AnnotationId } from '../annotations/types.js';

export type ThreadId = string;

/** AnchorId naming convention:
 *   "n-xxx"           → INode id (scene graph node)
 *   "scene:<slug>"    → whole-scene anchor
 *   "region:<hash>"   → spatial region (lasso without clear ancestor)
 *   "project"         → project-level anchor
 */
export type AnchorId = string;

export type ThreadStatus =
  | 'active'    // live, accepting new messages
  | 'resolved'  // user marked done
  | 'orphaned'  // anchor node vanished from scene graph
  | 'archived'; // moved out of active set

/** All valid from → to transitions. Enforced at runtime. */
export const VALID_THREAD_TRANSITIONS: Record<ThreadStatus, ThreadStatus[]> = {
  active:   ['resolved', 'orphaned', 'archived'],
  resolved: ['active', 'archived'],
  orphaned: ['active', 'archived'],
  archived: [],
};

export interface Thread {
  /** Stable id. Format: `t-<ts36>-<counter36>`. */
  id: ThreadId;
  /** ISO timestamp of thread creation. */
  createdAt: string;
  /** ISO timestamp of last change (state, attach, detach). */
  updatedAt: string;
  /** Current lifecycle state. */
  status: ThreadStatus;

  /** What this thread is about. Usually an INode id. */
  anchor: AnchorId;
  /** Scene slug this thread lives on. Redundant with anchor but avoids
   *  parsing anchor strings for filters. */
  sceneSlug?: string;

  /** Optional human title. Derived from first message if omitted. */
  title?: string;

  /** Intent ids attached to this thread, in chronological order. */
  intentIds: string[];
  /** Annotation ids attached to this thread, in chronological order. */
  annotationIds: AnnotationId[];

  /** Who closed / orphaned this thread (when applicable). */
  resolvedBy?: { kind: 'human' | 'agent' | 'system'; id?: string };
  /** ISO timestamp when the thread moved into a terminal state. */
  resolvedAt?: string;
  /** Short human-readable reason for closure / orphaning. */
  resolution?: string;
}

/** Result of a thread-level action. Returned by lifecycle functions. */
export interface ThreadActionResult {
  ok: boolean;
  threadId?: ThreadId;
  status?: ThreadStatus;
  error?: string;
}
