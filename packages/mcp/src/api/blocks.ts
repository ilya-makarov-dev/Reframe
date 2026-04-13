/**
 * Block Library API endpoints.
 *
 * GET  /api/blocks?category=hero          → list blocks
 * GET  /api/blocks/:name                  → get block definition
 * POST /api/blocks/instantiate            → create scene from block
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { jsonResponse, readBody } from './router.js';
import {
  listBlocks,
  getBlock,
  instantiateBlock,
  registerStarterBlocks,
  blockCount,
} from '../../../core/src/blocks/index.js';
import type { BlockCategory } from '../../../core/src/blocks/types.js';
import { storeScene } from '../store.js';

let _initialized = false;
function ensureBlocks() {
  if (_initialized) return;
  _initialized = true;
  registerStarterBlocks();
}

export async function handleBlocksApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  ensureBlocks();

  if (req.method === 'GET') {
    // /api/blocks?category=hero
    if (url.pathname === '/api/blocks') {
      const category = url.searchParams.get('category') as BlockCategory | null;
      const blocks = listBlocks(category ?? undefined);
      jsonResponse(res, 200, {
        total: blocks.length,
        blocks: blocks.map(b => ({
          name: b.name,
          category: b.category,
          description: b.description,
          slots: b.slots.length,
          tags: b.tags,
        })),
      });
      return;
    }

    // /api/blocks/:name
    const name = url.pathname.split('/api/blocks/')[1];
    if (name) {
      const block = getBlock(name);
      if (!block) {
        jsonResponse(res, 404, { error: `Block "${name}" not found` });
        return;
      }
      jsonResponse(res, 200, block);
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/blocks/instantiate') {
    const body = await readBody(req);
    let input: { name: string; slots?: Record<string, string>; brand?: string };
    try {
      input = JSON.parse(body);
    } catch {
      jsonResponse(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    if (!input.name) {
      jsonResponse(res, 400, { error: 'name is required' });
      return;
    }

    const block = getBlock(input.name);
    if (!block) {
      jsonResponse(res, 404, { error: `Block "${input.name}" not found` });
      return;
    }

    const result = instantiateBlock(block, input.slots);
    const sceneId = storeScene(result.graph, result.rootId, undefined, {
      slug: block.name,
      name: block.name,
    });

    jsonResponse(res, 200, {
      sceneId,
      block: block.name,
      filledSlots: result.filledSlots,
      totalSlots: result.totalSlots,
      nodeCount: result.graph.nodes.size,
    });
    return;
  }

  jsonResponse(res, 405, { error: 'Method not allowed' });
}
