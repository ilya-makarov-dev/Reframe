/**
 * Phase 8 — Thread persistence layer.
 *
 * Storage: `.reframe/threads/threads.jsonl` (all threads, append-only).
 * Same JSONL latest-wins pattern as intents/queue.ts — each update appends
 * a new line, readers collapse via Map.
 *
 * No separate archive file for threads (unlike intents). Archived threads
 * stay in the main file because the resolution-to-archive ratio is much
 * lower — most threads resolve or orphan but stay as design history.
 * Compaction rewrites the file when the latest-wins reader throws away
 * >50% of lines.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  type Thread,
  type ThreadId,
  type ThreadStatus,
  type ThreadActionResult,
  type AnchorId,
  VALID_THREAD_TRANSITIONS,
} from './types.js';

// ─── Paths ───────────────────────────────────────────────────

function threadsDir(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'threads');
}

export function threadsFilePath(projectDir: string): string {
  return path.join(threadsDir(projectDir), 'threads.jsonl');
}

// ─── ID generation ───────────────────────────────────────────

let _counter = 0;
export function nextThreadId(): ThreadId {
  return `t-${Date.now().toString(36)}-${(_counter++).toString(36)}`;
}

// ─── JSONL helpers (mirror intents/queue.ts pattern) ─────────

function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const out: T[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed) as T); } catch { /* skip partial */ }
  }
  return out;
}

function appendJsonl(filePath: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

function writeJsonl(filePath: string, entries: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = entries.length > 0
    ? entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  fs.writeFileSync(filePath, payload, 'utf-8');
}

function collapseLatest(entries: Thread[]): Map<ThreadId, Thread> {
  const map = new Map<ThreadId, Thread>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.id) continue;
    map.set(entry.id, entry);
  }
  return map;
}

// ─── Public API ─────────────────────────────────────────────

export interface CreateThreadParams {
  anchor: AnchorId;
  sceneSlug?: string;
  title?: string;
}

/** Create a new active thread on the given anchor. Thread is written to
 *  disk before returning — caller can trust the id survives a crash. */
export function createThread(projectDir: string, params: CreateThreadParams): Thread {
  const now = new Date().toISOString();
  const thread: Thread = {
    id: nextThreadId(),
    createdAt: now,
    updatedAt: now,
    status: 'active',
    anchor: params.anchor,
    sceneSlug: params.sceneSlug,
    title: params.title,
    intentIds: [],
    annotationIds: [],
  };
  writeThread(projectDir, thread);
  return thread;
}

/** Append a thread snapshot. Used by both create and update — readers
 *  collapse latest-wins, so updates are just new appends. */
export function writeThread(projectDir: string, thread: Thread): void {
  appendJsonl(threadsFilePath(projectDir), thread);
}

export interface ListThreadsOpts {
  status?: ThreadStatus | ThreadStatus[];
  anchor?: AnchorId;
  sceneSlug?: string;
  /** When true, include archived threads in the result. */
  includeArchived?: boolean;
  limit?: number;
}

/** List threads, latest-wins by id, filtered by the given options. */
export function listThreads(projectDir: string, opts: ListThreadsOpts = {}): Thread[] {
  const collapsed = collapseLatest(readJsonl<Thread>(threadsFilePath(projectDir)));
  const statuses = opts.status
    ? (Array.isArray(opts.status) ? new Set(opts.status) : new Set([opts.status]))
    : null;

  const out: Thread[] = [];
  for (const t of collapsed.values()) {
    if (t.status === 'archived' && !opts.includeArchived && opts.status !== 'archived') continue;
    if (statuses && !statuses.has(t.status)) continue;
    if (opts.anchor && t.anchor !== opts.anchor) continue;
    if (opts.sceneSlug && t.sceneSlug !== opts.sceneSlug) continue;
    out.push(t);
  }

  // Most-recently-updated first — conversation view wants freshness.
  out.sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  if (typeof opts.limit === 'number' && out.length > opts.limit) {
    return out.slice(0, opts.limit);
  }
  return out;
}

/** Get a single thread by id, or undefined. */
export function getThread(projectDir: string, id: ThreadId): Thread | undefined {
  const collapsed = collapseLatest(readJsonl<Thread>(threadsFilePath(projectDir)));
  return collapsed.get(id);
}

/** Update a thread — preserves id + createdAt, bumps updatedAt. */
export function updateThread(
  projectDir: string,
  id: ThreadId,
  patch: Partial<Omit<Thread, 'id' | 'createdAt'>>,
): Thread | undefined {
  const existing = getThread(projectDir, id);
  if (!existing) return undefined;
  const updated: Thread = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  writeThread(projectDir, updated);
  return updated;
}

