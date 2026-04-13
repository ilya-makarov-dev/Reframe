/**
 * Headless Render API — REST router.
 *
 * Dispatches /api/* routes to handler modules.
 * Thin HTTP adapter layer — all business logic in core.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { handleRenderApi } from './render.js';
import { handleBatchApi } from './batch.js';
import { handleTokensApi } from './tokens.js';
import { handleBlocksApi } from './blocks.js';
import { handleAuditApi } from './audit.js';
import { handleScenesApi } from './scenes.js';

/** Try to handle an /api/* request. Returns true if handled. */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // CORS headers for API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  try {
    // /api/render/:sceneId
    if (path.match(/^\/api\/render\/[^/]+$/) && method === 'GET') {
      await handleRenderApi(req, res, url);
      return true;
    }

    // /api/render/batch (POST)
    if (path === '/api/render/batch' && method === 'POST') {
      await handleBatchApi(req, res);
      return true;
    }

    // /api/tokens/:sceneId
    if (path.match(/^\/api\/tokens\/[^/]+$/)) {
      await handleTokensApi(req, res, url);
      return true;
    }

    // /api/blocks
    if (path.startsWith('/api/blocks')) {
      await handleBlocksApi(req, res, url);
      return true;
    }

    // /api/audit/:sceneId
    if (path.match(/^\/api\/audit\/[^/]+$/) && method === 'GET') {
      await handleAuditApi(req, res, url);
      return true;
    }

    // /api/scenes
    if (path === '/api/scenes' && method === 'GET') {
      await handleScenesApi(req, res);
      return true;
    }

    // /api/compile (POST)
    if (path === '/api/compile' && method === 'POST') {
      // TODO: compile endpoint
      jsonResponse(res, 501, { error: 'Not yet implemented' });
      return true;
    }

    return false;
  } catch (err: any) {
    jsonResponse(res, 500, { error: err.message });
    return true;
  }
}

export function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
