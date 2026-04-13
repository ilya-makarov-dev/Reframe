/**
 * Token API endpoints.
 *
 * GET  /api/tokens/:sceneId?format=dtcg  → export tokens
 * POST /api/tokens/:sceneId              → import tokens
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getScene } from '../store.js';
import { jsonResponse, readBody } from './router.js';
import { exportToDTCG, importFromDTCG } from '../../../core/src/design-system/dtcg.js';

export async function handleTokensApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const sceneId = url.pathname.split('/api/tokens/')[1];
  const stored = getScene(sceneId);
  if (!stored) {
    jsonResponse(res, 404, { error: `Scene "${sceneId}" not found` });
    return;
  }

  if (req.method === 'GET') {
    const dtcg = exportToDTCG(stored.graph);
    jsonResponse(res, 200, dtcg);
    return;
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    let dtcg: Record<string, unknown>;
    try {
      dtcg = JSON.parse(body);
    } catch {
      jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const index = importFromDTCG(stored.graph, dtcg as any);
    jsonResponse(res, 200, {
      imported: index.tokens.size,
      collectionId: index.collectionId,
      modes: index.modeIds,
    });
    return;
  }

  jsonResponse(res, 405, { error: 'Method not allowed' });
}
