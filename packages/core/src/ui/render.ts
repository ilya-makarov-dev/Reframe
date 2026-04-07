/**
 * render() — one function to go from UI tree → output.
 *
 * Handles: build → layout → export. Zero boilerplate.
 *
 * Usage:
 *   const html = await render(page({ w: 1440, h: 900 }, heading('Hi')));
 *   const svg  = await render(myDesign, 'svg');
 *   const react = await render(myDesign, 'react');
 *
 * Or render to multiple formats at once:
 *   const { html, svg } = await renderAll(myDesign, ['html', 'svg']);
 */

import type { NodeBlueprint } from '../builder.js';
import { build } from '../builder.js';
import { StandaloneHost } from '../adapters/standalone/adapter.js';
import { StandaloneNode } from '../adapters/standalone/node.js';
import { setHost } from '../host/context.js';
import type { SceneGraph } from '../engine/scene-graph.js';

// Lazy-loaded to avoid import issues when Yoga isn't needed
let yogaReady = false;

async function ensureYoga() {
  if (yogaReady) return;
  try {
    const { initYoga } = await import('../engine/yoga-init.js');
    await initYoga();
    yogaReady = true;
  } catch (_) {
    // Yoga not available — layout will use blueprint positions
    yogaReady = true;
  }
}

async function doLayout(graph: SceneGraph, rootId: string) {
  try {
    const { computeAllLayouts } = await import('../engine/layout.js');
    computeAllLayouts(graph, rootId);
  } catch (_) {
    // Layout engine not available — use blueprint positions
  }
}

export type RenderFormat = 'html' | 'svg' | 'react';

/** Render a UI tree to HTML (default), SVG, or React. */
export async function render(
  blueprint: NodeBlueprint,
  format?: RenderFormat,
  options?: {
    fullDocument?: boolean;
    dataAttributes?: boolean;
  },
): Promise<string> {
  await ensureYoga();

  const { graph, root } = build(blueprint);
  setHost(new StandaloneHost(graph));
  await doLayout(graph, root.id);

  const fmt = format ?? 'html';

  switch (fmt) {
    case 'html': {
      const { exportToHtml } = await import('../exporters/html.js');
      return exportToHtml(graph, root.id, {
        fullDocument: options?.fullDocument ?? true,
        dataAttributes: options?.dataAttributes ?? false,
      });
    }
    case 'svg': {
      const { exportSceneGraphToSvg } = await import('../exporters/svg.js');
      return exportSceneGraphToSvg(graph, root.id);
    }
    case 'react': {
      const { exportToReact } = await import('../exporters/react.js');
      const wrappedRoot = new StandaloneNode(graph, graph.getNode(root.id)!);
      return exportToReact(wrappedRoot);
    }
    default:
      throw new Error(`Unknown format: ${fmt}`);
  }
}

/** Render to multiple formats at once. */
export async function renderAll(
  blueprint: NodeBlueprint,
  formats: RenderFormat[],
): Promise<Record<string, string>> {
  await ensureYoga();

  const { graph, root } = build(blueprint);
  setHost(new StandaloneHost(graph));
  await doLayout(graph, root.id);

  const results: Record<string, string> = {};

  for (const fmt of formats) {
    switch (fmt) {
      case 'html': {
        const { exportToHtml } = await import('../exporters/html.js');
        results.html = exportToHtml(graph, root.id, { fullDocument: true });
        break;
      }
      case 'svg': {
        const { exportSceneGraphToSvg } = await import('../exporters/svg.js');
        results.svg = exportSceneGraphToSvg(graph, root.id);
        break;
      }
      case 'react': {
        const { exportToReact } = await import('../exporters/react.js');
        const wrappedRoot = new StandaloneNode(graph, graph.getNode(root.id)!);
        results.react = exportToReact(wrappedRoot);
        break;
      }
    }
  }

  return results;
}

/** Synchronous render — requires Yoga to be already initialized.
 *  Use when you've already called initYoga() or don't need layout. */
export function renderSync(
  blueprint: NodeBlueprint,
  format?: RenderFormat,
): string {
  const { graph, root } = build(blueprint);
  setHost(new StandaloneHost(graph));

  // Try layout synchronously
  try {
    const layout = require('../engine/layout.js');
    layout.computeAllLayouts(graph, root.id);
  } catch (_) {}

  const fmt = format ?? 'html';

  switch (fmt) {
    case 'html': {
      const { exportToHtml } = require('../exporters/html.js');
      return exportToHtml(graph, root.id, { fullDocument: true });
    }
    case 'svg': {
      const { exportSceneGraphToSvg } = require('../exporters/svg.js');
      return exportSceneGraphToSvg(graph, root.id);
    }
    case 'react': {
      const { exportToReact } = require('../exporters/react.js');
      const wrappedRoot = new StandaloneNode(graph, graph.getNode(root.id)!);
      return exportToReact(wrappedRoot);
    }
    default:
      throw new Error(`Unknown format: ${fmt}`);
  }
}
