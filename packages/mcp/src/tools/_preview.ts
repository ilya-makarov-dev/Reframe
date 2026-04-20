/**
 * Inline PNG preview for MCP tool results.
 *
 * Every design tool (compile, inspect, edit, export) optionally returns an
 * `image` content block rendering the current scene. This closes the "the
 * agent can't see what it's building" loop — multimodal hosts display the
 * PNG inline, and follow-up tool calls can reason about the visual.
 *
 * Design:
 *   - auto-downscale to fit `maxWidth` (default 1200 px) so previews are
 *     small enough for a single tool response.
 *   - re-attempt at 0.6× if the first render busts the 1.5 MB base64 cap.
 *   - failure silently returns null — preview is additive, never blocks the
 *     primary result.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { exportToRaster, initCanvasKit } from '../../../core/src/exporters/raster.js';
import { getExportsBaseDir } from '../store.js';

/** Max base64 payload per content block. 1.5 MB base64 ≈ 1.1 MB raw PNG. */
const INLINE_LIMIT_BYTES = 1_500_000;

/**
 * Hard dimension cap. If either the rendered width or height would exceed
 * this value, the preview is refused. Huge PNGs (e.g. a 1440×6800 long-scroll
 * scene) break chat UIs that stream inline images — a tall image drowns the
 * response. Enforce it here so every caller (compile, inspect, edit, export
 * preview) inherits the guard.
 */
const MAX_INLINE_DIMENSION = 2000;

export interface PreviewOptions {
  /** Clamp the rendered width. Default 1200 px. Set lower for batch calls. */
  maxWidth?: number;
  /** Background color passed through to CanvasKit. */
  background?: string;
}

export interface MCPImageBlock {
  type: 'image';
  data: string;
  mimeType: 'image/png';
}

export interface MCPTextBlock {
  type: 'text';
  text: string;
}

export type MCPPreviewBlock = MCPImageBlock | MCPTextBlock;

/**
 * Render a PNG of the scene and return it as an MCP content block.
 *
 * Returns an inline image block when the scene fits the inline caps
 * (≤ MAX_INLINE_DIMENSION on both axes, under INLINE_LIMIT_BYTES after
 * base64). Long-scroll scenes like a 1440×6800 editorial quarterly would
 * saturate a chat UI if inlined, so for those we write a full-resolution
 * PNG to `.reframe/exports/` and return a compact text block pointing at
 * the file instead. Callers treat both blocks uniformly —
 * `content.push(block)` — and the chat renders whichever it received.
 *
 * Returns null only if CanvasKit is unavailable or the root node is
 * missing. Preview is always additive — callers never block on it.
 */
export async function renderPreview(
  graph: SceneGraph,
  rootId: string,
  options: PreviewOptions = {},
): Promise<MCPPreviewBlock | null> {
  const root = graph.getNode(rootId);
  if (!root || !root.width || !root.height) return null;

  const exceedsCap = root.width > MAX_INLINE_DIMENSION
    || root.height > MAX_INLINE_DIMENSION;
  if (exceedsCap) {
    return savePreviewFile(graph, rootId, root.width, root.height, options);
  }

  // CanvasKit init is a one-time ~500 ms cost. Subsequent previews are
  // cheap. Await once — failure here means raster isn't available at all
  // and we should gracefully omit the preview rather than throw.
  try {
    await initCanvasKit();
  } catch {
    return null;
  }

  const maxWidth = options.maxWidth ?? 1200;
  const baseScale = root.width > maxWidth ? maxWidth / root.width : 1;

  const tryRender = async (scale: number): Promise<MCPImageBlock | null> => {
    try {
      const bytes = await exportToRaster(graph, rootId, {
        format: 'png',
        scale,
        background: options.background,
      });
      if (bytes.length > INLINE_LIMIT_BYTES) return null;
      const data = Buffer
        .from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .toString('base64');
      return { type: 'image', data, mimeType: 'image/png' };
    } catch {
      return null;
    }
  };

  const first = await tryRender(baseScale);
  if (first) return first;

  // Busted the size cap at the target scale — retry smaller. If that
  // still doesn't fit, give up rather than degrading to an unreadable
  // thumbnail.
  return tryRender(baseScale * 0.6);
}

/**
 * Render the scene at full resolution, write it to `.reframe/exports/`,
 * and return a text block with the file path. Used when the scene's
 * dimensions exceed MAX_INLINE_DIMENSION — inline would either drown the
 * chat or degrade to an unreadable thumbnail, so we persist the real
 * artifact and hand the caller a pointer.
 */
async function savePreviewFile(
  graph: SceneGraph,
  rootId: string,
  width: number,
  height: number,
  options: PreviewOptions,
): Promise<MCPTextBlock | null> {
  try {
    await initCanvasKit();
    const bytes = await exportToRaster(graph, rootId, {
      format: 'png',
      scale: 1,
      background: options.background,
    });
    const dir = getExportsBaseDir();
    fs.mkdirSync(dir, { recursive: true });
    const nodeName = (graph.getNode(rootId)?.name ?? 'preview').replace(/[^a-z0-9-_]+/gi, '-');
    const filePath = path.join(dir, `${nodeName}.preview.png`);
    fs.writeFileSync(filePath, bytes);
    const kb = Math.round(bytes.length / 1024);
    return {
      type: 'text',
      text: `⛔ INLINE PREVIEW REFUSED — scene is ${width}×${height}px (limit: ${MAX_INLINE_DIMENSION}×${MAX_INLINE_DIMENSION}). Inlining a PNG this large saturates the chat UI, so no image is attached. Full-resolution render saved to ${filePath} (${kb}KB). Open that file to view the scene. Subsequent calls on this scene should keep preview:false unless the viewport shrinks below the limit.`,
    };
  } catch {
    return null;
  }
}
