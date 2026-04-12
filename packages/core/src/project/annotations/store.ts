/**
 * Phase 8 — Annotation persistence layer.
 *
 * Storage: `.reframe/annotations/annotations.jsonl` — append-only, latest-wins
 * reader, same pattern as intents/queue.ts and threads/store.ts.
 *
 * Annotations are small (< 2KB typical) so the file can hold thousands of
 * updates before compaction is needed. `compactAnnotations` rewrites the
 * file with one line per id when called.
 *
 * Integration with Threads:
 *   - Creating an annotation does NOT automatically create a thread. The
 *     caller is expected to either pass an existing threadId or use
 *     `ensureThread` from the threads subsystem first. This keeps the two
 *     stores decoupled (annotations can be created programmatically for
 *     testing without pulling in thread state).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  type Annotation,
  type AnnotationId,
  type AnnotationStatus,
  type AnnotationPayload,
  type AnnotationAuthor,
  type AnnotationActionResult,
  VALID_ANNOTATION_TRANSITIONS,
} from './types.js';

// ─── Paths ───────────────────────────────────────────────────

function annotationsDir(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'annotations');
}

export function annotationsFilePath(projectDir: string): string {
  return path.join(annotationsDir(projectDir), 'annotations.jsonl');
}

// ─── ID generation ───────────────────────────────────────────

let _counter = 0;
export function nextAnnotationId(): AnnotationId {
  return `a-${Date.now().toString(36)}-${(_counter++).toString(36)}`;
}

// ─── JSONL helpers (mirror the intent/thread stores) ────────

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

function collapseLatest(entries: Annotation[]): Map<AnnotationId, Annotation> {
  const map = new Map<AnnotationId, Annotation>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.id) continue;
    map.set(entry.id, entry);
  }
  return map;
}

// ─── Public API ─────────────────────────────────────────────

export interface CreateAnnotationParams {
  anchor: string;
  sceneSlug?: string;
  threadId: string;
  author: AnnotationAuthor;
  payload: AnnotationPayload;
}

/** Create a new active annotation. Written to disk before return. */
export function createAnnotation(
  projectDir: string,
  params: CreateAnnotationParams,
): Annotation {
  const now = new Date().toISOString();
  const annotation: Annotation = {
    id: nextAnnotationId(),
    createdAt: now,
    updatedAt: now,
    status: 'active',
    anchor: params.anchor,
    sceneSlug: params.sceneSlug,
    threadId: params.threadId,
    author: params.author,
    payload: params.payload,
  };
  writeAnnotation(projectDir, annotation);
  return annotation;
}

/** Append an annotation snapshot. Used by both create and update. */
export function writeAnnotation(projectDir: string, annotation: Annotation): void {
  appendJsonl(annotationsFilePath(projectDir), annotation);
}

export interface ListAnnotationsOpts {
  status?: AnnotationStatus | AnnotationStatus[];
  anchor?: string;
  sceneSlug?: string;
  threadId?: string;
  kind?: AnnotationPayload['kind'];
  authorKind?: AnnotationAuthor['kind'];
  /** When true, include dismissed annotations. Default: false. */
  includeDismissed?: boolean;
  limit?: number;
}

/** List annotations, latest-wins by id, filtered by the given options. */
export function listAnnotations(
  projectDir: string,
  opts: ListAnnotationsOpts = {},
): Annotation[] {
  const collapsed = collapseLatest(readJsonl<Annotation>(annotationsFilePath(projectDir)));
  const statuses = opts.status
    ? (Array.isArray(opts.status) ? new Set(opts.status) : new Set([opts.status]))
    : null;

  const out: Annotation[] = [];
  for (const a of collapsed.values()) {
    if (a.status === 'dismissed' && !opts.includeDismissed && opts.status !== 'dismissed') continue;
    if (statuses && !statuses.has(a.status)) continue;
    if (opts.anchor && a.anchor !== opts.anchor) continue;
    if (opts.sceneSlug && a.sceneSlug !== opts.sceneSlug) continue;
    if (opts.threadId && a.threadId !== opts.threadId) continue;
    if (opts.kind && a.payload.kind !== opts.kind) continue;
    if (opts.authorKind && a.author.kind !== opts.authorKind) continue;
    out.push(a);
  }

  // Chronological order (creation time). Ties broken by id.
  out.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  if (typeof opts.limit === 'number' && out.length > opts.limit) {
    return out.slice(0, opts.limit);
  }
  return out;
}

