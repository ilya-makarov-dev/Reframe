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

import type { SceneGraph } from '../../../core/src/engine/scene-graph.js';
import { exportToRaster, initCanvasKit } from '../../../core/src/exporters/raster.js';

/** Max base64 payload per content block. 1.5 MB base64 ≈ 1.1 MB raw PNG. */
const INLINE_LIMIT_BYTES = 1_500_000;

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

/**
 * Render a PNG of the scene and return it as an MCP image content block.
 * Returns null if CanvasKit is unavailable, the node is missing, or the
 * render busts the inline byte cap even at reduced scale.
 */
export async function renderPreview(
  graph: SceneGraph,
  rootId: string,
  options: PreviewOptions = {},
): Promise<MCPImageBlock | null> {
  const root = graph.getNode(rootId);
  if (!root || !root.width || !root.height) return null;

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
