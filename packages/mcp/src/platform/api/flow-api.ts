/**
 * Platform API — flow spec + state endpoints.
 *
 * Routes:
 *   GET  /platform/api/flow/:flowId              → flow.json spec
 *   GET  /platform/api/flow/:flowId/state        → state.json current state
 *   POST /platform/api/flow/:flowId/state        → merge body into state.json
 *   POST /platform/api/flow/:flowId/transition   → body {to:number} → transition, persist
 *
 * Flow-state mutations are orthogonal to per-scene Ctrl+Z history —
 * Ctrl+Z undoes scene edits (via the existing /undo endpoint keyed by
 * scene slug), flow-state reflects application data accumulated across
 * step visits. Mixing the two would blur the boundary between scene
 * authoring and flow authoring.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import {
  readFlowSpec,
  readFlowState,
  writeFlowState,
  transitionTo,
} from '../../../../core/src/project/flow-store.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function parseFlowPath(pathname: string): { flowId: string; sub: string | null } | null {
  // /platform/api/flow/:flowId(/sub)?
  const m = pathname.match(/^\/platform\/api\/flow\/([^\/]+)(?:\/([^\/]+))?\/?$/);
  if (!m) return null;
  return { flowId: decodeURIComponent(m[1]), sub: m[2] ?? null };
}

export async function handleFlowApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parsed = parseFlowPath(url.pathname);
  if (!parsed) return false;
  const { flowId, sub } = parsed;

  const projectDir = ctx.projectDir;
  if (!projectDir) {
    sendJson(res, 400, { ok: false, error: 'no project open' });
    return true;
  }

  if (req.method === 'GET' && sub === null) {
    const spec = readFlowSpec(projectDir, flowId);
    if (!spec) {
      sendJson(res, 404, { ok: false, error: 'flow not found', flowId });
      return true;
    }
    sendJson(res, 200, { ok: true, spec });
    return true;
  }

  if (req.method === 'GET' && sub === 'state') {
    const state = readFlowState(projectDir, flowId);
    sendJson(res, 200, { ok: true, state });
    return true;
  }

  if (req.method === 'POST' && sub === 'state') {
    let body: any;
    try { body = await readJsonBody(req); }
    catch (err: any) {
      sendJson(res, 400, { ok: false, error: `body parse failed: ${err?.message ?? err}` });
      return true;
    }
    // Merge-patch semantics on state.data. `currentStep` / `visitedSteps`
    // are owned by the transition endpoint; ignore them here to keep
    // concerns separate (flow-author writes values, nav writes position).
    const current = readFlowState(projectDir, flowId);
    const mergedData = { ...current.data, ...(body?.data ?? {}) };
    const next = { ...current, data: mergedData };
    writeFlowState(projectDir, next);
    sendJson(res, 200, { ok: true, state: next });
    return true;
  }

  if (req.method === 'POST' && sub === 'transition') {
    let body: any;
    try { body = await readJsonBody(req); }
    catch (err: any) {
      sendJson(res, 400, { ok: false, error: `body parse failed: ${err?.message ?? err}` });
      return true;
    }
    const to = typeof body?.to === 'number' ? body.to : null;
    if (to === null) {
      sendJson(res, 400, { ok: false, error: 'missing body.to (number)' });
      return true;
    }
    const spec = readFlowSpec(projectDir, flowId);
    if (!spec) {
      sendJson(res, 404, { ok: false, error: 'flow not found', flowId });
      return true;
    }
    if (to < 0 || to >= spec.stepSceneIds.length) {
      sendJson(res, 400, { ok: false, error: 'target step out of range', to, stepCount: spec.stepSceneIds.length });
      return true;
    }
    const next = transitionTo(projectDir, flowId, to);
    sendJson(res, 200, { ok: true, state: next });
    return true;
  }

  sendJson(res, 405, { ok: false, error: `method ${req.method} not supported for flow ${flowId}/${sub ?? 'spec'}` });
  return true;
}