/** Get a single annotation by id. */
export function getAnnotation(projectDir: string, id: AnnotationId): Annotation | undefined {
  const collapsed = collapseLatest(readJsonl<Annotation>(annotationsFilePath(projectDir)));
  return collapsed.get(id);
}

/** Update an annotation — preserves id, threadId, createdAt. */
export function updateAnnotation(
  projectDir: string,
  id: AnnotationId,
  patch: Partial<Omit<Annotation, 'id' | 'createdAt' | 'threadId'>>,
): Annotation | undefined {
  const existing = getAnnotation(projectDir, id);
  if (!existing) return undefined;
  const updated: Annotation = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    threadId: existing.threadId,
    updatedAt: new Date().toISOString(),
  };
  writeAnnotation(projectDir, updated);
  return updated;
}

/** Transition an annotation to a new status. Validates against
 *  VALID_ANNOTATION_TRANSITIONS. */
export function transitionAnnotation(
  projectDir: string,
  id: AnnotationId,
  to: AnnotationStatus,
  meta?: { reason?: string },
): AnnotationActionResult {
  const existing = getAnnotation(projectDir, id);
  if (!existing) return { ok: false, error: `annotation not found: ${id}` };
  const allowed = VALID_ANNOTATION_TRANSITIONS[existing.status];
  if (!allowed.includes(to)) {
    return { ok: false, error: `invalid transition ${existing.status} → ${to}` };
  }

  const patch: Partial<Annotation> = { status: to };
  if (to === 'orphaned') {
    patch.orphanedAt = new Date().toISOString();
    patch.orphanedReason = meta?.reason;
  } else if (to === 'active') {
    // Re-activation clears orphan metadata.
    patch.orphanedAt = undefined;
    patch.orphanedReason = undefined;
  }

  const updated = updateAnnotation(projectDir, id, patch);
  return { ok: true, annotationId: id, status: updated?.status };
}

/** Re-anchor an orphaned annotation to a different node. Moves it back
 *  to 'active'. Only valid on orphaned annotations. */
export function reAnchorAnnotation(
  projectDir: string,
  id: AnnotationId,
  newAnchor: string,
): AnnotationActionResult {
  const existing = getAnnotation(projectDir, id);
  if (!existing) return { ok: false, error: `annotation not found: ${id}` };
  if (existing.status !== 'orphaned') {
    return { ok: false, error: 'only orphaned annotations can be re-anchored' };
  }
  const updated = updateAnnotation(projectDir, id, {
    anchor: newAnchor,
    status: 'active',
    orphanedAt: undefined,
    orphanedReason: undefined,
  });
  return { ok: true, annotationId: id, status: updated?.status };
}

/** Mark every active annotation whose anchor is not in `liveAnchors` as
 *  orphaned. Called after a scene graph mutation so orphans surface
 *  immediately. Scene / project / region anchors are never orphaned.
 *
 *  Returns the list of annotations that were transitioned. */
export function orphanMissingAnchors(
  projectDir: string,
  liveAnchors: Set<string>,
  sceneSlug?: string,
  reason?: string,
): Annotation[] {
  const active = listAnnotations(projectDir, { status: 'active', sceneSlug });
  const out: Annotation[] = [];
  for (const a of active) {
    if (
      a.anchor.startsWith('scene:') ||
      a.anchor.startsWith('project') ||
      a.anchor.startsWith('region:')
    ) continue;
    if (!liveAnchors.has(a.anchor)) {
      transitionAnnotation(projectDir, a.id, 'orphaned', { reason });
      const updated = getAnnotation(projectDir, a.id);
      if (updated) out.push(updated);
    }
  }
  return out;
}

/** Compact the annotations file — rewrite with only the latest snapshot
 *  per id. Returns the number of lines removed. */
export function compactAnnotations(projectDir: string): number {
  const file = annotationsFilePath(projectDir);
  const raw = readJsonl<Annotation>(file);
  const collapsed = Array.from(collapseLatest(raw).values());
  const saved = raw.length - collapsed.length;
  writeJsonl(file, collapsed);
  return saved;
}

/** Count annotations grouped by status. */
export function countByStatus(projectDir: string): Record<AnnotationStatus, number> {
  const counts: Record<AnnotationStatus, number> = {
    active: 0, orphaned: 0, resolved: 0, dismissed: 0,
  };
  const collapsed = collapseLatest(readJsonl<Annotation>(annotationsFilePath(projectDir)));
  for (const a of collapsed.values()) counts[a.status]++;
  return counts;
}
