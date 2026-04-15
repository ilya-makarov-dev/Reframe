/**
 * Platform Bootstrap — initializes the CanvasKit interactive viewport.
 *
 * Loaded as a <script type="module"> on platform pages.
 * Detects #reframe-viewport canvas, creates ReframeEditorShell,
 * fetches scene data from MCP, and hydrates via GraphBridge.
 */

import { createReframeEditor, type ReframeEditorShell } from '../canvas/editor-shell.js';
import { setupCanvasInteraction } from '../canvas/interaction.js';
import { setupFileDragDrop } from './file-handler.js';
import { getContextMenuItems, renderContextMenu, executeContextAction } from './context-menu.js';
import { renderPropertiesPanel } from '../panels/properties.js';
import { renderDesignSystemPanel } from '../panels/design-system.js';
import { renderBlocksPanel } from '../panels/blocks.js';
import { MCPClient } from '../sync/mcp-client.js';
import { computeAllLayouts } from '@open-pencil/core';
import { deserializeToGraph } from '@reframe/core';

let shell: ReframeEditorShell | null = null;

/**
 * Initialize the interactive viewport on the platform page.
 * Call this after the page DOM is ready.
 */
export async function initPlatformViewport(): Promise<ReframeEditorShell | null> {
  const canvas = document.getElementById('reframe-viewport') as HTMLCanvasElement | null;
  if (!canvas) return null;

  const container = canvas.parentElement!;
  const sessionId = canvas.dataset.session;
  const projectScenes = canvas.dataset.projectScenes;

  try {
    // 1. Set canvas buffer size BEFORE creating WebGL surface
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    console.log('[reframe] Canvas sized:', canvas.width, 'x', canvas.height, 'dpr:', dpr);

    // Handle resize
    new ResizeObserver(() => {
      const w = container.clientWidth * dpr;
      const h = container.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        shell?.editor.requestRender();
      }
    }).observe(container);

    // 2. Create editor shell (MakeWebGLCanvasSurface binds to current canvas size)
    shell = await createReframeEditor({
      canvas,
      canvasKitWasmPath: '/platform/vendor/canvaskit/canvaskit.wasm',
      onSelectionChanged: (ids) => {
        window.dispatchEvent(new CustomEvent('reframe:selection', {
          detail: { selectedIds: [...ids] },
        }));
      },
      onGraphChanged: () => {
        window.dispatchEvent(new CustomEvent('reframe:graph-changed'));
      },
    });
    console.log('[reframe] Editor shell created');

    // 2b. Load fonts for text rendering
    try {
      await (shell.renderer as any).loadFonts();
      console.log('[reframe] Fonts loaded');
    } catch (e) {
      console.warn('[reframe] Font load failed:', e);
    }

    // 3. Wire canvas interaction
    setupCanvasInteraction(canvas, shell.editor, {
      onSelectionChanged: () => {
        window.dispatchEvent(new CustomEvent('reframe:selection', {
          detail: { selectedIds: [...shell!.editor.state.selectedIds] },
        }));
      },
      onContextMenu: (x, y, nodeId) => {
        if (!shell) return;
        const items = getContextMenuItems(shell.editor, nodeId);
        showContextMenu(x, y, items);
      },
    });

    // 4. Wire file drag & drop
    setupFileDragDrop(container, shell);

    // 5. Start render loop
    shell.startRenderLoop();
    canvas.style.display = 'block';

    // 6. Load scene(s) from MCP — use GraphBridge for proper hydration
    const sceneIds = projectScenes
      ? projectScenes.split(',').filter(Boolean)
      : sessionId ? [sessionId] : [];

    console.log('[reframe] Loading scenes:', sceneIds);

    if (sceneIds.length > 0) {
      const mcpClient = new MCPClient();

      for (const sid of sceneIds) {
        try {
          // Fetch serialized scene from MCP
          const resp = await fetch(`/scenes/${sid}?format=json`);
          if (!resp.ok) { console.warn('[reframe] Scene fetch failed:', sid, resp.status); continue; }
          const json = await resp.json();
          console.log('[reframe] Scene', sid, 'fetched, format:', json.root ? 'tree' : 'flat');

          // Deserialize into a reframe SceneGraph
          const rfData = deserializeToGraph(json.root || json);
          console.log('[reframe] Deserialized:', rfData.rootId);

          // Load into viewport via GraphBridge
          shell.loadFromReframeGraph(rfData.graph, rfData.rootId);
          console.log('[reframe] Scene loaded via GraphBridge');
        } catch (e) {
          console.error('[reframe] Scene', sid, 'load error:', e);
        }
      }
    }

    // Expose for debugging
    (window as any).__reframeEditor = shell.editor;
    (window as any).__reframeShell = shell;

    // Hide all loading indicators
    document.querySelector('.mode-banner')?.classList.add('hidden');
    (document.querySelector('.mode-banner') as HTMLElement | null)?.style.setProperty('display', 'none');
    document.getElementById('loading')?.classList.add('hidden');

    // 8. Wire shell UI — toolbar, panels, keyboard shortcuts
    wireShellUI(shell);

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

/** Get the editor shell (for external panel code). */
export function getEditorShell(): ReframeEditorShell | null {
  return shell;
}

// ── Context menu helper ──

function showContextMenu(x: number, y: number, items: ReturnType<typeof getContextMenuItems>) {
  document.getElementById('reframe-context-menu')?.remove();

  const div = document.createElement('div');
  div.id = 'reframe-context-menu';
  div.innerHTML = renderContextMenu(x, y, items);
  document.body.appendChild(div);

  div.querySelectorAll<HTMLElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (shell) {
        executeContextAction(btn.dataset.action!, shell.editor);
      }
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

// ── Wire shell UI elements ──

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
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    try { localStorage.setItem('reframe-theme', next); } catch {}
  });

  // Panel tabs — Design ↔ Constructor toggle
  let activePanel = 'design';
  const panelTabs = document.querySelectorAll<HTMLElement>('[data-panel]');

  function switchPanel(name: string) {
    activePanel = name;
    panelTabs.forEach(t => t.classList.toggle('active', t.dataset.panel === name));
    refreshPanel();
  }

  panelTabs.forEach(tab => {
    tab.addEventListener('click', () => switchPanel(tab.dataset.panel!));
  });

  // Keyboard: Tab key toggles between Design ↔ Constructor
  // (only when canvas is focused, not in text inputs)
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (e.key === ',' || e.key === '<') {
      e.preventDefault();
      switchPanel(activePanel === 'design' ? 'constructor' : 'design');
    }
    if (e.key === '.' || e.key === '>') {
      e.preventDefault();
      switchPanel(activePanel === 'design' ? 'constructor' : 'design');
    }
  });

  // Keyboard shortcuts for tools
  document.addEventListener('keydown', (e) => {
    // Don't handle if typing in an input
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

    const map: Record<string, string> = {
      'v': 'SELECT', 'f': 'FRAME', 'r': 'RECTANGLE',
      'o': 'ELLIPSE', 't': 'TEXT', 'p': 'PEN', 'h': 'HAND',
    };
    const tool = map[e.key.toLowerCase()];
    if (tool) {
      (editor.state as any).activeTool = tool;
      document.querySelectorAll('[data-tool]').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-tool') === tool);
      });
      return;
    }

    // Undo/redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) { editor.redoAction(); } else { editor.undoAction(); }
      editor.requestRender();
    }

    // Delete
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editor.state.selectedIds.size > 0) {
        editor.deleteSelected();
        editor.requestRender();
      }
    }

    // Select all
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      editor.selectAll();
      editor.requestRender();
    }

    // Duplicate
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      editor.duplicateSelected();
      editor.requestRender();
    }

    // Zoom
    if (e.key === '0' && !e.ctrlKey) { editor.zoomToFit(); editor.requestRender(); }
    if (e.key === '1' && !e.ctrlKey) { editor.zoomTo100(); editor.requestRender(); }
  });

  // Export button
  document.getElementById('btn-export')?.addEventListener('click', () => {
    // TODO: open export dialog
    console.log('[reframe] Export requested');
  });

  // Audit button
  document.getElementById('btn-audit')?.addEventListener('click', () => {
    // TODO: run audit and show in panel
    console.log('[reframe] Audit requested');
  });

  // ── Layers tree ──
  function refreshLayers() {
    const tree = document.getElementById('layer-tree');
    if (!tree) return;
    const pageId = editor.state.currentPageId;
    if (!pageId) { tree.innerHTML = ''; return; }

    const html: string[] = [];
    const walk = (nodeId: string, depth: number) => {
      const node = editor.graph.getNode(nodeId);
      if (!node) return;
      const isPage = depth === 0;
      if (isPage) {
        // Skip page node itself, render children
        for (const child of editor.graph.getChildren(nodeId)) walk(child.id, depth + 1);
        return;
      }
      const selected = editor.state.selectedIds.has(nodeId);
      const indent = (depth - 1) * 16;
      const hasChildren = (node.childIds || []).length > 0;
      const icon = node.type === 'TEXT' ? 'T' : hasChildren ? '\u25BC' : '\u25A0';
      html.push(`<div data-layer-id="${node.id}" style="
        padding: 4px 8px 4px ${8 + indent}px;
        font-size: 11px;
        color: ${selected ? 'var(--accent)' : 'var(--text-secondary)'};
        background: ${selected ? 'rgba(var(--glass-ink), 0.06)' : 'transparent'};
        cursor: pointer;
        border-radius: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span style="font-size:9px;opacity:0.5;width:12px;text-align:center">${icon}</span>
        <span>${node.name || node.type}</span>
      </div>`);
      for (const child of editor.graph.getChildren(nodeId)) walk(child.id, depth + 1);
    };
    walk(pageId, 0);
    tree.innerHTML = html.join('');

    // Click to select
    tree.querySelectorAll<HTMLElement>('[data-layer-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.layerId!;
        editor.select([id]);
        editor.requestRender();
        refreshLayers();
        refreshPanel();
      });
    });
  }

  // ── Panel content ──
  function refreshPanel() {
    const content = document.getElementById('panel-content');
    if (!content) return;

    if (activePanel === 'design') {
      // Design = Figma-style property editor for selected node
      const ids = [...editor.state.selectedIds];
      if (ids.length === 0) {
        content.innerHTML = `<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:40px 10px;">
          Select a node to edit its properties
        </div>`;
        return;
      }
      const node = editor.graph.getNode(ids[0]);
      if (!node) return;
      const ext = s.bridge.extensions.get(ids[0]) || null;
      content.innerHTML = renderPropertiesPanel({ node, extension: ext });
    } else if (activePanel === 'constructor') {
      // Constructor = Block library + brand/semantic tools
      content.innerHTML = renderBlocksPanel() +
        `<div style="border-top:1px solid var(--border);margin-top:12px;padding-top:12px;">` +
        renderDesignSystemPanel({
          activeBrand: null,
          mode: 'light',
          tokenCount: 0,
          colorTokens: [],
          typographyTokens: [],
          availableBrands: [],
        }) + `</div>`;
    }
  }

  // Update on selection change
  window.addEventListener('reframe:selection', (() => {
    refreshLayers();
    refreshPanel();
  }) as EventListener);

  // Initial render
  setTimeout(() => { refreshLayers(); refreshPanel(); }, 100);
}
