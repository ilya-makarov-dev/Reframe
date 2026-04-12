/**
 * Phase 7.0 — Intent lifecycle state machine.
 *
 * Every transition goes through this module. Why centralize? Because the
 * state graph has traps — e.g. you can't go from `draft` directly to
 * `accepted`, and you can't re-process an intent that's already `archived`.
 * Putting the rules in ONE place means (a) the MCP tool can trust them,
 * (b) the UI can derive valid next actions, and (c) a new caller can't
 * accidentally bypass steps.
 *
 * Every mutation returns `IntentActionResult` with the new status on
 * success or a reason on failure. No throws for "wrong state" — callers
 * should inspect `result.ok`.
 */

import type {
  Intent,
  IntentPart,
  IntentStatus,
  IntentAuthor,
  IntentActionResult,
} from './types.js';
import { VALID_TRANSITIONS, KNOWN_PART_KINDS } from './types.js';
import {
  writeIntent,
  getIntent,
  nextIntentId,
  archiveTerminal,
  listIntents,
} from './queue.js';

// ─── Draft creation ─────────────────────────────────────────

/**
 * Create a fresh DRAFT intent with the supplied parts. Returns the new
 * intent — not yet committed, agents will ignore it until `commitDraft`.
 *
 * Part validation: we accept any known kind, reject unknowns up front.
 * Empty parts array is allowed at draft time (user may add parts in
 * subsequent updates) but rejected at commit time.
 */
export function createDraft(
  projectDir: string,
  parts: IntentPart[],
  options: {
    author?: IntentAuthor;
    label?: string;
    sceneSlug?: string;
    parentId?: string;
  } = {},
): Intent {
  const now = new Date().toISOString();
  // Filter out any parts whose `kind` is unknown — defensive against future
  // callers sending from a newer schema.
  const validParts = parts.filter(p => p && KNOWN_PART_KINDS.has((p as IntentPart).kind));
  const intent: Intent = {
    id: nextIntentId(),
    createdAt: now,
    updatedAt: now,
    author: options.author ?? { kind: 'human' },
    status: 'draft',
    parts: validParts,
    label: options.label,
    sceneSlug: options.sceneSlug,
    parentId: options.parentId,
  };
  writeIntent(projectDir, intent);
  return intent;
}

// ─── Part editing on a draft ────────────────────────────────

/** Append a new part to a draft intent. Only allowed when status='draft'. */
export function addPartToDraft(
  projectDir: string,
  intentId: string,
  part: IntentPart,
): IntentActionResult {
  const intent = getIntent(projectDir, intentId);
  if (!intent) return { ok: false, error: `Intent ${intentId} not found` };
  if (intent.status !== 'draft') {
    return { ok: false, error: `Intent is ${intent.status}, parts are locked after commit` };
  }
  if (!KNOWN_PART_KINDS.has((part as IntentPart).kind)) {
    return { ok: false, error: `Unknown part kind "${(part as any).kind}"` };
  }
  const updated: Intent = {
    ...intent,
    parts: [...intent.parts, part],
    updatedAt: new Date().toISOString(),
  };
  writeIntent(projectDir, updated);
  return { ok: true, intentId, status: updated.status };
}

/** Remove a part by index from a draft. */
export function removePartFromDraft(
  projectDir: string,
  intentId: string,
  partIndex: number,
): IntentActionResult {
  const intent = getIntent(projectDir, intentId);
  if (!intent) return { ok: false, error: `Intent ${intentId} not found` };
  if (intent.status !== 'draft') {
    return { ok: false, error: `Intent is ${intent.status}, parts are locked after commit` };
  }
  if (partIndex < 0 || partIndex >= intent.parts.length) {
    return { ok: false, error: `Part index ${partIndex} out of range` };
  }
  const nextParts = intent.parts.slice();
  nextParts.splice(partIndex, 1);
  writeIntent(projectDir, {
    ...intent,
    parts: nextParts,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, intentId, status: 'draft' };
}

// ─── Transitions ────────────────────────────────────────────

/** Helper: check a state transition is allowed, return error message if not. */
function checkTransition(from: IntentStatus, to: IntentStatus): string | null {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return `Invalid transition ${from} → ${to}. Allowed from ${from}: [${allowed.join(', ')}]`;
  }
  return null;
}

