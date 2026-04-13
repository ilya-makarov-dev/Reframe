/**
 * Batch render endpoint.
 *
 * POST /api/render/batch
 * Body: { sceneId, formats[], brands?[], viewports?[], scale? }
 * Returns manifest of all generated outputs.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getScene, getExportsBaseDir } from '../store.js';
import { jsonResponse, readBody } from './router.js';

interface BatchRequest {
  sceneId: string;
  formats: string[];
  brands?: string[];
  viewports?: Array<{ name: string; width: number; height: number }>;
  scale?: number;
}

interface BatchResult {
  format: string;
  brand?: string;
  viewport?: string;
  path: string;
  size: number;
}

export async function handleBatchApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  let input: BatchRequest;
  try {
    input = JSON.parse(body);
  } catch {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!input.sceneId || !input.formats || input.formats.length === 0) {
    jsonResponse(res, 400, { error: 'sceneId and formats[] are required' });
    return;
  }

  const stored = getScene(input.sceneId);
  if (!stored) {
    jsonResponse(res, 404, { error: `Scene "${input.sceneId}" not found` });
    return;
  }

  const brands = input.brands ?? [undefined as unknown as string];
  const viewports = input.viewports ?? [undefined as unknown as { name: string; width: number; height: number }];
  const scale = input.scale ?? 1;

  // Create batch export directory
  const batchDir = join(getExportsBaseDir(), 'batch', String(Date.now()));
  if (!existsSync(batchDir)) mkdirSync(batchDir, { recursive: true });

  const results: BatchResult[] = [];
  const { serializeGraph, deserializeScene } = await import('../../../core/src/serialize.js');
  const { ensureSceneLayout } = await import('../../../core/src/engine/layout.js');

  for (const format of input.formats) {
    for (const brand of brands) {
      for (const viewport of viewports) {
        try {
          // Clone for each combination
          const scene = serializeGraph(stored.graph, stored.rootId, { timeline: stored.timeline ?? undefined });
          const { graph, rootId } = deserializeScene(scene);

          // Apply brand
          if (brand) {
            try {
              const { parseDesignMd } = await import('../../../core/src/design-system/index.js');
              const { tokenizeDesignSystem, rebrandColorsFromTokens } = await import('../../../core/src/design-system/tokens.js');
              const fs = await import('fs');
              const path = await import('path');
              const brandPath = path.join(process.cwd(), '.reframe', 'brands', `${brand}.md`);
              if (fs.existsSync(brandPath)) {
                const md = fs.readFileSync(brandPath, 'utf-8');
                const ds = parseDesignMd(md);
                const idx = tokenizeDesignSystem(graph, ds);
                rebrandColorsFromTokens(graph, rootId, idx);
              }
            } catch { /* skip */ }
          }

          ensureSceneLayout(graph, rootId);

          // Generate filename
          const parts = [stored.slug ?? input.sceneId];
          if (brand) parts.push(brand);
          if (viewport) parts.push(viewport.name);
          const extMap: Record<string, string> = { html: 'html', svg: 'svg', png: 'png', react: 'tsx', lottie: 'json' };
          const ext = extMap[format] ?? format;
          const fileName = `${parts.join('-')}.${ext}`;
          const filePath = join(batchDir, fileName);

          // Export
          let content: string | Uint8Array;
          switch (format) {
            case 'html': {
              const { exportToHtml } = await import('../../../core/src/exporters/html.js');
              content = exportToHtml(graph, rootId, { fullDocument: true });
              break;
            }
            case 'svg': {
              const { exportSvgFromGraph } = await import('../engine.js');
              content = exportSvgFromGraph(graph, rootId);
              break;
            }
            case 'png': {
              const { exportToRaster, initCanvasKit } = await import('../../../core/src/exporters/raster.js');
              await initCanvasKit();
              content = await exportToRaster(graph, rootId, { format: 'png', scale });
              break;
            }
            case 'react': {
              const { exportToReact } = await import('../../../core/src/exporters/react.js');
              const { StandaloneNode } = await import('../../../core/src/adapters/standalone/node.js');
              const rootNode = new StandaloneNode(graph, graph.getNode(rootId)!);
              content = exportToReact(rootNode as any);
              break;
            }
            default:
              continue;
          }

          writeFileSync(filePath, content);
          results.push({
            format,
            brand: brand || undefined,
            viewport: viewport?.name,
            path: filePath,
            size: typeof content === 'string' ? Buffer.byteLength(content) : content.length,
          });
        } catch (err: any) {
          results.push({
            format,
            brand: brand || undefined,
            viewport: viewport?.name,
            path: '',
            size: 0,
          });
        }
      }
    }
  }

  jsonResponse(res, 200, {
    batchDir,
    total: results.length,
    success: results.filter(r => r.size > 0).length,
    results,
  });
}
