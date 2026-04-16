/**
 * Platform Bootstrap — CanvasKit viewport + bidirectional INode↔OP sync.
 *
 * This is the THIN CANVAS LAYER. It handles:
 * - CanvasKit init + render loop
 * - Pointer interaction (drag, resize, create, select)
 * - Floating toolbar + keyboard shortcuts
 * - Bidirectional sync via 3 channels:
 *   A) Canvas→Server: graph emitter → CustomEvents → scripts.ts → Platform API
 *   B) Server→Canvas: reframe:prop-changed → apply CSS→OP mapping
 *   C) Full graph: MCPClient SSE → StoreSync pull → loadFromReframeGraph
 *
 * ALL UI (layers, properties, constructor) is handled by Platform scripts.ts.
 */

import { createReframeEditor, type ReframeEditorShell } from '../canvas/editor-shell.js';
import { setupCanvasInteraction } from '../canvas/interaction.js';
import { setupFileDragDrop } from './file-handler.js';
import { getContextMenuItems, renderContextMenu, executeContextAction } from './context-menu.js';
import { initAgentPrompt } from './agent-prompt.js';
import { initBlockPalette } from './block-palette.js';
import { MCPClient } from '../sync/mcp-client.js';
import { StoreSync } from '../sync/store-sync.js';
import { computeAllLayouts } from '@open-pencil/core';
import { deserializeToGraph } from '@reframe/core';

let shell: ReframeEditorShell | null = null;
let storeSync: StoreSync | null = null;

// ─── Selection translation helpers ──────────────────────
//
// Canvas interaction surfaces (createReframeEditor's onSelectionChanged
// callback AND setupCanvasInteraction's onSelectionChanged) ALL must
// translate OP-internal node ids to reframe SceneGraph ids before they
// reach scripts.ts / the Properties panel / the server. Without this,
// the panel fetches /api/node/get with an OP-only id and gets 404.
//
// Both dispatchers route through dispatchSelection so the translation
// rule lives in one place.

function translateOpToReframe(opId: string | null | undefined): string | null {
  if (!opId) return null;
  const bridge = (shell as any)?.bridge;
  if (!bridge) return opId;
  const mapped = bridge.opToReframeId?.get?.(opId);
  if (mapped) return mapped;
  // Already a reframe id (because OP overrides.id was preserved via
  // spread in createDefaultNode) — pass through.
  if (bridge.reframeToOpId?.has?.(opId)) return opId;
  // OP-only node (e.g. Page wrapper with no map yet) — return null so
  // the panel shows empty state instead of 404'ing.
  return null;
}

function dispatchSelection(ids: Set<string> | ReadonlySet<string>): void {
  const arr = [...ids];
  const firstId = arr[0] ?? null;
  const translated = firstId ? translateOpToReframe(firstId) : null;
  const translatedAll = arr
    .map((id) => translateOpToReframe(id))
    .filter((x): x is string => !!x);
  window.dispatchEvent(new CustomEvent('reframe:canvas-select', {
    detail: { nodeId: translated, selectedIds: translatedAll },
  }));
}

/**
 * Suppression-aware wrapper around shell.loadFromReframeGraph. Sets a
 * window flag during the rebuild so scripts.ts canvas event handlers
 * skip POSTing every "created" event back to the server (the server
 * already has those nodes; without suppression every load → 404 spam).
 *
 * Used by the initial scene-load + the constructor-composed +
 * variant-open + open-scene flows. StoreSync.pullFromMCP also sets the
 * same flag for SSE-triggered rebuilds.
 */
function loadGraphSuppressed(s: ReframeEditorShell, graph: any, rootId: string): void {
  (window as any).__reframeSyncing = true;
  try {
    s.loadFromReframeGraph(graph, rootId);
  } finally {
    // Hold the flag for 200ms — covers async event bursts that fire
    // on OP's layout pass after createNode completes (size/position
    // events frequently arrive a frame or two later).
    // Wider window: OP layout/text-shaping/font-load deltas can fire
    // 1-2 seconds after the initial createNode pass on an empty scene.
    // First real user pointer event will clear the flag earlier (see
    // pointerdown listener below).
    setTimeout(() => { (window as any).__reframeSyncing = false; }, 2000);
  }
}

