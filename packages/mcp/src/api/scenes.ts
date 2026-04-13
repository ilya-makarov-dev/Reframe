/**
 * Scenes API endpoint.
 *
 * GET /api/scenes — list all scenes in session
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { listScenes } from '../store.js';
import { jsonResponse } from './router.js';

export async function handleScenesApi(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const scenes = listScenes();
  jsonResponse(res, 200, {
    total: scenes.length,
    scenes: scenes.map(s => ({
      id: s.id,
      name: s.name,
      size: s.size,
      nodes: s.nodes,
    })),
  });
}
