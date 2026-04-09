/**
 * Batches HTML preview refreshes off SceneGraph emitter events (rAF).
 * Studio skips flushes while canvasPointerDragNodeId is set (drag uses CSS transform).
 *
 * Call cancelPendingStudioGraphPreview() after a synchronous path already ran
 * exportToHtml (e.g. recordHistory + renderedHtml) to avoid a duplicate tree walk.
 */

import type { SceneGraph } from '@reframe/core/engine/scene-graph';

type FlushFn = () => void;

let previewRafId = 0;

/** Cancel a scheduled preview flush (same graph mutation stack as exportToHtml in history path). */
export function cancelPendingStudioGraphPreview(): void {
  if (previewRafId) {
    cancelAnimationFrame(previewRafId);
    previewRafId = 0;
  }
}

let binding: {
  graph: SceneGraph;
  dispose: () => void;
} | null = null;

export function bindStudioGraphPreview(graph: SceneGraph | null, flush: FlushFn): void {
  binding?.dispose();
  binding = null;
  cancelPendingStudioGraphPreview();
  if (!graph) return;

  const schedule = () => {
    if (previewRafId) return;
    previewRafId = requestAnimationFrame(() => {
      previewRafId = 0;
      flush();
    });
  };

  const offs = [
    graph.emitter.on('node:created', schedule),
    graph.emitter.on('node:updated', schedule),
    graph.emitter.on('node:deleted', schedule),
    graph.emitter.on('node:reparented', schedule),
    graph.emitter.on('node:reordered', schedule),
  ];

  binding = {
    graph,
    dispose: () => {
      cancelPendingStudioGraphPreview();
      for (const off of offs) off();
    },
  };
}

export function disposeStudioGraphPreview(): void {
  binding?.dispose();
  binding = null;
}
