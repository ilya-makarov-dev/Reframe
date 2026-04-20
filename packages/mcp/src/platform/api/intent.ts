/**
 * Platform API — intent CRUD over HTTP.
 *
 * Routes under `/platform/api/intent/*`. Each handler reads the request JSON
 * body, calls the engine-level intents API, and returns a JSON response.
 * Client-side (platform/scripts.ts) uses `fetch` to reach these — same origin
 * as the sidecar, no CORS needed.
 *
 * Endpoint contract matches MCP reframe_intent actions 1:1 so adding a new
 * action in one place means only one handler change. Consider this a thin
 * HTTP skin over the same core logic the MCP tool exposes to agents.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import type { IntentPart } from '../../../../core/src/project/intents/index.js';
import {
  createDraft,
  addPartToDraft,
  removePartFromDraft,
  commitDraft,
  acceptProposal,
  rejectProposal,
  listIntents,
  getIntent,
  clearQueue,
  startProcessing,
} from '../../../../core/src/project/intents/index.js';
import { cascadeResolveOnAccept } from '../../../../core/src/project/hydrate.js';
import { transitionThread } from '../../../../core/src/project/threads/index.js';

// ─── Body reader ─────────────────────────────────────────────

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

// ─── Main entry ─────────────────────────────────────────────

export async function handleIntentApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  // Only handle intent routes. Historically this file guarded
  // `/platform/api/*` wholesale and 400'd with "No project open"
  // before later handlers (brand/apply, export, etc.) could run.
  // That made new endpoints look broken on a pristine workspace.
  // Scope the guard tightly so sibling handlers run on their own terms.
  if (!pathname.startsWith('/platform/api/intent')) return false;

  if (!ctx.projectDir) {
    sendError(res, 400, 'No project open — run reframe_project init or open first.');
    return true;
  }
  const dir = ctx.projectDir;

  // GET /platform/api/intent/list
  if (pathname === '/platform/api/intent/list' && req.method === 'GET') {
    const intents = listIntents(dir, { limit: 20 });
    sendJson(res, 200, { ok: true, intents });
    return true;
  }

  // GET /platform/api/intent/get?id=...
  if (pathname === '/platform/api/intent/get' && req.method === 'GET') {
    const id = url.searchParams.get('id') ?? '';
    if (!id) {
      sendError(res, 400, 'id query param required');
      return true;
    }
    const intent = getIntent(dir, id);
    if (!intent) {
      sendError(res, 404, `intent ${id} not found`);
      return true;
    }
    sendJson(res, 200, { ok: true, intent });
    return true;
  }

  // POST /platform/api/intent/add
  if (pathname === '/platform/api/intent/add' && req.method === 'POST') {
    const body = await readJson(req);
    const parts: IntentPart[] = Array.isArray(body.parts) ? body.parts : [];
    const intent = createDraft(dir, parts, {
      author: body.author ?? { kind: 'human', id: 'platform-ui' },
      label: body.label,
      sceneSlug: body.sceneSlug,
    });
    sendJson(res, 200, { ok: true, intent });
    return true;
  }

  // POST /platform/api/intent/add-part
  if (pathname === '/platform/api/intent/add-part' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.intentId || !body.part) {
      sendError(res, 400, 'intentId + part required');
      return true;
    }
    const result = addPartToDraft(dir, body.intentId, body.part);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'add-part failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  // POST /platform/api/intent/remove-part
  if (pathname === '/platform/api/intent/remove-part' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.intentId || typeof body.partIndex !== 'number') {
      sendError(res, 400, 'intentId + partIndex required');
      return true;
    }
    const result = removePartFromDraft(dir, body.intentId, body.partIndex);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'remove-part failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  // POST /platform/api/intent/commit
  if (pathname === '/platform/api/intent/commit' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.intentId) {
      sendError(res, 400, 'intentId required');
      return true;
    }
    const result = commitDraft(dir, body.intentId);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'commit failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  // POST /platform/api/intent/accept
  if (pathname === '/platform/api/intent/accept' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.intentId) {
      sendError(res, 400, 'intentId required');
      return true;
    }
    const result = acceptProposal(dir, body.intentId, body.opIds);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'accept failed');
      return true;
    }

    // Phase 8 cascade: resolve the thread + its non-rule non-ghost
    // annotations. Best-effort — a broken cascade must not fail the
    // accept response.
    let cascadeInfo: { resolved: number; dismissed: number; threadResolved: boolean } = {
      resolved: 0, dismissed: 0, threadResolved: false,
    };
    try {
      const intent = getIntent(dir, body.intentId);
      if (intent?.threadId) {
        const cascade = cascadeResolveOnAccept(dir, intent.threadId, intent.id);
        cascadeInfo.resolved = cascade.resolved.length;
        cascadeInfo.dismissed = cascade.dismissed.length;
        const tr = transitionThread(dir, intent.threadId, 'resolved', {
          resolvedBy: { kind: 'system' },
          resolution: `intent ${intent.id} accepted`,
        });
        cascadeInfo.threadResolved = tr.ok;
      }
    } catch { /* best-effort */ }

    sendJson(res, 200, { ...result, ok: true, cascade: cascadeInfo });
    return true;
  }

  // POST /platform/api/intent/reject
  if (pathname === '/platform/api/intent/reject' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.intentId) {
      sendError(res, 400, 'intentId required');
      return true;
    }
    const result = rejectProposal(dir, body.intentId, body.reason);
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'reject failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  // POST /platform/api/intent/mark-processing
  if (pathname === '/platform/api/intent/mark-processing' && req.method === 'POST') {
    const body = await readJson(req);
    if (!body.intentId) {
      sendError(res, 400, 'intentId required');
      return true;
    }
    const result = startProcessing(dir, body.intentId, body.processorId ?? 'platform-ui');
    if (!result.ok) {
      sendError(res, 400, result.error ?? 'mark-processing failed');
      return true;
    }
    sendJson(res, 200, { ...result, ok: true });
    return true;
  }

  // POST /platform/api/intent/clear
  if (pathname === '/platform/api/intent/clear' && req.method === 'POST') {
    const count = clearQueue(dir);
    sendJson(res, 200, { ok: true, cleared: count });
    return true;
  }

  // Unknown API route
  sendError(res, 404, `unknown api route ${pathname}`);
  return true;
}
