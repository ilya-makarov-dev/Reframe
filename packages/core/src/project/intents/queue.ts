/**
 * Phase 7.0 — Intent queue persistence layer.
 *
 * Storage: `.reframe/intents/queue.jsonl` (active intents) +
 *          `.reframe/intents/archive.jsonl` (terminal states).
 *
 * The queue is append-only JSONL — same pattern as Phase 3 history. Each line
 * is a full Intent snapshot. Updates append a new line with the same id; the
 * reader keeps the LATEST entry per id, so `updateIntent` is an atomic write
 * without a read-modify-write race.
 *
 * Archive is used for terminal-state intents (accepted / rejected / refined)
 * so the active queue file stays small and most queries don't scan through
 * finished work. Archiving is a file move, not a delete — creative history
 * is preserved for replay / audit.
 *
 * Concurrency notes:
 *   - `fs.appendFileSync` is atomic at POSIX level for lines under ~4KB.
 *   - Intents are typically small (<1KB serialized). Concurrent writes are
 *     safe up to file-system atomicity guarantees.
 *   - Reads see a consistent prefix — a partial line is skipped by the parser.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Intent, IntentStatus, IntentAuthor } from './types.js';

// ─── Paths ───────────────────────────────────────────────────

function intentsDir(projectDir: string): string {
  return path.join(projectDir, '.reframe', 'intents');
}

export function queueFilePath(projectDir: string): string {
  return path.join(intentsDir(projectDir), 'queue.jsonl');
}

export function archiveFilePath(projectDir: string): string {
  return path.join(intentsDir(projectDir), 'archive.jsonl');
}

// ─── ID generation ───────────────────────────────────────────

/** Monotonic counter within a process. Combined with `Date.now()` for
 *  collision-free ids even under burst writes. */
let _counter = 0;
export function nextIntentId(): string {
  return `i-${Date.now().toString(36)}-${(_counter++).toString(36)}`;
}

// ─── Low-level file I/O ─────────────────────────────────────

/**
 * Read all lines from a JSONL file, parse each as JSON, skip malformed.
 * Returns ordered list as on disk (chronological). Missing file → []. */
function readJsonl<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const out: T[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // Partial line at the tail (interrupted write) — skip, keep reading.
    }
  }
  return out;
}

/** Append one intent entry as a JSON line. Atomic at POSIX level for < 4KB. */
function appendJsonl(filePath: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Rewrite a JSONL file with a fresh list — used by compaction. */
function writeJsonl(filePath: string, entries: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = entries.length > 0
    ? entries.map(e => JSON.stringify(e)).join('\n') + '\n'
    : '';
  fs.writeFileSync(filePath, payload, 'utf-8');
}

// ─── Latest-wins reader ──────────────────────────────────────

/**
 * Collapse an append-only JSONL log into the latest snapshot per intent id.
 * Used by every read path so callers see the current state without touching
 * the append history.
 */
function collapseLatest(entries: Intent[]): Map<string, Intent> {
  const map = new Map<string, Intent>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !entry.id) continue;
    map.set(entry.id, entry);
  }
  return map;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Append an intent snapshot to the queue. If an intent with this id already
 * exists, this creates a new entry — the latest-wins reader picks the
 * newest. Used by both first-write (draft creation) and subsequent updates.
 */
export function writeIntent(projectDir: string, intent: Intent): void {
  appendJsonl(queueFilePath(projectDir), intent);
}

/**
 * Return every intent currently in the active queue (latest snapshot per id)
 * optionally filtered by status / author / scene / parent.
 */
