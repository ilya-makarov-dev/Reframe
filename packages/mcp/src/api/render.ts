/**
 * Single render endpoint.
 *
 * GET /api/render/:sceneId?format=html&brand=stripe&width=375&height=812&scale=2&mode=dark
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { getScene } from '../store.js';
import { jsonResponse } from './router.js';

export async function handleRenderApi(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const sceneId = url.pathname.split('/api/render/')[1];
  const format = url.searchParams.get('format') ?? 'html';
  const brand = url.searchParams.get('brand') ?? undefined;
  const scale = parseFloat(url.searchParams.get('scale') ?? '1') || 1;
  const mode = url.searchParams.get('mode') ?? undefined;
  const width = url.searchParams.get('width') ? parseInt(url.searchParams.get('width')!) : undefined;
  const height = url.searchParams.get('height') ? parseInt(url.searchParams.get('height')!) : undefined;

  const stored = getScene(sceneId);
  if (!stored) {
    jsonResponse(res, 404, { error: `Scene "${sceneId}" not found` });
    return;
  }

  // Clone graph for non-destructive transforms
  const { SceneGraph } = await import('../../../core/src/engine/scene-graph.js');
  const { serializeGraph, deserializeScene } = await import('../../../core/src/serialize.js');
  const scene = serializeGraph(stored.graph, stored.rootId, { timeline: stored.timeline ?? undefined });
  const { graph, rootId } = deserializeScene(scene);

  // Apply brand if requested
  if (brand) {
    try {
      const { parseDesignMd } = await import('../../../core/src/design-system/index.js');
      const { tokenizeDesignSystem, rebrandColorsFromTokens } = await import('../../../core/src/design-system/tokens.js');
      // Load brand DESIGN.md
      const designModule = await import('../tools/design.js');
      // Try to get brand design markdown
      const brandDir = await import('path').then(p => p.join(process.cwd(), '.reframe', 'brands', `${brand}.md`));
      const fs = await import('fs');
      if (fs.existsSync(brandDir)) {
        const md = fs.readFileSync(brandDir, 'utf-8');
        const ds = parseDesignMd(md);
        const tokenIndex = tokenizeDesignSystem(graph, ds);
        rebrandColorsFromTokens(graph, rootId, tokenIndex);
      }
    } catch {
      // Brand not found — continue without rebrand
    }
  }

  // Apply mode if requested
  if (mode) {
    try {
      const { switchTokenMode, rebuildTokenIndexFromGraph } = await import('../../../core/src/design-system/tokens.js');
      const tokenIndex = rebuildTokenIndexFromGraph(graph);
      if (tokenIndex) {
        switchTokenMode(graph, tokenIndex, mode);
      }
    } catch {
      // No tokens to switch
    }
  }

  // Resize if dimensions specified
  if (width && height) {
    try {
      const { adapt } = await import('../../../core/src/resize/adapt.js');
      const root = graph.getNode(rootId);
      if (root) {
        const result = await adapt(root as any, width, height);
        // Use adapted result
        // For now, just layout at original size
      }
    } catch {
      // Resize failed — continue with original
    }
  }

  // Ensure layout is computed
  const { ensureSceneLayout } = await import('../../../core/src/engine/layout.js');
  ensureSceneLayout(graph, rootId);

  // Export by format
  switch (format) {
    case 'html': {
      const { exportToHtml } = await import('../../../core/src/exporters/html.js');
      const html = exportToHtml(graph, rootId, { fullDocument: true });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    case 'svg': {
      const { exportSvgFromGraph } = await import('../engine.js');
      const svg = exportSvgFromGraph(graph, rootId);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      res.end(svg);
      return;
    }

    case 'png': {
      const { exportToRaster, initCanvasKit } = await import('../../../core/src/exporters/raster.js');
      await initCanvasKit();
      const bytes = await exportToRaster(graph, rootId, { format: 'png', scale });
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(Buffer.from(bytes));
      return;
    }

    case 'react': {
      const { exportToReact } = await import('../../../core/src/exporters/react.js');
      const { StandaloneNode } = await import('../../../core/src/adapters/standalone/node.js');
      const rootNode = new StandaloneNode(graph, graph.getNode(rootId)!);
      const tsx = exportToReact(rootNode as any);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(tsx);
      return;
    }

    case 'lottie': {
      const { exportToLottie } = await import('../../../core/src/exporters/lottie.js');
      const timeline = stored.timeline ?? { animations: [], loop: true, speed: 1 };
      const lottie = exportToLottie(graph, rootId, timeline);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(lottie));
      return;
    }

    default:
      jsonResponse(res, 400, { error: `Unknown format: ${format}. Supported: html, svg, png, react, lottie` });
  }
}
