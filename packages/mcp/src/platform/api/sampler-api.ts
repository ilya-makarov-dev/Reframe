/**
 * Platform API — sampler spec endpoints (Week 3 #25).
 *
 * Routes:
 *   GET  /platform/api/sampler/:samplerId          → sampler.json spec
 *   GET  /platform/api/sampler/:samplerId/cells    → cell scene envelopes (lazy fetch)
 *
 * Sampler is read-mostly from the API perspective. Per-cell editing
 * happens via the existing scene endpoints (each cell IS a regular scene
 * referenced by slug); the SamplerRenderer drives focus through the
 * standard composition-focus event path. There's intentionally no
 * sampler-state endpoint analogous to flow-state — sampler has no
 * cross-cell session data, just a static grid view.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import {
  readSamplerSpec,
  writeSamplerSpec,
  loadCellScenes,
  type SamplerSpec,
} from '../../../../core/src/project/sampler-store.js';
import { serializeGraph } from '../../../../core/src/serialize.js';
import { exportSceneGraphToSvg } from '../../../../core/src/exporters/svg.js';

function readBody(req: IncomingMessage): Promise<any> {
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function parseSamplerPath(pathname: string): { samplerId: string; sub: string | null } | null {
  // /platform/api/sampler/:samplerId(/sub)?
  const m = pathname.match(/^\/platform\/api\/sampler\/([^\/]+)(?:\/([^\/]+))?\/?$/);
  if (!m) return null;
  return { samplerId: decodeURIComponent(m[1]), sub: m[2] ?? null };
}

export async function handleSamplerApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parsed = parseSamplerPath(url.pathname);
  if (!parsed) return false;
  const { samplerId, sub } = parsed;

  const projectDir = ctx.projectDir;
  if (!projectDir) {
    sendJson(res, 400, { ok: false, error: 'no project open' });
    return true;
  }

  if (req.method === 'GET' && sub === null) {
    const spec = readSamplerSpec(projectDir, samplerId);
    if (!spec) {
      sendJson(res, 404, { ok: false, error: 'sampler not found', samplerId });
      return true;
    }
    sendJson(res, 200, { ok: true, spec });
    return true;
  }

  // POST /platform/api/sampler/:samplerId — create/update spec
  // (Phase 4 Brief 4b Pin #4: sampler wizard write target).
  if (req.method === 'POST' && sub === null) {
    const body = await readBody(req);
    if (!/^[a-z][a-z0-9\-]*$/.test(samplerId)) {
      sendJson(res, 400, { ok: false, error: 'invalid samplerId — lowercase + dash only, must start with letter' });
      return true;
    }
    const cellSceneIds = Array.isArray(body.cellSceneIds) ? body.cellSceneIds.map(String) : [];
    if (cellSceneIds.length === 0) {
      sendJson(res, 400, { ok: false, error: 'cellSceneIds required (non-empty)' });
      return true;
    }
    const grid = body.grid && typeof body.grid === 'object' ? body.grid : { columns: cellSceneIds.length };
    const now = new Date().toISOString();
    const existing = readSamplerSpec(projectDir, samplerId);
    const spec: SamplerSpec = {
      samplerId,
      name: body.name ? String(body.name) : existing?.name,
      sharedBrand: body.sharedBrand ? String(body.sharedBrand) : existing?.sharedBrand,
      cellSceneIds,
      grid,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      writeSamplerSpec(projectDir, spec);
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'composition:created:sampler', samplerId } as any);
      } catch { /* best-effort */ }
      sendJson(res, 200, { ok: true, spec });
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: e?.message ?? 'write failed' });
    }
    return true;
  }

  if (req.method === 'GET' && sub === 'cells') {
    const spec = readSamplerSpec(projectDir, samplerId);
    if (!spec) {
      sendJson(res, 404, { ok: false, error: 'sampler not found', samplerId });
      return true;
    }
    const loaded = loadCellScenes(projectDir, spec);
    // For each cell, return the standard scene envelope AND a
    // server-rendered skeleton SVG. The SVG is rendered server-side
    // (rather than in the editor bundle) for two reasons:
    //   1. Editor tsconfig rootDir excludes core sources, so client-side
    //      exporter imports break the strict module graph.
    //   2. Skeleton is byte-deterministic — client never benefits from
    //      re-rendering. Server cache + GET request alignment is cleaner.
    // Missing cells (rotted scene file) come through with envelope/svg
    // both null; renderer surfaces them as error placeholders.
    const cells = loaded.map((cell, i) => {
      if (!cell) return { index: i, slug: spec.cellSceneIds[i], envelope: null, skeletonSvg: null };
      try {
        const envelope = serializeGraph(cell.graph, cell.rootId);
        const skeletonSvg = exportSceneGraphToSvg(cell.graph, cell.rootId, { mode: 'skeleton' });
        return { index: i, slug: cell.slug, envelope, skeletonSvg };
      } catch (err) {
        console.warn(`[sampler-api] failed to serialize/render cell ${cell.slug}:`, err);
        return { index: i, slug: cell.slug, envelope: null, skeletonSvg: null };
      }
    });
    sendJson(res, 200, { ok: true, samplerId, cells });
    return true;
  }

  sendJson(res, 405, { ok: false, error: `method ${req.method} not supported for sampler ${samplerId}/${sub ?? 'spec'}` });
  return true;
}
