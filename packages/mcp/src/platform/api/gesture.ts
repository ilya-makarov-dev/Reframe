/**
 * Platform API — gesture capture endpoint.
 *
 * One route: `POST /platform/api/gesture` — the UI posts a Gesture (the
 * typed representation of a user action on the preview), the server
 * translates it via `translateGesture` in core, and creates/writes:
 *
 *   1. A thread (via ensureThread on the gesture's anchor)
 *   2. An annotation (if the translation produces an annotation payload)
 *   3. An intent (if the translation produces intent parts) — written in
 *      "queued" status so the agent can pick it up immediately
 *   4. Attaches the new annotation + intent to the thread
 *
 * This endpoint is the **single bridge** between the UI's captured
 * gestures and the domain model. Any surface that wants to become a
 * reframe client (VS Code plugin, CLI, future clients) calls this
 * endpoint (or the equivalent MCP tool) with the same Gesture shape.
 *
 * Returns: { ok, gesture, thread, annotation?, intent? } so the UI can
 * update its activity stream without re-fetching.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import {
  translateGesture,
  type Gesture,
} from '../../../../core/src/gestures/index.js';
import {
  ensureThread,
  attachAnnotation,
  attachIntent,
  transitionThread,
  getThread,
  type ThreadStatus,
} from '../../../../core/src/project/threads/index.js';
import {
  createAnnotation,
  listAnnotations,
  reAnchorAnnotation,
  transitionAnnotation,
  type AnnotationAuthor,
  type AnnotationStatus,
} from '../../../../core/src/project/annotations/index.js';
import { hydrateThread } from '../../../../core/src/project/hydrate.js';
import {
  createDraft,
  commitDraft,
  type Intent,
  type IntentAuthor,
} from '../../../../core/src/project/intents/index.js';

// ─── Helpers ────────────────────────────────────────────────

async function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, code: number, message: string): void {
  sendJson(res, code, { ok: false, error: message });
}

function toIntentAuthor(a: AnnotationAuthor): IntentAuthor {
  if (a.kind === 'human') return { kind: 'human', id: a.id };
  if (a.kind === 'agent') return { kind: 'agent', id: a.id };
  // system author → treat as human for intent lifecycle (audit is a separate flow)
  return { kind: 'human', id: a.id ?? 'system' };
}

// ─── Main entry ─────────────────────────────────────────────

/**
 * Handle `POST /platform/api/gesture`. Returns true when handled, false
 * when the router should fall through. The router already matched the
 * `/platform/api/` prefix; this function just handles the single
 * `/gesture` route.
 */