// ─── Boot ────────────────────────────────────────────────

export async function initPlatformViewport(): Promise<ReframeEditorShell | null> {
  const canvas = document.getElementById('reframe-viewport') as HTMLCanvasElement | null;
  if (!canvas) return null;

  const container = canvas.parentElement!;
  const sessionId = canvas.dataset.session;
  const projectScenes = canvas.dataset.projectScenes;

  try {
    // 1. Canvas sizing
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;

    new ResizeObserver(() => {
      const w = container.clientWidth * dpr;
      const h = container.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        shell?.editor.requestRender();
      }
    }).observe(container);

    // Wire the AI-native floating prompt: right-click "Ask agent" on a
    // node OR Cmd+K anywhere on the canvas → contextual prompt at the
    // cursor. Selection is automatically scoped, scene id pulled from
    // the canvas data attribute. Idempotent — safe to call once at boot.
    initAgentPrompt();
    // Wire the floating block palette: + button in toolbar, Cmd+P
    // hotkey, or empty-scene wizard auto-opens it in compose mode.
    initBlockPalette();

    // 2. Create editor shell
    shell = await createReframeEditor({
      canvas,
      canvasKitWasmPath: '/platform/vendor/canvaskit/canvaskit.wasm',
      onSelectionChanged: (ids) => {
        dispatchSelection(ids);
      },
      onGraphChanged: () => {
        window.dispatchEvent(new CustomEvent('reframe:graph-changed'));
      },
    });

    try { await (shell.renderer as any).loadFonts(); } catch {}

    // Expose editor for the floating agent prompt — it needs to look
    // up node names to render a friendly scope label. Keeps the prompt
    // module dependency-free of editor internals.
    (window as any).__reframeEditor = shell.editor;
    // Expose bridge so scripts.ts canvas handlers can translate OP ids
    // to reframe ids before POSTing /api/node/edit etc. Without this,
    // every OP-internal node (e.g. wrappers, layout helpers) that emits
    // a "moved" / "resized" event POSTs back to a server that doesn't
    // know it → cascading 404s + ERR_INSUFFICIENT_RESOURCES.
    (window as any).__reframeBridge = shell.bridge;

    // First real user pointer event clears the rebuild-suppression flag.
    // Lets us confidently persist user edits without waiting the full
    // 2s rebuild window. Only trust pointerdown bubbling from the canvas
    // (avoids picking up modal/popover clicks).
    const clearSuppressOnInteract = () => {
      if ((window as any).__reframeSyncing) {
        (window as any).__reframeSyncing = false;
      }
    };
    canvas.addEventListener('pointerdown', clearSuppressOnInteract, { passive: true });

    // 3. Canvas interaction. Selection events go through the same
    // dispatchSelection helper as createReframeEditor's onSelectionChanged
    // so OP→reframe id translation is applied consistently. Context-menu
    // hits also get translated so "Ask agent" carries a reframe id.
    setupCanvasInteraction(canvas, shell.editor, {
      onSelectionChanged: () => {
        const ids = [...shell!.editor.state.selectedIds];
        dispatchSelection(new Set(ids));
      },
      onContextMenu: (x, y, nodeId) => {
        if (!shell) return;
        // getContextMenuItems queries OP editor state — needs OP id.
        // showContextMenu/executeContextAction context fires events that
        // need REFRAME id (Ask agent dispatches reframe:ask-agent which
        // server-side handlers consume). We pass the translated id to
        // the action context only.
        const translatedId = translateOpToReframe(nodeId);
        showContextMenu(x, y, getContextMenuItems(shell.editor, nodeId), translatedId);
      },
    });

    setupFileDragDrop(container, shell);
    shell.startRenderLoop();
    canvas.style.display = 'block';

    // 4. Determine scene IDs
    const sceneIds = projectScenes
      ? projectScenes.split(',').filter(Boolean)
      : sessionId ? [sessionId] : [];

    if (sceneIds.length > 0 && !canvas.dataset.session) {
      canvas.dataset.session = sceneIds[0];
    }

    // 5. Create MCPClient with SSE subscription
    const mcpClient = new MCPClient({
      onSceneChanged: (sceneId, revision) => {
        if (storeSync) storeSync.pullFromMCP(sceneId, revision);
      },
      onConnectionChanged: (connected) => {
        console.log('[reframe] SSE:', connected ? 'connected' : 'disconnected');
      },
    });
    mcpClient.connect();

    // 6. Create StoreSync for bidirectional sync (Channel C)
    storeSync = new StoreSync({ shell, mcpClient, debounceMs: 600 });

    // 7. Initial scene load
    if (sceneIds.length > 0) {
      for (const sid of sceneIds) {
        try {
          const resp = await fetch(`/scenes/${sid}?format=json`);
          if (!resp.ok) continue;
          const json = await resp.json();
          const rfData = deserializeToGraph(json.root || json);
          loadGraphSuppressed(shell, rfData.graph, rfData.rootId);
        } catch (e) {
          console.error('[reframe] Scene', sid, 'load error:', e);
        }
      }

      // Start sync for the active scene
      storeSync.startSync(sceneIds[0]);
    }

    // 8. Wire sync channels
    wireGraphEmitterEvents(shell, storeSync);
    wirePropChangedHandler(shell, storeSync);
    wireSelfCausedRevisionHandler(storeSync);

    // 9. Constructor compose → load new scene into canvas
    window.addEventListener('reframe:constructor-composed', (async (ev: Event) => {
      const sceneId = (ev as CustomEvent).detail?.sceneId;
      if (!sceneId || !shell) return;
      try {
        const resp = await fetch(`/scenes/${sceneId}?format=json`);
        if (!resp.ok) return;
        const json = await resp.json();
        const rfData = deserializeToGraph(json.root || json);
        loadGraphSuppressed(shell, rfData.graph, rfData.rootId);
        // Update session and restart sync
        const cvs = document.getElementById('reframe-viewport');
        if (cvs) (cvs as HTMLElement).dataset.session = sceneId;
        if (storeSync) {
          storeSync.stopSync();
          storeSync.startSync(sceneId);
        }
        // Refresh layers tree
        window.dispatchEvent(new CustomEvent('reframe:graph-changed'));
      } catch (e) {
        console.error('[reframe] Constructor load error:', e);
      }
    }) as EventListener);

    // 9a. Wire the "+" toolbar button → open the floating block palette.
    document.getElementById('btn-block-palette')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('reframe:open-block-palette'));
    });

    // 9c. Empty-scene wizard — if the active scene is empty (no children
    // under the page root), offer the AI compose flow on first paint.
    // Detected after sync starts so the scene tree is populated.
    setTimeout(() => {
      try {
        const ed = (window as any).__reframeEditor;
        if (!ed || !ed.state) return;
        const allNodes = ed.state.nodes ? Object.keys(ed.state.nodes) : [];
        // Heuristic: if scene has only a CANVAS + PAGE (≤ 2 nodes), it's
        // effectively blank → fire the compose wizard.
        if (allNodes.length > 0 && allNodes.length <= 2) {
          window.dispatchEvent(new CustomEvent('reframe:open-empty-wizard'));
        }
      } catch { /* best-effort */ }
    }, 1500);

    // 9b. Variant picker → load chosen scene into canvas. Same pattern
    // as constructor-composed: fetch scene → load into shell → swap
    // data-session → restart sync.
    window.addEventListener('reframe:open-scene', (async (ev: Event) => {
      const sceneId = (ev as CustomEvent).detail?.sceneId;
      if (!sceneId || !shell) return;
      try {
        const resp = await fetch(`/scenes/${sceneId}?format=json`);
        if (!resp.ok) return;
        const json = await resp.json();
        const rfData = deserializeToGraph(json.root || json);
        loadGraphSuppressed(shell, rfData.graph, rfData.rootId);
        const cvs = document.getElementById('reframe-viewport');
        if (cvs) (cvs as HTMLElement).dataset.session = sceneId;
        if (storeSync) {
          storeSync.stopSync();
          storeSync.startSync(sceneId);
        }
        window.dispatchEvent(new CustomEvent('reframe:graph-changed'));
      } catch (e) {
        console.error('[reframe] open-scene load error:', e);
      }
    }) as EventListener);

    // 10. Wire shell UI (toolbar, keyboard, layer-select)
    wireShellUI(shell);

    // Expose for debugging
    (window as any).__reframeEditor = shell.editor;
    (window as any).__reframeShell = shell;

    // Hide loading
    document.querySelector('.mode-banner')?.classList.add('hidden');
    (document.querySelector('.mode-banner') as HTMLElement | null)?.style.setProperty('display', 'none');
    document.getElementById('loading')?.classList.add('hidden');

    console.log('[reframe] CanvasKit viewport active');
    return shell;

  } catch (err) {
    console.error('[reframe] Editor init failed:', err);
    const banner = document.querySelector('.mode-banner') as HTMLElement | null;
    if (banner) {
      banner.textContent = 'Editor failed: ' + (err as Error).message;
      banner.style.display = 'block';
    }
    return null;
  }
}

