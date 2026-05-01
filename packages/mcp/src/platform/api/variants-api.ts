/**
 * Platform API — variants spec endpoints (Brief 4b Pin #1).
 *
 * Routes:
 *   GET  /platform/api/variants/:variantsId        → variants.json spec
 *   POST /platform/api/variants                    → create/update spec
 *   GET  /platform/api/variants                    → list ids
 *   DELETE /platform/api/variants/:variantsId      → remove spec
 *
 * Pairs with the URL-param ?variants=<id> renderer in
 * `packages/editor/src/app/platform-bootstrap.ts`. The renderer's
 * existing CSV mode (`?variants=a,b,c` with raw scene ids) keeps
 * working; storage-backed mode (`?variants=<storageId>`) is detected
 * by the renderer fetching this endpoint when the param isn't a CSV.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import {
  readVariantsSpec,
  writeVariantsSpec,
  listVariants,
  deleteVariants,
  type VariantsSpecInput,
} from '../../../../core/src/project/variants-store.js';

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

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

function parsePath(pathname: string): { variantsId: string | null } | null {
  // /platform/api/variants            (no id — list/create)
  // /platform/api/variants/:id        (single)
  const m = pathname.match(/^\/platform\/api\/variants(?:\/([^\/]+))?\/?$/);
  if (!m) return null;
  return { variantsId: m[1] ? decodeURIComponent(m[1]) : null };
}

export async function handleVariantsApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parsed = parsePath(url.pathname);
  if (!parsed) return false;
  const { variantsId } = parsed;

  const projectDir = ctx.projectDir;
  if (!projectDir) {
    sendJson(res, 400, { ok: false, error: 'no project open' });
    return true;
  }

  // GET /platform/api/variants — list all ids
  if (req.method === 'GET' && variantsId === null) {
    const ids = listVariants(projectDir);
    const specs = ids.map((id) => readVariantsSpec(projectDir, id)).filter(Boolean);
    sendJson(res, 200, { ok: true, variants: specs });
    return true;
  }

  // GET /platform/api/variants/:id — single spec
  if (req.method === 'GET' && variantsId !== null) {
    const spec = readVariantsSpec(projectDir, variantsId);
    if (!spec) {
      sendJson(res, 404, { ok: false, error: 'variants not found', variantsId });
      return true;
    }
    sendJson(res, 200, { ok: true, spec });
    return true;
  }

  // POST /platform/api/variants — create/update
  if (req.method === 'POST' && variantsId === null) {
    const body = await readBody(req);
    const input: VariantsSpecInput = {
      variantsId: String(body.variantsId || '').trim(),
      name: body.name ? String(body.name) : undefined,
      sceneId: String(body.sceneId || '').trim(),
      axes: Array.isArray(body.axes) ? body.axes : [],
      grid: body.grid && typeof body.grid === 'object' ? body.grid : undefined,
      brand: body.brand ? String(body.brand) : undefined,
    };
    try {
      const spec = writeVariantsSpec(projectDir, input);
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'composition:created:variants', variantsId: spec.variantsId } as any);
      } catch { /* best-effort */ }
      sendJson(res, 200, { ok: true, spec });
    } catch (e: any) {
      sendJson(res, 400, { ok: false, error: e?.message ?? 'invalid spec' });
    }
    return true;
  }

  // DELETE /platform/api/variants/:id
  if (req.method === 'DELETE' && variantsId !== null) {
    const removed = deleteVariants(projectDir, variantsId);
    if (removed) {
      try {
        const { emitEvent } = await import('../../http-server.js');
        emitEvent({ type: 'composition:deleted:variants', variantsId } as any);
      } catch { /* best-effort */ }
    }
    sendJson(res, 200, { ok: true, removed });
    return true;
  }

  sendJson(res, 405, { ok: false, error: `method ${req.method} not supported` });
  return true;
}