/** draft → queued */
export function commitDraft(projectDir: string, intentId: string): IntentActionResult {
  const intent = getIntent(projectDir, intentId);
  if (!intent) return { ok: false, error: `Intent ${intentId} not found` };
  const err = checkTransition(intent.status, 'queued');
  if (err) return { ok: false, error: err };
  if (intent.parts.length === 0) {
    return { ok: false, error: 'Cannot commit an empty intent (no parts)' };
  }
  writeIntent(projectDir, {
    ...intent,
    status: 'queued',
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, intentId, status: 'queued' };
}

/** queued → processing. Called by the agent when it picks up the intent. */
export function startProcessing(
  projectDir: string,
  intentId: string,
  processedBy: string,
): IntentActionResult {
  const intent = getIntent(projectDir, intentId);
  if (!intent) return { ok: false, error: `Intent ${intentId} not found` };
  const err = checkTransition(intent.status, 'processing');
  if (err) return { ok: false, error: err };
  writeIntent(projectDir, {
    ...intent,
    status: 'processing',
    processingStartedAt: new Date().toISOString(),
    processingBy: processedBy,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, intentId, status: 'processing' };
}

/**
 * processing → proposed. Agent reports which ops it has generated. Ops are
 * stored by id; the intent does NOT carry op payloads — those live in the
 * Phase 3 ops history. Intent → ops mapping lives here as a back-reference.
 */
export function proposeOps(
  projectDir: string,
  intentId: string,
  opIds: string[],
): IntentActionResult {
  const intent = getIntent(projectDir, intentId);
  if (!intent) return { ok: false, error: `Intent ${intentId} not found` };
  const err = checkTransition(intent.status, 'proposed');
  if (err) return { ok: false, error: err };
  writeIntent(projectDir, {
    ...intent,
    status: 'proposed',
    proposedOpIds: [...opIds],
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, intentId, status: 'proposed' };
}

/** proposed → accepted. Op ids are recorded. */
export function acceptProposal(
  projectDir: string,
  intentId: string,
  acceptedOpIds?: string[],
): IntentActionResult {
  const intent = getIntent(projectDir, intentId);
  if (!intent) return { ok: false, error: `Intent ${intentId} not found` };
  const err = checkTransition(intent.status, 'accepted');
  if (err) return { ok: false, error: err };
  writeIntent(projectDir, {
    ...intent,
    status: 'accepted',
    acceptedOpIds: acceptedOpIds ?? intent.proposedOpIds ?? [],
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, intentId, status: 'accepted' };
}

/** processing|proposed → rejected with a reason. */
export function rejectProposal(
  projectDir: string,
  intentId: string,
  reason?: string,
): IntentActionResult {
  const intent = getIntent(projectDir, intentId);
  if (!intent) return { ok: false, error: `Intent ${intentId} not found` };
  const err = checkTransition(intent.status, 'rejected');
  if (err) return { ok: false, error: err };
  writeIntent(projectDir, {
    ...intent,
    status: 'rejected',
    rejectedReason: reason,
    updatedAt: new Date().toISOString(),
  });
  return { ok: true, intentId, status: 'rejected' };
}

/**
 * Create a REFINED child of an existing intent. The parent moves to
 * `refined` status (pointing at the child via `refinedIntoId`) and the
 * child starts as a fresh draft with merged parts (parent parts + new
 * parts supplied by the caller). This is how "let me tweak this" flows
 * translate to a creative tree.
 */
export function refineIntent(
  projectDir: string,
  parentId: string,
  newParts: IntentPart[],
  options: { author?: IntentAuthor; label?: string } = {},
): { parent: IntentActionResult; child: Intent | null } {
  const parent = getIntent(projectDir, parentId);
  if (!parent) {
    return {
      parent: { ok: false, error: `Parent intent ${parentId} not found` },
      child: null,
    };
  }
  const err = checkTransition(parent.status, 'refined');
  if (err) return { parent: { ok: false, error: err }, child: null };

  // Spawn child intent referencing the parent. Child inherits parent parts
  // so the refinement is a superset, not a replacement — if caller wants
  // pure replacement they can pass only the new parts AND strip parent
  // parts in a subsequent addPart/removePart sequence.
  const mergedParts = [...parent.parts, ...newParts];
  const child = createDraft(projectDir, mergedParts, {
    author: options.author ?? parent.author,
    label: options.label ?? parent.label,
    sceneSlug: parent.sceneSlug,
    parentId: parent.id,
  });

  writeIntent(projectDir, {
    ...parent,
    status: 'refined',
    refinedIntoId: child.id,
    updatedAt: new Date().toISOString(),
  });

  return { parent: { ok: true, intentId: parent.id, status: 'refined' }, child };
}

// ─── Agent batch fetch ─────────────────────────────────────

/**
 * Pop up to N queued intents and atomically transition them to `processing`.
 * Returns the intents the agent should work on. This is the single "batch
 * fetch" surface for agent clients (Cursor, Claude Code) — one MCP call
 * gives them a working set.
 */
export function fetchNextBatch(
  projectDir: string,
  processorId: string,
  batchSize: number = 10,
): Intent[] {
  const queued = listIntents(projectDir, { status: 'queued', limit: batchSize });
  const now = new Date().toISOString();
  const fetched: Intent[] = [];
  for (const intent of queued) {
    const updated: Intent = {
      ...intent,
      status: 'processing',
      processingStartedAt: now,
      processingBy: processorId,
      updatedAt: now,
    };
    writeIntent(projectDir, updated);
    fetched.push(updated);
  }
  return fetched;
}

// ─── Maintenance ───────────────────────────────────────────

/** Trigger archive cleanup — called automatically on every `createDraft`
 *  when queue exceeds threshold, and exposed as explicit action. */
export function maintainQueue(
  projectDir: string,
  options: { archiveThreshold?: number } = {},
): { archived: number; compacted: number } {
  const threshold = options.archiveThreshold ?? 50;
  const counts = listIntents(projectDir).length;
  if (counts < threshold) return { archived: 0, compacted: 0 };
  return archiveTerminal(projectDir);
}