export function getEditorShell(): ReframeEditorShell | null { return shell; }

// ─── Channel A: OP graph emitter → CustomEvents → scripts.ts → Platform API ──

function wireGraphEmitterEvents(s: ReframeEditorShell, sync: StoreSync) {
  const emitter = s.editor.graph.emitter;

  emitter.on('node:updated', (id: string, changes: Record<string, any>) => {
    if (sync.isPulling) return;
    const node = s.editor.getNode(id);
    if (!node) return;

    if ('x' in changes || 'y' in changes) {
      window.dispatchEvent(new CustomEvent('reframe:node-moved', {
        detail: { nodeId: id, x: node.x, y: node.y },
      }));
    }
    if ('width' in changes || 'height' in changes) {
      window.dispatchEvent(new CustomEvent('reframe:node-resized', {
        detail: { nodeId: id, width: node.width, height: node.height, x: node.x, y: node.y },
      }));
    }
  });

  emitter.on('node:created', (node: any) => {
    if (sync.isPulling) return;
    window.dispatchEvent(new CustomEvent('reframe:node-created', {
      detail: { nodeId: node.id, type: node.type, parentId: node.parentId, name: node.name },
    }));
  });

  emitter.on('node:deleted', (id: string) => {
    if (sync.isPulling) return;
    window.dispatchEvent(new CustomEvent('reframe:node-deleted', {
      detail: { nodeId: id },
    }));
  });

  emitter.on('node:reparented', (nodeId: string, _old: string | null, newParentId: string) => {
    if (sync.isPulling) return;
    window.dispatchEvent(new CustomEvent('reframe:node-reparented', {
      detail: { nodeId, newParentId },
    }));
  });
}