export async function handleGestureApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (!ctx.projectDir) {
    if (pathname === '/platform/api/gesture' ||
        pathname === '/platform/api/annotations/list' ||
        pathname === '/platform/api/annotations/re-anchor') {
      sendError(res, 400, 'No project open — run reframe_project init or open first.');
      return true;
    }
    return false;
  }
  const dir = ctx.projectDir;

  // POST /platform/api/threads/transition — lifecycle state change.
  // Wired to Resolve/Reopen/Archive buttons in the Platform thread panel.
  if (pathname === '/platform/api/threads/transition' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.threadId || !body.toStatus) {
      sendError(res, 400, 'threadId + toStatus required');
      return true;
    }
    const valid = ['active', 'resolved', 'orphaned', 'archived'];
    if (valid.indexOf(body.toStatus) < 0) {
      sendError(res, 400, 'invalid toStatus');
      return true;
    }
    const result = transitionThread(
      dir,
      body.threadId,
      body.toStatus as ThreadStatus,
      {
        resolvedBy: body.resolvedBy ?? { kind: 'human', id: 'platform-ui' },
        resolution: body.resolution,
      },
    );
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'transition failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  // POST /platform/api/threads/reply — Phase 2 Brief 2c.
  // Accepts a `body` string + threadId, persists a `comment` annotation
  // anchored to the thread's anchor + sceneSlug. Reuses the same
  // createAnnotation + attachAnnotation path the gesture handler uses
  // so the schema + thread linkage stay consistent. Broadcasts SSE so
  // any open thread panel re-renders. No intent emitted — pure visual
  // reply.
  if (pathname === '/platform/api/threads/reply' && req.method === 'POST') {
    const body = await readJson(req);
    const threadId = String(body.threadId || '').trim();
    const replyBody = typeof body.body === 'string' ? body.body : '';
    if (!threadId) {
      sendError(res, 400, 'threadId required');
      return true;
    }
    const trimmed = replyBody.trim();
    if (!trimmed) {
      sendError(res, 400, 'body required');
      return true;
    }
    if (replyBody.length > 4000) {
      sendError(res, 400, 'body too long (max 4000 chars)');
      return true;
    }
    const thread = getThread(dir, threadId);
    if (!thread) {
      sendError(res, 404, `thread ${threadId} not found`);
      return true;
    }
    const author = body.author && typeof body.author === 'object'
      ? body.author as AnnotationAuthor
      : { kind: 'human' as const, id: 'platform-ui' };
    const annotation = createAnnotation(dir, {
      anchor: thread.anchor,
      sceneSlug: thread.sceneSlug,
      threadId: thread.id,
      author,
      // CommentPayload uses `text` field. Accept `body` on the wire to
      // match user-facing terminology, store as `text` to match the
      // existing schema + render path.
      payload: { kind: 'comment', text: trimmed },
    });
    attachAnnotation(dir, thread.id, annotation.id);

    // Broadcast SSE so any open thread panel + canvas overlay re-renders.
    try {
      const { emitEvent } = await import('../../http-server.js');
      emitEvent({
        type: 'scene:session-changed',
        sceneId: thread.sceneSlug,
      } as any);
    } catch { /* best-effort */ }

    sendJson(res, 200, { ok: true, annotation });
    return true;
  }

  // GET /platform/api/threads/get?id=... — returns hydrated thread
  // (thread metadata + resolved intent records + resolved annotation
  // records). Used by the Platform UI thread detail panel.
  if (pathname === '/platform/api/threads/get' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    if (!id) {
      sendError(res, 400, 'id query param required');
      return true;
    }
    const hydrated = hydrateThread(dir, id);
    if (!hydrated) {
      sendError(res, 404, `thread ${id} not found`);
      return true;
    }
    sendJson(res, 200, { ok: true, ...hydrated });
    return true;
  }

  // GET /platform/api/annotations/list — used by the stream to surface
  // orphaned markers in a dedicated strip.
  if (pathname === '/platform/api/annotations/list' && req.method === 'GET') {
    const status = url.searchParams.get('status') as any;
    const sceneSlug = url.searchParams.get('sceneSlug') ?? undefined;
    const annotations = listAnnotations(dir, {
      status: status || undefined,
      sceneSlug,
      limit: 50,
    });
    sendJson(res, 200, { ok: true, annotations });
    return true;
  }

  // POST /platform/api/annotations/re-anchor — re-anchor an orphaned annotation.
  if (pathname === '/platform/api/annotations/re-anchor' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.annotationId || !body.newAnchor) {
      sendError(res, 400, 'annotationId + newAnchor required');
      return true;
    }
    const result = reAnchorAnnotation(dir, body.annotationId, body.newAnchor);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 're-anchor failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  // POST /platform/api/annotate-transition — lifecycle state change.
  // Used by: dismiss button on orphaned items, Accept on ghost-proposal
  // (→ dismissed after the linked intent is accepted), user manual
  // resolve/dismiss from the stream.
  if (pathname === '/platform/api/annotate-transition' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.annotationId || !body.toStatus) {
      sendError(res, 400, 'annotationId + toStatus required');
      return true;
    }
    const valid = ['active', 'orphaned', 'resolved', 'dismissed'];
    if (valid.indexOf(body.toStatus) < 0) {
      sendError(res, 400, 'invalid toStatus');
      return true;
    }
    const result = transitionAnnotation(
      dir,
      body.annotationId,
      body.toStatus as AnnotationStatus,
      { reason: body.reason },
    );
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'transition failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  if (pathname !== '/platform/api/gesture') return false;
  if (req.method !== 'POST') {
    sendError(res, 405, 'method not allowed');
    return true;
  }

  const body = await readJson(req);
  const gesture = body.gesture as Gesture | undefined;
  if (!gesture || typeof gesture !== 'object' || !gesture.kind) {
    sendError(res, 400, 'gesture object is required');
    return true;
  }

  // Default sceneSlug + timestamp if the UI did not fill them.
  if (!gesture.at) (gesture as any).at = new Date().toISOString();
  if (!gesture.author) (gesture as any).author = { kind: 'human', id: 'platform-ui' };

  try {
    const translated = translateGesture(gesture);
    if (!translated) {
      // Ambient gesture (hover/select) — nothing persistent to create.
      sendJson(res, 200, { ok: true, ambient: true });
      return true;
    }

    // 1. Thread — ensure one on the anchor (idempotent).
    const thread = ensureThread(
      dir,
      translated.anchor,
      translated.sceneSlug,
      translated.threadTitle,
    );

    // 2. Annotation (if any).
    let annotation: ReturnType<typeof createAnnotation> | null = null;
    if (translated.annotation) {
      annotation = createAnnotation(dir, {
        anchor: translated.anchor,
        sceneSlug: translated.sceneSlug,
        threadId: thread.id,
        author: translated.author,
        payload: translated.annotation,
      });
      attachAnnotation(dir, thread.id, annotation.id);
    }

    // 3. Intent (if any). Intent parts are wrapped into a draft that
    //    we immediately commit so the agent can pick it up right away.
    //    Rule gestures with enforced=true produce no intentParts, so
    //    the annotation IS the persistent state.
    let intent: Intent | null = null;
    if (translated.intentParts && translated.intentParts.length > 0) {
      const draft = createDraft(dir, translated.intentParts, {
        author: toIntentAuthor(translated.author),
        label: translated.threadTitle,
        sceneSlug: translated.sceneSlug,
      });
      // Attach anchor + thread metadata onto the intent via a follow-up
      // write (createDraft doesn't take these). We use the queue writer
      // directly via a re-hydrated intent; simpler to re-commit.
      // Since queueFilePath appends latest-wins, writing an updated
      // snapshot is safe.
      const withAnchor: Intent = {
        ...draft,
        anchor: translated.anchor,
        threadId: thread.id,
      };
      // Re-append the updated snapshot so readers see anchor + thread.
      const { writeIntent } = await import('../../../../core/src/project/intents/index.js');
      writeIntent(dir, withAnchor);

      // Commit → queued so the agent flow picks it up.
      commitDraft(dir, withAnchor.id);
      intent = withAnchor;
      attachIntent(dir, thread.id, intent.id);
    }

    sendJson(res, 200, {
      ok: true,
      gesture: { kind: gesture.kind },
      thread: { id: thread.id, anchor: thread.anchor, status: thread.status },
      annotation: annotation ? { id: annotation.id, kind: annotation.payload.kind } : null,
      intent: intent ? { id: intent.id, partsCount: intent.parts.length } : null,
    });
    return true;
  } catch (e: any) {
    sendError(res, 500, e?.message ?? String(e));
    return true;
  }
}
