/**
 * reframe_collab — EXPERIMENTAL / TESTABLE.
 *
 * Minimal stub for the async agent worker pattern. Platform UI gesture
 * system (Ask / Pin / Echo / Lasso / Brush / Rule / Resonance / Drag)
 * writes user interactions as Intents to `.reframe/intents/queue.jsonl`.
 * This tool is the one place an agent can pull that queue and respond.
 *
 * Three actions — cheapest surface that lets the async flow actually work:
 *
 *   list     — peek at queued intents (read-only, no status change)
 *   process  — pop up to batchSize queued intents and transition them
 *              to 'processing'. Returns the intent payloads. The agent
 *              is expected to generate ops via reframe_edit for each.
 *   respond  — after generating ops, mark an intent as 'proposed' with
 *              a short summary + optional op ids. Platform UI then
 *              surfaces the proposal for human accept/reject.
 *
 * What this tool DOESN'T do (deliberately):
 *
 *   - No annotate/thread CRUD. Those are UI-side data structures; the
 *     agent reads them implicitly through intent.parts (which contain
 *     refs to annotations) rather than poking at the storage directly.
 *   - No intent authoring (add/commit/refine). Intents come from the
 *     Platform UI gesture system, not from the agent creating them.
 *   - No template management. Out of scope for the minimal stub.
 *
 * If async flow turns out to be a core use case, expand from here. If
 * it stays dormant, delete this file and one line from register-tools.
 * Either direction is ~5 minutes of work.
 */

import { z } from 'zod';
import { getWorkspaceRoot } from '../store.js';
import {
  listIntents,
  fetchNextBatch,
  proposeOps,
  countByStatus,
} from '../../../core/src/project/intents/index.js';

// ─── Schema ──────────────────────────────────────────────────

export const collabInputSchema = {
  action: z.enum(['list', 'process', 'respond', 'start_session', 'sync_status']).describe(
    'list = peek queued intents. ' +
    'process = batch-pop queued intents. ' +
    'respond = mark intent as proposed. ' +
    'start_session = start a CRDT collaboration session for a scene (requires sceneId param). ' +
    'sync_status = show active collaboration sessions.',
  ),
  batchSize: z.number().int().positive().max(20).optional().default(5).describe(
    'Used by `process` only — max intents to pop in one call. Default 5, max 20.',
  ),
  intentId: z.string().optional().describe(
    'Required by `respond` — the intent being responded to.',
  ),
  summary: z.string().optional().describe(
    'Used by `respond` — short text describing what the agent did (shown in the proposal).',
  ),
  opIds: z.array(z.string()).optional().describe(
    'Used by `respond` — op IDs the agent generated in response to this intent.',
  ),
  sceneId: z.string().optional().describe(
    'Scene ID for start_session — creates a CRDT collaboration session for this scene.',
  ),
};

interface CollabInput {
  action: 'list' | 'process' | 'respond' | 'start_session' | 'sync_status';
  batchSize?: number;
  intentId?: string;
  summary?: string;
  opIds?: string[];
  sceneId?: string;
}

// ─── Handler ─────────────────────────────────────────────────