// ─── Channel B: reframe:prop-changed → OP node update ───

function wirePropChangedHandler(s: ReframeEditorShell, sync: StoreSync) {
  window.addEventListener('reframe:prop-changed', ((evt: CustomEvent) => {
    if (sync.isPulling) return;
    const d = evt.detail || {};
    if (!d.nodeId || !s) return;
    const nd = s.editor.getNode(d.nodeId);
    if (!nd) return;

    const p = d.props || {};
    // Support single prop format too
    if (d.prop && d.value !== undefined) p[d.prop] = d.value;

    applyPropsToNode(nd, p);

    try { computeAllLayouts(s.editor.graph); } catch {}
    s.editor.requestRender();
  }) as EventListener);
}

/** Map CSS-named props (from Platform API) to OP SceneNode fields. */
function applyPropsToNode(nd: any, p: Record<string, any>): void {
  // Geometry
  if (p.width != null) nd.width = Number(p.width);
  if (p.height != null) nd.height = Number(p.height);
  if (p.x != null) nd.x = Number(p.x);
  if (p.y != null) nd.y = Number(p.y);
  if (p.rotation != null) nd.rotation = Number(p.rotation);
  if (p.opacity != null) nd.opacity = Number(p.opacity);
  if (p.visible != null) nd.visible = p.visible !== false && p.visible !== 'false';

  // Corner radius
  if (p['border-radius'] != null) nd.cornerRadius = Number(p['border-radius']);
  if (p['radius-tl'] != null) { nd.topLeftRadius = Number(p['radius-tl']); nd.independentCorners = true; }
  if (p['radius-tr'] != null) { nd.topRightRadius = Number(p['radius-tr']); nd.independentCorners = true; }
  if (p['radius-br'] != null) { nd.bottomRightRadius = Number(p['radius-br']); nd.independentCorners = true; }
  if (p['radius-bl'] != null) { nd.bottomLeftRadius = Number(p['radius-bl']); nd.independentCorners = true; }
  if (p['corner-smoothing'] != null) nd.cornerSmoothing = Number(p['corner-smoothing']);

  // Layout
  if (p.display === 'flex-row') nd.layoutMode = 'HORIZONTAL';
  else if (p.display === 'flex-col') nd.layoutMode = 'VERTICAL';
  else if (p.display === 'none-layout') nd.layoutMode = 'NONE';
  if (p.gap != null) nd.itemSpacing = Number(p.gap);
  if (p['padding-top'] != null) nd.paddingTop = Number(p['padding-top']);
  if (p['padding-right'] != null) nd.paddingRight = Number(p['padding-right']);
  if (p['padding-bottom'] != null) nd.paddingBottom = Number(p['padding-bottom']);
  if (p['padding-left'] != null) nd.paddingLeft = Number(p['padding-left']);
  if (p['justify-content']) {
    const m: Record<string, string> = { 'flex-start': 'MIN', center: 'CENTER', 'flex-end': 'MAX', 'space-between': 'SPACE_BETWEEN' };
    if (m[p['justify-content']]) nd.primaryAxisAlign = m[p['justify-content']];
  }
  if (p['align-items']) {
    const m: Record<string, string> = { 'flex-start': 'MIN', center: 'CENTER', 'flex-end': 'MAX', stretch: 'STRETCH' };
    if (m[p['align-items']]) nd.counterAxisAlign = m[p['align-items']];
  }
  if (p['main-sizing']) nd.primaryAxisSizing = p['main-sizing'];
  if (p['cross-sizing']) nd.counterAxisSizing = p['cross-sizing'];

  // Constraints
  if (p['min-width'] != null) nd.minWidth = Number(p['min-width']);
  if (p['max-width'] != null) nd.maxWidth = Number(p['max-width']);
  if (p['min-height'] != null) nd.minHeight = Number(p['min-height']);
  if (p['max-height'] != null) nd.maxHeight = Number(p['max-height']);
  if (p['clips-content'] != null) nd.clipsContent = !!p['clips-content'];

  // Typography
  if (p['font-size'] != null) nd.fontSize = Number(p['font-size']);
  if (p['font-weight'] != null) nd.fontWeight = Number(p['font-weight']);
  if (p['font-family']) nd.fontFamily = String(p['font-family']);
  if (p['line-height'] != null) nd.lineHeight = Number(p['line-height']);
  if (p['letter-spacing'] != null) nd.letterSpacing = Number(p['letter-spacing']);
  if (p['text-align']) {
    const m: Record<string, string> = { left: 'LEFT', center: 'CENTER', right: 'RIGHT', justify: 'JUSTIFIED' };
    if (m[p['text-align']]) nd.textAlignHorizontal = m[p['text-align']];
  }
  if (p['text-content'] != null) nd.text = String(p['text-content']);

  // Fill (background color)
  if (p.background) {
    const c = hexToRGBA(String(p.background));
    if (c) nd.fills = [{ type: 'SOLID', color: c, visible: true, opacity: p['background-opacity'] != null ? Number(p['background-opacity']) : 1 }];
  }
  // Text color
  if (p.color && nd.type === 'TEXT') {
    const c = hexToRGBA(String(p.color));
    if (c) nd.fills = [{ type: 'SOLID', color: c, visible: true, opacity: 1 }];
  }

  // Stroke
  if (p['border-color']) {
    const c = hexToRGBA(String(p['border-color']));
    if (c) {
      if (nd.strokes?.length > 0) { nd.strokes[0].color = c; }
      else { nd.strokes = [{ type: 'SOLID', color: c, visible: true, weight: nd.strokeWeight || 1, align: 'INSIDE' }]; }
    }
  }
  if (p['stroke-weight'] != null) {
    const w = Number(p['stroke-weight']);
    if (nd.strokes?.length > 0) nd.strokes[0].weight = w;
  }

  // Grid
  if (p['grid-col-gap'] != null) nd.gridColumnGap = Number(p['grid-col-gap']);
  if (p['grid-row-gap'] != null) nd.gridRowGap = Number(p['grid-row-gap']);
}

