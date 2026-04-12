/**
 * Phase 8 — Thread hydration helper.
 *
 * A "hydrated" thread is a thread where the intent ids + annotation ids
 * stored on the Thread record have been resolved into their full record
 * objects. This is what UI surfaces + agent context blocks need — a
 * single structure representing the entire conversation on an anchor,
 * ready to render or serialize.
 *
 * Lives at project/ root (not inside threads/) because it crosses
 * subsystem boundaries — threads don't know about intents or annotations
 * intrinsically, the hydrator is the join layer.
 */

import { getThread, type Thread } from './threads/index.js';
import { getIntent, type Intent } from './intents/index.js';
import {
  getAnnotation,
  listAnnotations,
  transitionAnnotation,
  type Annotation,
} from './annotations/index.js';

export interface HydratedThread {
  thread: Thread;
  intents: Intent[];
  annotations: Annotation[];
}

/**
 * Resolve a thread's intent + annotation id arrays into full records.
 * Order within each array preserves the order stored on the thread
 * (chronological — it's the order attached).
 *
 * Returns null when the thread id does not exist.
 * Missing intents / annotations (e.g. hard-deleted) are silently
 * skipped — hydration is a best-effort read.
 */
export function hydrateThread(
  projectDir: string,
  threadId: string,
): HydratedThread | null {
  const thread = getThread(projectDir, threadId);
  if (!thread) return null;

  const intents: Intent[] = [];
  for (const id of thread.intentIds) {
    const i = getIntent(projectDir, id);
    if (i) intents.push(i);
  }

  const annotations: Annotation[] = [];
  for (const id of thread.annotationIds) {
    const a = getAnnotation(projectDir, id);
    if (a) annotations.push(a);
  }

  return { thread, intents, annotations };
}

/**
 * When an intent is accepted, cascade the resolution to its thread's
 * annotations. The rule is:
 *
 *   - `rule` annotations → LEFT ACTIVE. Rules are standing orders that
 *     persist across proposals. Accepting one proposal does not retire
 *     a rule that the user wants enforced going forward.
 *   - `ghost-proposal` annotations for the accepted intent → DISMISSED.
 *     The proposal has been applied; its ghost is no longer relevant.
 *   - Every other annotation kind (comment, pin, echo-arrow, region,
 *     brush-stroke, reference, resonance-overlay) → RESOLVED. Their
 *     conversation reached a conclusion.
 *
 * Returns the set of annotation ids that were transitioned so callers
 * can report cascade outcomes.
 */
export function cascadeResolveOnAccept(
  projectDir: string,
  threadId: string,
  acceptedIntentId: string,
): { resolved: string[]; dismissed: string[] } {
  const resolved: string[] = [];
  const dismissed: string[] = [];
  const thread = getThread(projectDir, threadId);
  if (!thread) return { resolved, dismissed };

  for (const annId of thread.annotationIds) {
    const ann = getAnnotation(projectDir, annId);
    if (!ann || ann.status !== 'active') continue;

    const kind = ann.payload.kind;

    // Rules persist — they are standing orders, not one-shot messages.
    if (kind === 'rule') continue;

    // Ghost-proposals for THIS intent get dismissed (they're now applied).
    // Ghost-proposals for other intents stay — they're still pending.
    if (kind === 'ghost-proposal') {
      const p = ann.payload as any;
      if (p.intentId === acceptedIntentId) {
        const r = transitionAnnotation(projectDir, annId, 'dismissed', {
          reason: `intent ${acceptedIntentId} accepted`,
        });
        if (r.ok) dismissed.push(annId);
      }
      continue;
    }

    // Everything else → resolved.
    const r = transitionAnnotation(projectDir, annId, 'resolved', {
      reason: `intent ${acceptedIntentId} accepted`,
    });
    if (r.ok) resolved.push(annId);
  }

  return { resolved, dismissed };
}

/**
 * Given an anchor (INode id or scene/region tag), collect the FULL
 * agent-facing context:
 *   - Every active thread on that anchor
 *   - Every active annotation on that anchor (may be from threads not
 *     yet hydrated if we only walked the active thread)
 *
 * Used by the `reframe_intent process` enrichment — when an agent
 * picks up an intent, it gets the whole conversation it's joining
 * without needing to query multiple MCP tools.
 */
export function collectAnchorContext(
  projectDir: string,
  anchor: string,
  sceneSlug?: string,
): {
  threads: Thread[];
  annotations: Annotation[];
} {
  // Delay import to break a potential circular resolution path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const threadsMod = require('./threads/index.js');
  const threads = threadsMod
    .listThreads(projectDir, { anchor, sceneSlug, status: 'active' });
  const annotations = listAnnotations(projectDir, {
    anchor,
    sceneSlug,
    status: 'active',
  });
  return { threads, annotations };
}