export async function handleCollab(input: CollabInput) {
  const projectDir = getWorkspaceRoot();
  if (!projectDir) {
    return text('reframe_collab: no project open (init one via reframe_project init first)');
  }

  switch (input.action) {
    case 'list': {
      try {
        const all = listIntents(projectDir, { limit: 50 });
        const queued = all.filter(i => i.status === 'queued');
        const counts = countByStatus(projectDir);
        const lines: string[] = [
          `Intent queue: ${queued.length} queued, ${counts.processing ?? 0} processing, ${counts.proposed ?? 0} proposed`,
          '',
        ];
        if (queued.length === 0) {
          lines.push('  (no queued intents — Platform UI gestures will appear here)');
        } else {
          for (const intent of queued.slice(0, 10)) {
            const partCount = intent.parts?.length ?? 0;
            const sceneRef = intent.sceneSlug ?? 'project-scope';
            const summary = summarizeParts(intent.parts);
            lines.push(`  ${intent.id} [${sceneRef}] ${partCount} part${partCount === 1 ? '' : 's'} — ${summary}`);
          }
          if (queued.length > 10) {
            lines.push(`  ... and ${queued.length - 10} more`);
          }
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return text(`reframe_collab list ERROR: ${e?.message ?? e}`);
      }
    }

    case 'process': {
      try {
        const batchSize = input.batchSize ?? 5;
        const batch = fetchNextBatch(projectDir, 'mcp-agent', batchSize);
        if (batch.length === 0) {
          return text('reframe_collab process: queue empty');
        }
        const lines: string[] = [
          `Picked up ${batch.length} intent${batch.length === 1 ? '' : 's'} from the queue (now in 'processing' state):`,
          '',
        ];
        for (const intent of batch) {
          lines.push(`─── ${intent.id} ───`);
          if (intent.sceneSlug) lines.push(`  scene: ${intent.sceneSlug}`);
          if (intent.parts && intent.parts.length > 0) {
            for (const part of intent.parts) {
              lines.push(`  · ${describePart(part)}`);
            }
          }
          lines.push('');
        }
        lines.push('Next: generate ops via reframe_edit, then call reframe_collab { action: "respond", intentId, summary, opIds } for each.');
        return text(lines.join('\n'));
      } catch (e: any) {
        return text(`reframe_collab process ERROR: ${e?.message ?? e}`);
      }
    }

    case 'respond': {
      if (!input.intentId) {
        return text('reframe_collab respond ERROR: intentId required');
      }
      try {
        const result = proposeOps(projectDir, input.intentId, input.opIds ?? []);
        if (!result.ok) {
          return text(`reframe_collab respond ERROR: ${result.error}`);
        }
        const summaryLine = input.summary ? `\n  summary: ${input.summary}` : '';
        return text(`Intent ${input.intentId} → proposed. Platform UI will surface this for human accept/reject.${summaryLine}`);
      } catch (e: any) {
        return text(`reframe_collab respond ERROR: ${e?.message ?? e}`);
      }
    }

    case 'start_session': {
      if (!input.sceneId) {
        return text('reframe_collab start_session: sceneId required');
      }
      try {
        const { createSession, findSessionForScene } = await import('../../../core/src/collab/sync.js');
        const existing = findSessionForScene(input.sceneId);
        if (existing) {
          return text(`Collaboration session already active for scene ${input.sceneId}: ${existing.id} (${existing.peers.size} peers)`);
        }
        const session = createSession(input.sceneId);
        return text(`Collaboration session started: ${session.id} for scene ${input.sceneId}. Peers can join via WebSocket or SSE.`);
      } catch (e: any) {
        return text(`start_session ERROR: ${e?.message ?? e}`);
      }
    }

    case 'sync_status': {
      try {
        const { listSessions } = await import('../../../core/src/collab/sync.js');
        const sessions = listSessions();
        if (sessions.length === 0) {
          return text('No active collaboration sessions. Use start_session with a sceneId to begin.');
        }
        const lines = ['Active collaboration sessions:', ''];
        for (const s of sessions) {
          lines.push(`  ${s.id} → scene:${s.sceneId} (${s.peers} peers, ${s.ops} ops)`);
        }
        return text(lines.join('\n'));
      } catch (e: any) {
        return text(`sync_status ERROR: ${e?.message ?? e}`);
      }
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function summarizeParts(parts: any[] | undefined): string {
  if (!parts || parts.length === 0) return '(empty)';
  const firstText = parts.find(p => p?.kind === 'text' && typeof p.value === 'string');
  if (firstText) {
    const v = String(firstText.value).trim();
    return v.length > 80 ? v.slice(0, 77) + '...' : v;
  }
  const kinds = parts.map(p => p?.kind).filter(Boolean);
  return `[${kinds.join(', ')}]`;
}

function describePart(part: any): string {
  if (!part || typeof part !== 'object') return '(unknown)';
  const kind = part.kind ?? '?';
  switch (kind) {
    case 'text':     return `text: "${String(part.value ?? '').slice(0, 120)}"`;
    case 'scope':    return `scope: ${part.value ?? '?'}`;
    case 'select':   return `select: ${part.anchors?.join(', ') ?? '?'}`;
    case 'role':     return `role: ${part.role ?? '?'}`;
    case 'color':    return `color: ${part.value ?? '?'}`;
    case 'spacing':  return `spacing: ${part.value ?? '?'}`;
    case 'apply-macro':  return `apply-macro: ${part.macro ?? '?'}`;
    case 'apply-variant':return `apply-variant: ${part.variant ?? '?'}`;
    case 'fix-audit':    return `fix-audit: ${part.rule ?? 'any'}`;
    default:         return `${kind}: ${JSON.stringify(part).slice(0, 100)}`;
  }
}