function hexToRGBA(hex: string): { r: number; g: number; b: number; a: number } | null {
  const h = hex.replace('#', '');
  if (h.length !== 6 && h.length !== 3) return null;
  const full = h.length === 3 ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2] : h;
  return {
    r: parseInt(full.slice(0,2),16)/255,
    g: parseInt(full.slice(2,4),16)/255,
    b: parseInt(full.slice(4,6),16)/255,
    a: 1,
  };
}

// ─── Echo suppression bridge ────────────────────────────

function wireSelfCausedRevisionHandler(sync: StoreSync) {
  window.addEventListener('reframe:self-caused-revision', ((evt: CustomEvent) => {
    const rev = evt.detail?.revision;
    if (rev != null) sync.suppressNextPull(rev);
  }) as EventListener);
}

// ─── Context menu ────────────────────────────────────────

function showContextMenu(x: number, y: number, items: ReturnType<typeof getContextMenuItems>, nodeId: string | null = null) {
  document.getElementById('reframe-context-menu')?.remove();

  const div = document.createElement('div');
  div.id = 'reframe-context-menu';
  div.innerHTML = renderContextMenu(x, y, items);
  document.body.appendChild(div);

  div.querySelectorAll<HTMLElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      // Pass click coords + node id so context-aware actions (ask-agent)
      // can anchor floating UI at the right spot and scope to the node.
      if (shell) executeContextAction(btn.dataset.action!, shell.editor, { x, y, nodeId });
      div.remove();
    });
  });

  const dismiss = (e: PointerEvent) => {
    if (!div.contains(e.target as Node)) {
      div.remove();
      document.removeEventListener('pointerdown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', dismiss), 0);
}

