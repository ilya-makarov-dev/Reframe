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
      ? { locateFile: (file: string) => {
          // canvasKitWasmPath can be a full URL to .wasm, or a directory prefix
          const path = options.canvasKitWasmPath!;
          if (path.endsWith('.wasm')) return path;
          return path.replace(/\/$/, '') + '/' + file;
        }}
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

    try {
      const vp = options.canvas.parentElement
        ? { w: options.canvas.parentElement.clientWidth, h: options.canvas.parentElement.clientHeight }
        : { w: options.canvas.width, h: options.canvas.height };
      (renderer as any).renderFromEditorState(
        editor.state,
        editor.graph,
        editor.textEditor ?? null,
        vp.w,
        vp.h,
        false, // no rulers
      );
    } catch (err) {
      console.warn('[reframe] Render error:', err);
      running = false;
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

        // Debug: check what the OP graph has
        const opPages = opGraph.getPages();
        let opNodeCount = 0;
        for (const p of opPages) {
          const walk = (id: string) => { opNodeCount++; for (const c of opGraph.getChildren(id)) walk(c.id); };
          walk(p.id);
        }
        // Copy nodes into the FIRST existing page (renderer draws it)
        const existingPages = editor.getPages();
        const editorPage = existingPages.length > 0
          ? existingPages[0]
          : editor.graph.addPage('Imported');

        // Clear existing children to prevent duplication on re-pull
        for (const existing of editor.graph.getChildren(editorPage.id)) {
          try { editor.graph.deleteNode(existing.id); } catch { /* ok */ }
        }

        // Copy ALL fields from source nodes (not a hardcoded subset).
        // Structural fields (type, parentId, childIds) are managed by createNode.
        const structuralKeys = new Set(['type', 'parentId', 'childIds']);
        const copyToEditor = (srcNode: any, destParentId: string) => {
          const overrides: Record<string, any> = { id: srcNode.id };
          for (const key of Object.keys(srcNode)) {
            if (!structuralKeys.has(key) && srcNode[key] !== undefined) {
              overrides[key] = srcNode[key];
            }
          }
          const created = editor.graph.createNode(srcNode.type, destParentId, overrides);
          for (const child of opGraph.getChildren(srcNode.id)) {
            copyToEditor(child, created.id);
          }
        };
        for (const p of opPages) {
          for (const child of opGraph.getChildren(p.id)) {
            copyToEditor(child, editorPage.id);
          }
        }
        // Set currentPageId to the new page with content
        editor.state.currentPageId = editorPage.id;

        // Compute layout
        try { computeAllLayouts(editor.graph); } catch (e) { console.warn('[reframe] Layout:', e); }

        // Ensure editor state has sane defaults
        if (!editor.state.pageColor) {
          editor.state.pageColor = { r: 0.96, g: 0.93, b: 0.86, a: 1 } as any; // warm paper
        }
        if (!editor.state.zoom || editor.state.zoom <= 0) {
          editor.state.zoom = 1;
        }
        if (editor.state.panX == null) editor.state.panX = 0;
        if (editor.state.panY == null) editor.state.panY = 0;

        // Bump version so renderer redraws
        editor.state.sceneVersion = (editor.state.sceneVersion || 0) + 1000;

        // Zoom to fit content
        try {
          editor.zoomToFit();
        } catch (e) {
          console.warn('[reframe] zoomToFit error:', e);
          // Fallback: manual fit
          editor.state.zoom = 0.5;
          editor.state.panX = 100;
          editor.state.panY = 100;
        }

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
