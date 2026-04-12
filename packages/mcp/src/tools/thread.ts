/**
 * reframe_thread — Phase 8 MCP surface for the Thread subsystem.
 *
 * A Thread is a conversation on a single anchor. It groups intents and
 * annotations so "all messages about this button" becomes a first-class
 * query. Threads are automatically created when annotations or intents
 * attach to an anchor (via ensureThread), but this tool lets the agent
 * inspect, transition, and manage them explicitly.
 *
 * Actions:
 *
 *   Authoring:
 *     add              — create a new active thread on an anchor
 *     ensure           — idempotent: return existing active thread or create one
 *     attach_intent    — link an intent to a thread
 *     attach_annotation — link an annotation to a thread
 *     update           — patch title / other mutable fields
 *     transition       — lifecycle state change
 *     resolve          — shortcut: transition to resolved
 *     reopen           — shortcut: transition to active from resolved/orphaned
 *     archive          — shortcut: transition to archived (terminal)
 *
 *   Inspection:
 *     list             — filtered list of threads
 *     get              — single thread by id
 *     on_anchor        — find active thread on a given anchor
 *
 *   Maintenance:
 *     orphan_missing   — sweep: transition threads whose anchor is gone
 *     compact          — rewrite file with latest snapshot per id
 */

import { z } from 'zod';
import {
  createThread,
  ensureThread,
  attachIntent,
  attachAnnotation,
  updateThread,
  transitionThread,
  listThreads,
  getThread,
  findActiveThreadByAnchor,
  compactThreads,
  orphanMissingAnchors,
  type Thread,
  type ThreadStatus,
} from '../../../core/src/project/threads/index.js';
import { getProjectDir } from './project.js';

// ─── Schema ──────────────────────────────────────────────────

export const threadInputSchema = {
  action: z
    .enum([
      'add', 'ensure', 'attach_intent', 'attach_annotation',
      'update', 'transition', 'resolve', 'reopen', 'archive',
      'list', 'get', 'on_anchor',
      'orphan_missing', 'compact',
    ])
    .describe(
      'Action: add, ensure (idempotent get-or-create), attach_intent, attach_annotation, update, transition (to any valid state), resolve/reopen/archive (shortcut transitions), list, get, on_anchor (find active thread on anchor), orphan_missing, compact',
    ),

  // Targeting
  threadId: z.string().optional().describe('Thread id — required for update/transition/resolve/reopen/archive/attach_*/get'),
  anchor: z.string().optional().describe('Anchor id — usually INode id, or "scene:<slug>" / "region:<hash>" / "project". Required for add/ensure/on_anchor.'),
  sceneSlug: z.string().optional().describe('Scene slug this thread lives on (for filters)'),
  title: z.string().optional().describe('Optional human title for the thread'),

  // Attach
  intentId: z.string().optional().describe('Intent id for attach_intent'),
  annotationId: z.string().optional().describe('Annotation id for attach_annotation'),

  // Lifecycle
  toStatus: z.enum(['active', 'resolved', 'orphaned', 'archived']).optional().describe('Target status for transition'),
  resolvedBy: z.object({
    kind: z.enum(['human', 'agent', 'system']),
    id: z.string().optional(),
  }).optional().describe('Who closed/orphaned the thread — stored as resolvedBy metadata'),
  resolution: z.string().optional().describe('Short reason for resolve/archive/orphan'),

  // Filters
  status: z.union([
    z.enum(['active', 'resolved', 'orphaned', 'archived']),
    z.array(z.enum(['active', 'resolved', 'orphaned', 'archived'])),
  ]).optional().describe('Status filter for list'),
  includeArchived: z.boolean().optional().describe('Include archived threads in list results'),
  limit: z.number().optional().describe('Max results for list'),

  // Orphan sweep
  liveAnchors: z.array(z.string()).optional().describe('Set of anchor ids alive in scene graph — for orphan_missing'),
};

// ─── Handler ─────────────────────────────────────────────────