export function listIntents(
  projectDir: string,
  filter: {
    status?: IntentStatus | IntentStatus[];
    authorKind?: IntentAuthor['kind'];
    sceneSlug?: string;
    parentId?: string;
    limit?: number;
    /** When true, also scan the archive file (slower but complete). */
    includeArchive?: boolean;
  } = {},
): Intent[] {
  const queue = collapseLatest(readJsonl<Intent>(queueFilePath(projectDir)));
  const all = new Map(queue);
  if (filter.includeArchive) {
    const archive = collapseLatest(readJsonl<Intent>(archiveFilePath(projectDir)));
    for (const [id, intent] of archive) {
      if (!all.has(id)) all.set(id, intent);
    }
  }

  const statuses = filter.status
    ? (Array.isArray(filter.status) ? new Set(filter.status) : new Set([filter.status]))
    : null;

  const out: Intent[] = [];
  for (const intent of all.values()) {
    if (statuses && !statuses.has(intent.status)) continue;
    if (filter.authorKind && intent.author.kind !== filter.authorKind) continue;
    if (filter.sceneSlug && intent.sceneSlug !== filter.sceneSlug) continue;
    if (filter.parentId && intent.parentId !== filter.parentId) continue;
    out.push(intent);
  }

  // Chronological order (creation time). Ties broken by id.
  out.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  if (typeof filter.limit === 'number' && out.length > filter.limit) {
    return out.slice(0, filter.limit);
  }
  return out;
}

/**
 * Get a single intent by id. Checks active queue first, falls back to archive.
 * Returns null when not found.
 */
export function getIntent(projectDir: string, id: string): Intent | null {
  const queue = collapseLatest(readJsonl<Intent>(queueFilePath(projectDir)));
  const q = queue.get(id);
  if (q) return q;
  const archive = collapseLatest(readJsonl<Intent>(archiveFilePath(projectDir)));
  return archive.get(id) ?? null;
}

/**
 * Remove ALL intents from the active queue regardless of status. Called by
 * the explicit `clear` MCP action when the human wants to start fresh.
 * Archive is untouched — creative history is preserved.
 */
export function clearQueue(projectDir: string): number {
  const queue = collapseLatest(readJsonl<Intent>(queueFilePath(projectDir)));
  const count = queue.size;
  writeJsonl(queueFilePath(projectDir), []);
  return count;
}

/**
 * Move every intent in terminal state (accepted/rejected/refined/archived)
 * from the active queue into the archive. Also compacts the active queue
 * file by collapsing latest-wins duplicates into a single line per intent.
 *
 * Called automatically when queue grows large, and exposed as an explicit
 * action for debugging.
 */
export function archiveTerminal(projectDir: string): { archived: number; compacted: number } {
  const queuePath = queueFilePath(projectDir);
  const archivePath = archiveFilePath(projectDir);

  const queue = collapseLatest(readJsonl<Intent>(queuePath));
  const active: Intent[] = [];
  const toArchive: Intent[] = [];
  const terminal = new Set<IntentStatus>(['accepted', 'rejected', 'refined', 'archived']);

  for (const intent of queue.values()) {
    if (terminal.has(intent.status)) {
      // Mark as 'archived' on write so future reads see the terminal tag.
      toArchive.push({ ...intent, status: 'archived' });
    } else {
      active.push(intent);
    }
  }

  // Compaction: rewrite the queue file with only the latest active snapshots.
  const compactedCount = Math.max(0, readJsonl<Intent>(queuePath).length - active.length);
  writeJsonl(queuePath, active);

  // Append-only archive — new entries go at the tail.
  if (toArchive.length > 0) {
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    const payload = toArchive.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(archivePath, payload, 'utf-8');
  }

  return { archived: toArchive.length, compacted: compactedCount };
}

/**
 * Convenience: count of intents in each status. Cheap because it reads the
 * collapsed queue once.
 */
export function countByStatus(projectDir: string): Record<IntentStatus, number> {
  const counts: Record<IntentStatus, number> = {
    draft: 0, queued: 0, processing: 0, proposed: 0,
    accepted: 0, rejected: 0, refined: 0, archived: 0,
  };
  const queue = collapseLatest(readJsonl<Intent>(queueFilePath(projectDir)));
  for (const intent of queue.values()) counts[intent.status]++;
  return counts;
}