/** Attach an intent to a thread. No-op if already attached. */
export function attachIntent(
  projectDir: string,
  threadId: ThreadId,
  intentId: string,
): Thread | undefined {
  const t = getThread(projectDir, threadId);
  if (!t) return undefined;
  if (t.intentIds.includes(intentId)) return t;
  return updateThread(projectDir, threadId, {
    intentIds: [...t.intentIds, intentId],
  });
}

/** Attach an annotation to a thread. No-op if already attached. */
export function attachAnnotation(
  projectDir: string,
  threadId: ThreadId,
  annotationId: string,
): Thread | undefined {
  const t = getThread(projectDir, threadId);
  if (!t) return undefined;
  if (t.annotationIds.includes(annotationId)) return t;
  return updateThread(projectDir, threadId, {
    annotationIds: [...t.annotationIds, annotationId],
  });
}

/** Transition a thread to a new status. Validates against VALID_THREAD_TRANSITIONS. */
export function transitionThread(
  projectDir: string,
  id: ThreadId,
  to: ThreadStatus,
  meta?: { resolvedBy?: Thread['resolvedBy']; resolution?: string },
): ThreadActionResult {
  const t = getThread(projectDir, id);
  if (!t) return { ok: false, error: `thread not found: ${id}` };
  const allowed = VALID_THREAD_TRANSITIONS[t.status];
  if (!allowed.includes(to)) {
    return { ok: false, error: `invalid transition ${t.status} → ${to}` };
  }
  const patch: Partial<Thread> = {
    status: to,
    resolvedBy: meta?.resolvedBy,
    resolution: meta?.resolution,
  };
  if (to === 'resolved' || to === 'orphaned' || to === 'archived') {
    patch.resolvedAt = new Date().toISOString();
  } else if (to === 'active') {
    // Reopening — clear resolution metadata.
    patch.resolvedAt = undefined;
    patch.resolvedBy = undefined;
    patch.resolution = undefined;
  }
  const updated = updateThread(projectDir, id, patch);
  return { ok: true, threadId: id, status: updated?.status };
}

/** Find the most recently updated active thread on the given anchor, or
 *  undefined. Used by `ensureThread` to dedupe creation. */
export function findActiveThreadByAnchor(
  projectDir: string,
  anchor: AnchorId,
  sceneSlug?: string,
): Thread | undefined {
  const threads = listThreads(projectDir, { anchor, sceneSlug, status: 'active' });
  return threads[0];
}

/** Get or create an active thread for this anchor. Idempotent — if an
 *  active thread already exists on the anchor, returns it. */
export function ensureThread(
  projectDir: string,
  anchor: AnchorId,
  sceneSlug?: string,
  title?: string,
): Thread {
  const existing = findActiveThreadByAnchor(projectDir, anchor, sceneSlug);
  if (existing) return existing;
  return createThread(projectDir, { anchor, sceneSlug, title });
}

/** Compact the threads file — rewrite with only the latest snapshot per id.
 *  Call when the file grows much larger than the collapsed view. */
export function compactThreads(projectDir: string): number {
  const file = threadsFilePath(projectDir);
  const raw = readJsonl<Thread>(file);
  const collapsed = Array.from(collapseLatest(raw).values());
  const saved = raw.length - collapsed.length;
  writeJsonl(file, collapsed);
  return saved;
}

/** Mark threads whose anchor is no longer in the live node set as orphaned.
 *  Called after a scene mutation to keep thread state honest. Returns the
 *  list of threads that were transitioned. */
export function orphanMissingAnchors(
  projectDir: string,
  liveAnchors: Set<AnchorId>,
  sceneSlug?: string,
  reason?: string,
): Thread[] {
  const active = listThreads(projectDir, { status: 'active', sceneSlug });
  const out: Thread[] = [];
  for (const t of active) {
    // Non-node anchors are never orphaned — scene/project/region anchors
    // don't depend on individual nodes.
    if (
      t.anchor.startsWith('scene:') ||
      t.anchor.startsWith('project') ||
      t.anchor.startsWith('region:')
    ) continue;
    if (!liveAnchors.has(t.anchor)) {
      transitionThread(projectDir, t.id, 'orphaned', {
        resolvedBy: { kind: 'system' },
        resolution: reason ?? 'anchor node removed',
      });
      const updated = getThread(projectDir, t.id);
      if (updated) out.push(updated);
    }
  }
  return out;
}