// ─── Shell UI (canvas-only layer) ────────────────────────

function wireShellUI(s: ReframeEditorShell) {
  const editor = s.editor;

  // Tool buttons (floating toolbar)
  document.querySelectorAll<HTMLElement>('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool!;
      (editor.state as any).activeTool = tool;
      document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Undo/redo buttons
  document.getElementById('btn-undo')?.addEventListener('click', () => {
    editor.undoAction(); editor.requestRender();
  });
  document.getElementById('btn-redo')?.addEventListener('click', () => {
    editor.redoAction(); editor.requestRender();
  });

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    try { localStorage.setItem('reframe-theme', next); } catch {}
  });

  // Canvas keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const toolMap: Record<string, string> = {
      v: 'SELECT', f: 'FRAME', r: 'RECTANGLE',
      o: 'ELLIPSE', t: 'TEXT', p: 'PEN', h: 'HAND',
    };
    const tool = toolMap[e.key.toLowerCase()];
    if (tool && !e.ctrlKey && !e.metaKey) {
      (editor.state as any).activeTool = tool;
      document.querySelectorAll('[data-tool]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-tool') === tool);
      });
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) editor.redoAction(); else editor.undoAction();
      editor.requestRender();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.state.selectedIds.size > 0) { editor.deleteSelected(); editor.requestRender(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); editor.selectAll(); editor.requestRender(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); editor.duplicateSelected(); editor.requestRender(); }
    if (e.key === '0' && !e.ctrlKey) { editor.zoomToFit(); editor.requestRender(); }
    if (e.key === '1' && !e.ctrlKey) { editor.zoomTo100(); editor.requestRender(); }
  });

  // Bridge: layers panel click → OP canvas selection
  window.addEventListener('reframe:layer-select', ((evt: CustomEvent) => {
    const nodeId = evt.detail?.nodeId;
    if (nodeId) { editor.select([nodeId]); editor.requestRender(); }
  }) as EventListener);
}
