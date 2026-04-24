/**
 * Platform API — resize / viewport adaptation.
 *
 * Thin HTTP wrapper around `reframe_edit op=adapt` so the UI can spawn
 * a tablet / phone variant without routing through the chat agent. The
 * heavy lifting (graph adapt + store + export) lives in
 * `core/src/resize/adapt.ts`. This handler:
 *
 *   POST /platform/api/resize/apply
 *     body: { sourceSceneId, width, height, strategy?, name? }
 *     200:  { ok: true, sceneId, slug, name, width, height }
 *     400:  { ok: false, error }
 *
 * Dedup lives in the UI — clients typically call
 * /platform/api/project/health first to find an existing variant with
 * the target dimensions and only POST here on a miss.
 *
 * Why HTTP and not the agent?  Viewport preview is a mechanical operation
 * with no taste input, so dragging the LLM into it wastes tokens and
 * adds 10+ s of latency.  The UI can call adapt directly and navigate to
 * the result as soon as storeScene returns.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { PlatformContext } from '../router.js';
import { adaptFromGraph } from '../../../../core/src/resize/adapt.js';
import { exportToHtml } from '../../../../core/src/exporters/html.js';
import { storeScene, getScene, resaveScene } from '../../store.js';
import { getSession } from '../../session.js';

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

export async function handleResizeApi(
  req: IncomingMessage,
  res: ServerResponse,
  _ctx: PlatformContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname !== '/platform/api/resize/apply' || req.method !== 'POST') {
    return false;
  }

  const body = await readJson(req);
  const sourceSceneId = String(body.sourceSceneId || body.sceneId || '').trim();
  const width = Number(body.width);
  const height = Number(body.height);
  const strategy = (body.strategy as 'smart' | 'contain' | 'cover' | 'stretch' | 'reflow') || 'smart';
  const nameHint = body.name as string | undefined;

  if (!sourceSceneId) {
    sendJson(res, 400, { ok: false, error: 'sourceSceneId required' });
    return true;
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    sendJson(res, 400, { ok: false, error: 'width and height required (positive integers)' });
    return true;
  }

  const stored = getScene(sourceSceneId);
  if (!stored) {
    sendJson(res, 404, { ok: false, error: `scene ${sourceSceneId} not found` });
    return true;
  }

  try {
    getSession().recordToolCall('resize');

    const result = await adaptFromGraph(stored.graph, stored.rootId, width, height, {
      strategy,
      useGuide: true,
      preserveProportions: true,
    });

    // Same root-pinning + position-reset as the MCP tool — the reflow
    // pipeline parks clones beside their sources and can leave stale
    // positions when the variant is stored as a standalone scene.
    try {
      result.graph.updateNode(result.root.id, { x: 0, y: 0, width, height });
    } catch { /* best-effort */ }

    const tName = nameHint || `${width}x${height}`;
    const childName = `${stored.name} ${tName}`;
    const sourceSlug = (stored.slug || sourceSceneId).replace(/[^a-z0-9-]+/gi, '-');
    const childSlug = `${sourceSlug}-${width}x${height}`;

    const newSceneId = storeScene(result.graph, result.root.id, undefined, {
      name: childName,
      slug: childSlug,
    });

    // Inherit group + brand so the variant appears in the same project
    // and retains its brand mapping. Matches resize.ts's MCP-side logic.
    const newStored = getScene(newSceneId);
    if (newStored) {
      if (stored.group) newStored.group = stored.group;
      if (stored.brand) newStored.brand = stored.brand;
      if (stored.brandHash) newStored.brandHash = stored.brandHash;
      try { resaveScene(newSceneId); } catch { /* best-effort */ }
    }

    // Fire-and-forget HTML export so the variant has a rendered preview
    // ready when the UI navigates to it. Failure here is non-fatal.
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import('fs');
      const { join } = await import('path');
      const { getExportsBaseDir } = await import('../../store.js');
      const exportDir = getExportsBaseDir();
      if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
      const html = exportToHtml(result.graph, result.root.id, { fullDocument: true });
      writeFileSync(join(exportDir, `${newSceneId}-${width}x${height}.html`), html);
    } catch { /* best-effort */ }

    sendJson(res, 200, {
      ok: true,
      sceneId: newSceneId,
      slug: newStored?.slug ?? childSlug,
      name: childName,
      width,
      height,
    });
  } catch (err: any) {
    sendJson(res, 400, { ok: false, error: err?.message || 'adapt failed' });
  }
  return true;
}
