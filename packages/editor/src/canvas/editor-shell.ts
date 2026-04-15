/**
 * Editor Shell — wraps @open-pencil/core's createEditor() for reframe.
 *
 * This is the main integration point. Creates an OP editor, wires up
 * CanvasKit + SkiaRenderer, and exposes methods to feed reframe SceneGraphs
 * into the interactive viewport.
 *
 * Usage:
 *   const shell = await createReframeEditor(canvasElement);
 *   shell.loadFromReframeGraph(rfGraph, rootId);  // AI pipeline output → viewport
 *   shell.onGraphChanged(callback);                // viewport edits → reframe sync
 */

import {
  createEditor,
  getCanvasKit,
  SkiaRenderer,
  SceneGraph as OPSceneGraph,
  computeAllLayouts,
  type RenderOverlays,
  type Editor,
} from '@open-pencil/core';

import { SceneGraph as RFSceneGraph } from '@reframe/core';
import type { SceneNode as RFSceneNode } from '@reframe/core';

import { GraphBridge } from '../bridge/graph-bridge.js';

// ─── Types ──────────────────────────────────────────────────

export interface ReframeEditorOptions {
  /** Canvas element for CanvasKit WebGL rendering. */
  canvas: HTMLCanvasElement;
  /** Custom WASM path for CanvasKit (default: auto-detect). */
  canvasKitWasmPath?: string;
  /** Called when the graph is mutated by user interaction. */
  onGraphChanged?: (opGraph: OPSceneGraph) => void;
  /** Called when selection changes. */
  onSelectionChanged?: (selectedIds: Set<string>) => void;
}

export interface ReframeEditorShell {
  /** The underlying OpenPencil editor instance. */
  editor: Editor;
  /** The graph bridge for converting between OP and reframe graphs. */
  bridge: GraphBridge;
  /** The SkiaRenderer for the viewport. */
  renderer: SkiaRenderer;

  /** Load a reframe SceneGraph into the viewport (from HTML import, MCP, etc). */
  loadFromReframeGraph(rfGraph: RFSceneGraph, rootId: string): void;
  /** Get the current graph as a reframe SceneGraph (for audit, export, etc). */
  toReframeGraph(): { graph: RFSceneGraph; rootId: string };
  /** Start the render loop. */
  startRenderLoop(): void;
  /** Stop the render loop. */
  stopRenderLoop(): void;
  /** Clean up all resources. */
  destroy(): void;
}

// ─── Factory ────────────────────────────────────────────────

/**
 * Create a reframe-powered editor with CanvasKit viewport.
 *
 * This initializes CanvasKit WASM, creates the OP editor with SceneGraph,
 * sets up the SkiaRenderer on the provided canvas, and returns a shell
 * with methods to bridge reframe and OpenPencil.
 */
export async function createReframeEditor(
  options: ReframeEditorOptions,
): Promise<ReframeEditorShell> {
  const { canvas, onGraphChanged, onSelectionChanged } = options;

  // 1. Initialize CanvasKit (Skia WASM)
  const ck = await getCanvasKit(
    options.canvasKitWasmPath
      ? { locateFile: () => options.canvasKitWasmPath! }
      : undefined,
  );

  // 2. Create WebGL surface on the canvas
  const surface = ck.MakeWebGLCanvasSurface(canvas);
  if (!surface) {
    throw new Error('Failed to create WebGL surface. Check canvas element and WebGL support.');
  }

  // 3. Create OpenPencil editor
  const editor = createEditor({
    graph: new OPSceneGraph(),
    getViewportSize: () => ({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
    }),
  });

  // 4. Create SkiaRenderer and wire to editor
  const renderer = new SkiaRenderer(ck, surface);
  editor.setCanvasKit(ck, renderer);

  // 5. Create bridge
  const bridge = new GraphBridge();

  // 6. Listen for graph changes (user edits on canvas)
  let lastSceneVersion = 0;
  const graphChangeCheck = () => {
    if (editor.state.sceneVersion !== lastSceneVersion) {
      lastSceneVersion = editor.state.sceneVersion;
      onGraphChanged?.(editor.graph);
    }
  };

  // 7. Listen for selection changes
  let lastSelectedIds = new Set<string>();
  const selectionChangeCheck = () => {
    const current = editor.state.selectedIds;
    if (current.size !== lastSelectedIds.size || ![...current].every(id => lastSelectedIds.has(id))) {
      lastSelectedIds = new Set(current);
      onSelectionChanged?.(current);
    }
  };

  // 8. Render loop
  let running = false;
  let rafId: number | null = null;

  function renderFrame() {
    if (!running) return;

    try {
      // Check for changes
      graphChangeCheck();
      selectionChangeCheck();
    } catch { /* non-critical — continue rendering */ }

    // Build overlays from editor state
    const overlays: RenderOverlays = {
      hoveredNodeId: editor.state.hoveredNodeId,
      enteredContainerId: editor.state.enteredContainerId,
      editingTextId: editor.state.editingTextId,
      textEditor: editor.textEditor ?? undefined,
      marquee: editor.state.marquee,
      snapGuides: editor.state.snapGuides,
      rotationPreview: editor.state.rotationPreview,
      dropTargetId: editor.state.dropTargetId,
      layoutInsertIndicator: editor.state.layoutInsertIndicator,
      penState: editor.state.penState as any,
      remoteCursors: editor.state.remoteCursors as any,
    };

    // Render
    try {
      renderer.render(
        editor.graph,
        editor.state.selectedIds,
        overlays,
        editor.state.sceneVersion,
      );
    } catch (err) {
      // Don't let a render error kill the loop
      console.warn('[reframe] Render error:', err);
    }

    rafId = requestAnimationFrame(renderFrame);
  }

  // ─── Shell API ──────────────────────────────────────────

  const shell: ReframeEditorShell = {
    editor,
    bridge,
    renderer,

    loadFromReframeGraph(rfGraph: RFSceneGraph, rootId: string) {
      try {
        // Convert reframe graph → OP graph (extracts extensions)
        const opGraph = bridge.fromReframeGraph(rfGraph, rootId);

        // Replace the editor's graph
        editor.replaceGraph(opGraph);

        // Set currentPageId so layer tree and hit-testing work
        const pages = editor.getPages();
        if (pages.length > 0 && editor.state.currentPageId !== pages[0].id) {
          editor.state.currentPageId = pages[0].id;
        }

        // Compute layout (OP's Yoga)
        try {
          computeAllLayouts(editor.graph);
        } catch {
          // Layout may fail on edge-case graphs — render anyway
        }

        // Zoom to fit content
        editor.zoomToFit();

        // Trigger render
        editor.requestRender();
      } catch (err) {
        console.error('[reframe] loadFromReframeGraph failed:', err);
      }
    },

    toReframeGraph() {
      return bridge.toReframeGraph(editor.graph);
    },

    startRenderLoop() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(renderFrame);
    },

    stopRenderLoop() {
      running = false;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },

    destroy() {
      shell.stopRenderLoop();
      surface.delete();
    },
  };

  return shell;
}