export async function handleThread(input: {
  action: string;
  threadId?: string;
  anchor?: string;
  sceneSlug?: string;
  title?: string;
  intentId?: string;
  annotationId?: string;
  toStatus?: ThreadStatus;
  resolvedBy?: Thread['resolvedBy'];
  resolution?: string;
  status?: ThreadStatus | ThreadStatus[];
  includeArchived?: boolean;
  limit?: number;
  liveAnchors?: string[];
}) {
  try {
    const projectDir = getProjectDir();
    if (!projectDir) {
      return err('No project open. Use reframe_project init or open first.');
    }

    switch (input.action) {
      // ── Authoring ──────────────────────
      case 'add': {
        if (!input.anchor) return err('anchor is required for add');
        const thread = createThread(projectDir, {
          anchor: input.anchor,
          sceneSlug: input.sceneSlug,
          title: input.title,
        });
        return ok(formatThread(thread, { verbose: true }));
      }

      case 'ensure': {
        if (!input.anchor) return err('anchor is required for ensure');
        const thread = ensureThread(projectDir, input.anchor, input.sceneSlug, input.title);
        return ok(formatThread(thread, { verbose: true }));
      }

      case 'attach_intent': {
        if (!input.threadId) return err('threadId is required for attach_intent');
        if (!input.intentId) return err('intentId is required for attach_intent');
        const updated = attachIntent(projectDir, input.threadId, input.intentId);
        if (!updated) return err(`Thread ${input.threadId} not found`);
        return ok(`Intent ${input.intentId} attached to thread ${input.threadId} (${updated.intentIds.length} total).`);
      }

      case 'attach_annotation': {
        if (!input.threadId) return err('threadId is required for attach_annotation');
        if (!input.annotationId) return err('annotationId is required for attach_annotation');
        const updated = attachAnnotation(projectDir, input.threadId, input.annotationId);
        if (!updated) return err(`Thread ${input.threadId} not found`);
        return ok(`Annotation ${input.annotationId} attached to thread ${input.threadId} (${updated.annotationIds.length} total).`);
      }

      case 'update': {
        if (!input.threadId) return err('threadId is required for update');
        const patch: Partial<Thread> = {};
        if (input.title !== undefined) patch.title = input.title;
        const updated = updateThread(projectDir, input.threadId, patch);
        if (!updated) return err(`Thread ${input.threadId} not found`);
        return ok(formatThread(updated));
      }

      case 'transition': {
        if (!input.threadId) return err('threadId is required for transition');
        if (!input.toStatus) return err('toStatus is required for transition');
        const result = transitionThread(projectDir, input.threadId, input.toStatus, {
          resolvedBy: input.resolvedBy,
          resolution: input.resolution,
        });
        if (!result.ok) return err(result.error ?? 'transition failed');
        return ok(`Thread ${input.threadId} → ${input.toStatus}`);
      }

      case 'resolve': {
        if (!input.threadId) return err('threadId is required for resolve');
        const result = transitionThread(projectDir, input.threadId, 'resolved', {
          resolvedBy: input.resolvedBy ?? { kind: 'human' },
          resolution: input.resolution,
        });
        if (!result.ok) return err(result.error ?? 'resolve failed');
        return ok(`Thread ${input.threadId} resolved${input.resolution ? `: ${input.resolution}` : ''}`);
      }

      case 'reopen': {
        if (!input.threadId) return err('threadId is required for reopen');
        const result = transitionThread(projectDir, input.threadId, 'active');
        if (!result.ok) return err(result.error ?? 'reopen failed');
        return ok(`Thread ${input.threadId} reopened → active`);
      }

      case 'archive': {
        if (!input.threadId) return err('threadId is required for archive');
        const result = transitionThread(projectDir, input.threadId, 'archived');
        if (!result.ok) return err(result.error ?? 'archive failed');
        return ok(`Thread ${input.threadId} archived`);
      }

      // ── Inspection ─────────────────────
      case 'list': {
        const threads = listThreads(projectDir, {
          status: input.status,
          sceneSlug: input.sceneSlug,
          includeArchived: input.includeArchived,
          limit: input.limit,
        });
        if (threads.length === 0) return ok('No threads match the filter.');
        const lines = [`${threads.length} thread(s):`];
        for (const t of threads) lines.push('  ' + formatThread(t));
        return ok(lines.join('\n'));
      }

      case 'get': {
        if (!input.threadId) return err('threadId is required for get');
        const thread = getThread(projectDir, input.threadId);
        if (!thread) return err(`Thread ${input.threadId} not found`);
        return ok(formatThread(thread, { verbose: true }));
      }

      case 'on_anchor': {
        if (!input.anchor) return err('anchor is required for on_anchor');
        const thread = findActiveThreadByAnchor(projectDir, input.anchor, input.sceneSlug);
        if (!thread) return ok(`No active thread on anchor "${input.anchor}".`);
        return ok(formatThread(thread, { verbose: true }));
      }

      // ── Maintenance ────────────────────
      case 'orphan_missing': {
        if (!input.liveAnchors) return err('liveAnchors[] is required for orphan_missing');
        const live = new Set(input.liveAnchors);
        const orphaned = orphanMissingAnchors(projectDir, live, input.sceneSlug, input.resolution);
        return ok(`${orphaned.length} thread(s) orphaned.`);
      }

      case 'compact': {
        const saved = compactThreads(projectDir);
        return ok(`Compacted threads file: ${saved} duplicate lines removed.`);
      }

      default:
        return err(`Unknown action "${input.action}"`);
    }
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
}

// ─── Formatting ──────────────────────────────────────────────

function formatThread(t: Thread, options: { verbose?: boolean } = {}): string {
  const title = t.title ? ` "${t.title}"` : '';
  const counts = `${t.intentIds.length}i/${t.annotationIds.length}a`;
  const resolved = t.resolution ? ` — ${t.resolution}` : '';
  const head = `${t.id} · ${t.status}${title} · @${t.anchor} · ${counts}${resolved}`;
  if (!options.verbose) return head;

  const lines = [
    head,
    `  scene:      ${t.sceneSlug ?? '(none)'}`,
    `  created:    ${t.createdAt}`,
    `  updated:    ${t.updatedAt}`,
    `  intents:    ${t.intentIds.length > 0 ? t.intentIds.join(', ') : '(none)'}`,
    `  annotations:${t.annotationIds.length > 0 ? ' ' + t.annotationIds.join(', ') : ' (none)'}`,
  ];
  if (t.resolvedAt) lines.push(`  closed:     ${t.resolvedAt} by ${t.resolvedBy?.kind ?? '?'}`);
  return lines.join('\n');
}

function ok(text: string) { return { content: [{ type: 'text' as const, text }] }; }
function err(text: string) { return { content: [{ type: 'text' as const, text: `Error: ${text}` }] }; }
