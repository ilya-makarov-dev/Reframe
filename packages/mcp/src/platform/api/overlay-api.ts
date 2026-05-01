/**
 * Platform API — overlay spec endpoints (T2 #5).
 *
 * Routes:
 *   GET /platform/api/overlay/:overlayId       → overlay.json spec
 *   GET /platform/api/overlay/:overlayId/base  → base scene envelope
 *
 * Overlay is read-mostly from the API perspective. Per-base-scene editing
 * happens via the existing scene endpoints (the base IS a regular scene
 * referenced by slug); the OverlayRenderer drives focus through the
 * standard composition-focus event path. There's intentionally no
 * overlay-state endpoint analogous to flow-state — overlay carries no
 * runtime state outside layer animation, which lives entirely in the
 * client renderer's RAF loop.
 *
 * Layers themselves are NOT addressable as separate resources (no
 * /layer/:layerId GET) in Phase 0 — they're purely decorative siblings
 * of the base scene. When per-layer config editing lands as a future
 * feature, a PATCH /platform/api/overlay/:id route writing back to
 * overlay.json's layers[] is the cleanest extension surface.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import {
  readOverlaySpec,
  writeOverlaySpec,
  loadBaseScene,
  type OverlaySpec,
} from '../../../../core/src/project/overlay-store.js';
import { serializeGraph } from '../../../../core/src/serialize.js';
import { ALL_LAYERS_BROWSER_SOURCE } from '../../../../core/src/engine/overlay-layers/index.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function parseOverlayPath(pathname: string): { overlayId: string; sub: string | null } | null {
  const m = pathname.match(/^\/platform\/api\/overlay\/([^\/]+)(?:\/([^\/]+))?\/?$/);
  if (!m) return null;
  return { overlayId: decodeURIComponent(m[1]), sub: m[2] ?? null };
}

export async function handleOverlayApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  // POST /platform/api/overlay — create/update spec (Phase 4 Brief 4c
  // Pin #3 wizard write target). Body carries overlayId + baseSceneId
  // + layers[]. Engine cap: max 3 layers per overlay.
  if (url.pathname === '/platform/api/overlay' && req.method === 'POST') {
    if (!ctx.projectDir) {
      sendJson(res, 400, { ok: false, error: 'no project open' });
      return true;
    }
    const body = await readJsonBody(req);
    const overlayId = String(body.overlayId || '').trim();
    if (!/^[a-z][a-z0-9-]*$/.test(overlayId)) {
      sendJson(res, 400, { ok: false, error: 'invalid overlayId — lowercase + dash, must start with letter' });
      return true;
    }
    const baseSceneId = String(body.baseSceneId || '').trim();
    if (!baseSceneId) {
      sendJson(res, 400, { ok: false, error: 'baseSceneId required' });
      return true;
    }
    const layers = Array.isArray(body.layers) ? body.layers : [];
    if (layers.length === 0) {
      sendJson(res, 400, { ok: false, error: 'layers[] requires ≥1 entry' });
      return true;
    }
    if (layers.length > 3) {
      sendJson(res, 400, { ok: false, error: 'engine cap: max 3 layers per overlay' });
      return true;
    }
    const now = new Date().toISOString();
    const existing = readOverlaySpec(ctx.projectDir, overlayId);
    const spec: OverlaySpec = {
      overlayId,
      name: body.name ? String(body.name) : (existing?.name ?? overlayId),
      baseSceneId,
      layers,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      writeOverlaySpec(ctx.projectDir, spec);
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'composition:created:overlay', overlayId } as any);
      } catch { /* best-effort */ }
      sendJson(res, 200, { ok: true, spec });
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: e?.message ?? 'write failed' });
    }
    return true;
  }

  const parsed = parseOverlayPath(url.pathname);
  if (!parsed) return false;
  const { overlayId, sub } = parsed;

  const projectDir = ctx.projectDir;
  if (!projectDir) {
    sendJson(res, 400, { ok: false, error: 'no project open' });
    return true;
  }

  if (req.method === 'GET' && sub === null) {
    const spec = readOverlaySpec(projectDir, overlayId);
    if (!spec) {
      sendJson(res, 404, { ok: false, error: 'overlay not found', overlayId });
      return true;
    }
    sendJson(res, 200, { ok: true, spec, layerRuntimeSource: ALL_LAYERS_BROWSER_SOURCE });
    return true;
  }

  if (req.method === 'GET' && sub === 'base') {
    const spec = readOverlaySpec(projectDir, overlayId);
    if (!spec) {
      sendJson(res, 404, { ok: false, error: 'overlay not found', overlayId });
      return true;
    }
    const loaded = loadBaseScene(projectDir, spec);
    if (!loaded) {
      sendJson(res, 404, {
        ok: false,
        error: 'base scene not found on disk',
        overlayId,
        baseSceneId: spec.baseSceneId,
      });
      return true;
    }
    try {
      const envelope = serializeGraph(loaded.graph, loaded.rootId);
      sendJson(res, 200, { ok: true, overlayId, baseSceneId: spec.baseSceneId, envelope });
    } catch (err) {
      console.warn(`[overlay-api] failed to serialize base scene ${spec.baseSceneId}:`, err);
      sendJson(res, 500, { ok: false, error: 'failed to serialize base scene', overlayId });
    }
    return true;
  }

  sendJson(res, 405, {
    ok: false,
    error: `method ${req.method} not supported for overlay ${overlayId}/${sub ?? 'spec'}`,
  });
  return true;
}
