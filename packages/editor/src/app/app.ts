/**
 * Editor App — client-side entry point.
 *
 * Boots CanvasKit, creates the editor shell, connects to MCP via SSE,
 * wires toolbar, panels, canvas interaction, file handling, and keyboard shortcuts.
 */

import { createReframeEditor, type ReframeEditorShell } from '../canvas/editor-shell.js';
import { setupCanvasInteraction } from '../canvas/interaction.js';
import { MCPClient } from '../sync/mcp-client.js';
import { StoreSync } from '../sync/store-sync.js';
import { renderPropertiesPanel } from '../panels/properties.js';
import { renderBlocksPanel } from '../panels/blocks.js';
import { renderAIChatPanel, type AIChatMessage } from '../panels/ai-chat.js';
import { renderExportPanel } from '../panels/export.js';
import { renderDesignSystemPanel } from '../panels/design-system.js';
import { renderAuditPanel } from '../panels/audit.js';
import { setupFileDragDrop, openFileDialog } from './file-handler.js';
import { getContextMenuItems, renderContextMenu, executeContextAction } from './context-menu.js';
import type { AuditIssueOverlay } from '../canvas/audit-overlay.js';
import type { ReframeExtension } from '../bridge/node-bridge.js';

// ─── State ──────────────────────────────────────────────────

let shell: ReframeEditorShell | null = null;
let mcpClient: MCPClient | null = null;
let storeSync: StoreSync | null = null;
let activePanel = 'properties';
let auditIssues: AuditIssueOverlay[] = [];
let aiMessages: AIChatMessage[] = [];
let isAIGenerating = false;
let cleanupInteraction: (() => void) | null = null;
let cleanupFileDrop: (() => void) | null = null;

// ─── Boot ───────────────────────────────────────────────────

async function boot() {
  const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
  const loading = document.getElementById('loading');
  const canvasArea = document.getElementById('canvas-area');
  if (!canvas || !canvasArea) return;

  setStatus('Loading CanvasKit...', false);

  try {
    // 1. Create editor shell (CanvasKit + SkiaRenderer)
    shell = await createReframeEditor({
      canvas,
      onGraphChanged: () => {
        updateLayerTree();
      },
      onSelectionChanged: (ids) => {
        updatePropertiesPanel();
        updateLayerTree();
        const count = ids.size;
        setStatus(
          count === 0 ? 'Ready' : `${count} node${count > 1 ? 's' : ''} selected`,
          true,
        );
      },
    });

    // 2. Handle canvas resize
    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvasArea.clientWidth * dpr;
      canvas.height = canvasArea.clientHeight * dpr;
      canvas.style.width = canvasArea.clientWidth + 'px';
      canvas.style.height = canvasArea.clientHeight + 'px';
      shell?.editor.requestRender();
    };
    new ResizeObserver(resizeCanvas).observe(canvasArea);
    resizeCanvas();

    // 3. Wire canvas interaction (drag, marquee, shape creation, snap, context menu)
    cleanupInteraction = setupCanvasInteraction(canvas, shell.editor, {
      onSelectionChanged: () => {
        updatePropertiesPanel();
        updateLayerTree();
      },
      onGraphChanged: () => {
        updateLayerTree();
      },
      onLayerTreeChanged: () => {
        updateLayerTree();
      },
      onContextMenu: showContextMenu,
    });

    // 4. Wire file drag & drop
    cleanupFileDrop = setupFileDragDrop(canvasArea, shell, {
      onFileLoading: (name) => setStatus(`Loading ${name}...`, true),
      onFileLoaded: (name, count) => {
        setStatus(`Loaded ${name} (${count} nodes)`, true);
        updateLayerTree(); updateZoomLevel(); hideEmptyState();
      },
      onFileError: (name, err) => setStatus(`Error: ${name} — ${err}`, true),
    });

    // 5. Start render loop
    shell.startRenderLoop();

    // 6. Hide loading overlay
    loading?.classList.add('hidden');

    // 7. Connect to MCP server
    setupMCPConnection();

    // 8. Load scene from URL or show empty state
    const slug = getSlugFromURL();
    if (slug) {
      setStatus(`Loading ${slug}...`, true);
      await loadSceneFromMCP(slug);
      hideEmptyState();
    } else {
      // No scene — show empty state
      const emptyEl = document.getElementById('empty-state');
      if (emptyEl) emptyEl.style.display = 'flex';
    }

    setStatus('Ready', true);
  } catch (err) {
    console.error('[reframe] Boot failed:', err);
    setStatus(`Error: ${err}`, false);
  }

  // 9. Wire UI interactions
  setupToolbar();
  setupPanelTabs();
  setupKeyboard();
  setupHeaderActions();
  setupAIInput();
  setupEmptyStateButtons();

  // 10. Dismiss context menu on click elsewhere
  document.addEventListener('pointerdown', dismissContextMenu);
}

// ─── Context Menu ───────────────────────────────────────────

function showContextMenu(x: number, y: number, nodeId: string | null) {
  if (!shell) return;
  dismissContextMenu();

  const items = getContextMenuItems(shell.editor, nodeId);
  const html = renderContextMenu(x, y, items);

  const div = document.createElement('div');
  div.id = 'context-menu-wrapper';
  div.innerHTML = html;
  document.body.appendChild(div);

  // Wire actions
  div.querySelectorAll<HTMLElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action && shell) {
        executeContextAction(action, shell.editor);
        updateLayerTree();
        updatePropertiesPanel();
      }
      dismissContextMenu();
    });
  });
}

function dismissContextMenu() {
  document.getElementById('context-menu-wrapper')?.remove();
}

// ─── Toolbar ────────────────────────────────────────────────

function setupToolbar() {
  document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!shell) return;
      setActiveTool(btn.dataset.tool ?? 'SELECT');
    });
  });
}

function setActiveTool(tool: string) {
  if (!shell) return;
  shell.editor.setTool(tool as any);

  document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });

  const canvas = document.getElementById('viewport');
  if (canvas) {
    canvas.style.cursor = tool === 'HAND' ? 'grab'
      : tool === 'TEXT' ? 'text'
      : tool === 'PEN' ? 'crosshair'
      : ['FRAME', 'RECTANGLE', 'ELLIPSE'].includes(tool) ? 'crosshair'
      : 'default';
  }
}

// ─── Panel Tabs ─────────────────────────────────────────────

function setupPanelTabs() {
  document.querySelectorAll<HTMLButtonElement>('.panel-tab[data-panel]').forEach(tab => {
    tab.addEventListener('click', () => {
      switchPanel(tab.dataset.panel ?? 'properties');
    });
  });
}

function switchPanel(panel: string) {
  activePanel = panel;
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-panel="${panel}"]`)?.classList.add('active');
  updatePanelContent();
}

function updatePanelContent() {
  const container = document.getElementById('panel-content');
  if (!container) return;

  switch (activePanel) {
    case 'properties':
      updatePropertiesPanel();
      break;
    case 'blocks':
      container.innerHTML = renderBlocksPanel();
      setupBlocksClickHandlers(container);
      break;
    case 'ai':
      container.innerHTML = renderAIChatPanel({
        messages: aiMessages,
        isGenerating: isAIGenerating,
        currentPrompt: '',
      });
      setupAIChatClickHandlers(container);
      break;
    case 'design':
      container.innerHTML = renderDesignSystemPanel({
        activeBrand: null,
        mode: 'light',
        tokenCount: 0,
        colorTokens: [],
        typographyTokens: [],
        availableBrands: [],
      });
      break;
    case 'audit':
      container.innerHTML = renderAuditPanel({
        issues: auditIssues,
        aestheticScore: null,
        brandFidelity: null,
        canAutoFix: auditIssues.length > 0,
      });
      setupAuditClickHandlers(container);
      break;
    case 'export':
      container.innerHTML = renderExportPanel({
        sceneName: shell?.editor.state.documentName,
      });
      setupExportClickHandlers(container);
      break;
  }
}

function updatePropertiesPanel() {
  if (activePanel !== 'properties') return;
  const container = document.getElementById('panel-content');
  if (!container || !shell) return;

  const selected = shell.editor.getSelectedNode();
  const ext: ReframeExtension | null = selected
    ? shell.bridge.extensions.get(selected.id) ?? null
    : null;

  container.innerHTML = renderPropertiesPanel({
    node: selected ?? null,
    extension: ext,
  });
}

// ─── Layer Tree ─────────────────────────────────────────────

function updateLayerTree() {
  const treeEl = document.getElementById('layer-tree');
  if (!treeEl || !shell) return;

  const tree = shell.editor.getLayerTree();
  const selectedIds = shell.editor.state.selectedIds;

  let html = '';
  for (const { node, depth } of tree) {
    const isSelected = selectedIds.has(node.id);
    const indent = depth * 16;
    const icon = node.type === 'TEXT' ? 'T'
      : node.type === 'FRAME' ? '#'
      : node.type === 'GROUP' ? 'G'
      : node.type === 'COMPONENT' ? '\u25C7'
      : node.type === 'INSTANCE' ? '\u25C8'
      : node.type === 'ELLIPSE' ? 'O'
      : node.type === 'SECTION' ? '\u00A7'
      : '\u25A0';

    html += `<div data-node-id="${node.id}" style="
      display:flex;align-items:center;gap:6px;
      padding:3px 8px 3px ${indent + 8}px;
      font-size:11px;cursor:pointer;border-radius:4px;
      background:${isSelected ? 'var(--accent)' : 'transparent'};
      color:${isSelected ? '#fff' : node.visible ? 'var(--text-2)' : 'var(--text-3)'};
      opacity:${node.visible ? 1 : 0.4};
    " class="layer-row">
      <span style="color:${isSelected ? '#fff' : 'var(--text-3)'};font-size:10px;width:12px;text-align:center;">${icon}</span>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escHtml(node.name)}</span>
      ${node.locked ? '<span style="font-size:9px;color:var(--text-3);">\uD83D\uDD12</span>' : ''}
    </div>`;
  }

  treeEl.innerHTML = html;

  // Click to select
  treeEl.querySelectorAll<HTMLElement>('.layer-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const nodeId = row.dataset.nodeId;
      if (nodeId && shell) {
        shell.editor.select([nodeId], e.shiftKey);
        shell.editor.requestRender();
        updatePropertiesPanel();
      }
    });
  });
}

// ─── Audit Click Handlers ───────────────────────────────────

function setupAuditClickHandlers(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-action="select-node"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nodeId = btn.dataset.nodeId;
      if (nodeId && shell) {
        shell.editor.select([nodeId]);
        shell.editor.zoomToSelection();
        shell.editor.requestRender();
        switchPanel('properties');
      }
    });
  });

  container.querySelector('[data-action="auto-fix"]')?.addEventListener('click', () => {
    setStatus('Running auto-fix...', true);
    // TODO: run reframe auto-fix pipeline via MCP
  });
}

// ─── Export Click Handlers ──────────────────────────────────

function setupExportClickHandlers(container: HTMLElement) {
  container.querySelectorAll<HTMLElement>('[data-export-format]').forEach(btn => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.exportFormat;
      if (format) {
        setStatus(`Exporting ${format}...`, true);
        // TODO: call reframe export via bridge → reframe exporter
      }
    });
  });
}

// ─── Blocks Click Handlers ──────────────────────────────────

function setupBlocksClickHandlers(container: HTMLElement) {
  // Block add buttons
  container.querySelectorAll<HTMLElement>('[data-add-block]').forEach(btn => {
    btn.addEventListener('click', () => {
      const blockName = btn.dataset.addBlock;
      if (blockName) {
        setStatus(`Adding ${blockName}...`, true);
        // Compose via MCP: reframe_project compose_page
        mcpClient?.pushScene('compose', {
          graph: {},
          rootId: '',
          name: blockName,
        }).then(() => {
          setStatus(`Added ${blockName}`, true);
          hideEmptyState();
        });
      }
    });
  });

  // Block search
  container.querySelector('#block-search')?.addEventListener('input', (e) => {
    const filter = (e.target as HTMLInputElement).value;
    container.innerHTML = renderBlocksPanel({ filter });
    setupBlocksClickHandlers(container);
  });
}

// ─── AI Chat Click Handlers ─────────────────────────────────

function setupAIChatClickHandlers(container: HTMLElement) {
  // Quick actions
  container.querySelectorAll<HTMLElement>('[data-ai-quick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.aiQuick;
      const prompts: Record<string, string> = {
        'build-landing': 'Build a modern SaaS landing page with hero, features, pricing, and footer',
        'build-dashboard': 'Design a dark analytics dashboard with sidebar, stats cards, and data table',
        'build-product': 'Create a product showcase page with gallery, specs, reviews, and CTA',
        'rebrand': 'Rebrand the current design to a different style',
      };
      const prompt = prompts[action ?? ''] ?? action;
      if (prompt) sendAIPrompt(prompt);
    });
  });

  // Load scene buttons
  container.querySelectorAll<HTMLElement>('[data-load-scene]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sceneId = btn.dataset.loadScene;
      if (sceneId) loadSceneFromMCP(sceneId);
    });
  });
}

function sendAIPrompt(prompt: string) {
  if (!prompt.trim()) return;

  // Add user message
  aiMessages.push({
    role: 'user',
    content: prompt,
    timestamp: Date.now(),
  });
  isAIGenerating = true;
  updatePanelContent();

  // Clear input
  const input = document.getElementById('ai-input') as HTMLInputElement;
  if (input) input.value = '';

  setStatus('AI generating...', true);

  // Send to MCP via fetch (reframe_compile or similar)
  // For now, add a placeholder assistant response
  setTimeout(() => {
    aiMessages.push({
      role: 'assistant',
      content: `Working on: "${prompt}". Use MCP tools to generate the design.`,
      timestamp: Date.now(),
      status: 'done',
    });
    isAIGenerating = false;
    updatePanelContent();
    setStatus('Ready', true);
  }, 500);
}

// ─── AI Input (bottom bar) ──────────────────────────────────

function setupAIInput() {
  const input = document.getElementById('ai-input') as HTMLInputElement | null;
  if (!input) return;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const prompt = input.value.trim();
      if (prompt) {
        sendAIPrompt(prompt);
        switchPanel('ai');
      }
    }
  });
}

// ─── Empty State Buttons ────────────────────────────────────

function setupEmptyStateButtons() {
  document.getElementById('btn-empty-open')?.addEventListener('click', () => {
    if (shell) openFileDialog(shell, {
      onFileLoading: (name) => setStatus(`Loading ${name}...`, true),
      onFileLoaded: (name, count) => {
        setStatus(`Loaded ${name} (${count} nodes)`, true);
        updateLayerTree(); updateZoomLevel(); hideEmptyState();
      },
      onFileError: (_, err) => setStatus(`Error: ${err}`, true),
    });
  });

  document.getElementById('btn-empty-blocks')?.addEventListener('click', () => {
    switchPanel('blocks');
  });

  document.getElementById('btn-empty-ai')?.addEventListener('click', () => {
    switchPanel('ai');
    document.getElementById('ai-input')?.focus();
  });
}

// ─── Header Actions ─────────────────────────────────────────

function setupHeaderActions() {
  document.getElementById('btn-open')?.addEventListener('click', () => {
    if (shell) openFileDialog(shell, {
      onFileLoading: (name) => setStatus(`Loading ${name}...`, true),
      onFileLoaded: (name, count) => {
        setStatus(`Loaded ${name} (${count} nodes)`, true);
        updateLayerTree(); updateZoomLevel();
      },
      onFileError: (name, err) => setStatus(`Error: ${err}`, true),
    });
  });
  document.getElementById('btn-audit')?.addEventListener('click', () => switchPanel('audit'));
  document.getElementById('btn-export')?.addEventListener('click', () => switchPanel('export'));
  document.getElementById('btn-brand')?.addEventListener('click', () => switchPanel('design'));
}

// ─── MCP Connection ─────────────────────────────────────────

function setupMCPConnection() {
  mcpClient = new MCPClient({
    onSceneChanged: (sceneId) => {
      if (storeSync) storeSync.pullFromMCP(sceneId);
    },
    onConnectionChanged: (connected) => {
      const dot = document.getElementById('mcp-dot');
      if (dot) dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    },
  });
  mcpClient.connect();

  if (shell) {
    storeSync = new StoreSync({ shell, mcpClient, debounceMs: 500 });

    // Start syncing if a scene is loaded from URL
    const slug = getSlugFromURL();
    if (slug) {
      storeSync.startSync(slug);
    }
  }
}

async function loadSceneFromMCP(idOrSlug: string) {
  if (!mcpClient || !shell) return;
  try {
    const data = await mcpClient.fetchScene(idOrSlug);
    if (data) {
      setStatus(`Loaded: ${idOrSlug}`, true);
      updateLayerTree(); updateZoomLevel(); hideEmptyState();
    }
  } catch (err) {
    console.error('[reframe] Failed to load scene:', err);
    setStatus(`Failed: ${idOrSlug}`, true);
  }
}

// ─── Keyboard Shortcuts ─────────────────────────────────────

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (!shell) return;
    const editor = shell.editor;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const mod = e.metaKey || e.ctrlKey;

    // Tool shortcuts (no modifier)
    if (!mod && !e.shiftKey) {
      const toolMap: Record<string, string> = {
        v: 'SELECT', f: 'FRAME', r: 'RECTANGLE', o: 'ELLIPSE',
        t: 'TEXT', p: 'PEN', h: 'HAND',
      };
      if (toolMap[e.key.toLowerCase()]) {
        setActiveTool(toolMap[e.key.toLowerCase()]);
        return;
      }
      if (e.key === 'Escape') {
        editor.clearSelection();
        editor.exitContainer();
        editor.requestRender();
        dismissContextMenu();
        updatePropertiesPanel();
        updateLayerTree();
        return;
      }
      if (e.key === ']') { editor.bringToFront(); editor.requestRender(); return; }
      if (e.key === '[') { editor.sendToBack(); editor.requestRender(); return; }
    }

    // Modifier shortcuts
    if (mod) {
      switch (e.key) {
        case '=': case '+':
          e.preventDefault();
          editor.applyZoom(-3, window.innerWidth / 2, window.innerHeight / 2);
          editor.requestRender(); updateZoomLevel(); return;
        case '-':
          e.preventDefault();
          editor.applyZoom(3, window.innerWidth / 2, window.innerHeight / 2);
          editor.requestRender(); updateZoomLevel(); return;
        case '0':
          e.preventDefault(); editor.zoomTo100(); editor.requestRender(); updateZoomLevel(); return;
        case '1':
          e.preventDefault(); editor.zoomToFit(); editor.requestRender(); updateZoomLevel(); return;
        case 'z':
          e.preventDefault();
          if (e.shiftKey) editor.redoAction(); else editor.undoAction();
          editor.requestRender(); updateLayerTree(); updatePropertiesPanel(); return;
        case 'a':
          e.preventDefault(); editor.selectAll(); editor.requestRender();
          updateLayerTree(); updatePropertiesPanel(); return;
        case 'd':
          e.preventDefault(); editor.duplicateSelected(); editor.requestRender();
          updateLayerTree(); return;
        case 'g':
          e.preventDefault();
          if (e.shiftKey) editor.ungroupSelected(); else editor.groupSelected();
          editor.requestRender(); updateLayerTree(); return;
        case 'o':
          e.preventDefault();
          if (shell) openFileDialog(shell, {
            onFileLoading: (name) => setStatus(`Loading ${name}...`, true),
            onFileLoaded: (name, count) => {
              setStatus(`Loaded ${name} (${count} nodes)`, true);
              updateLayerTree(); updateZoomLevel();
            },
            onFileError: (name, err) => setStatus(`Error: ${err}`, true),
          });
          return;
      }
    }

    // Delete
    if (e.key === 'Delete' || e.key === 'Backspace') {
      editor.deleteSelected();
      editor.requestRender();
      updateLayerTree(); updatePropertiesPanel();
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────

function setStatus(text: string, connected: boolean) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = text;
}

function updateZoomLevel() {
  const el = document.getElementById('zoom-level');
  if (el && shell) el.textContent = `${Math.round(shell.editor.state.zoom * 100)}%`;
}

function hideEmptyState() {
  const el = document.getElementById('empty-state');
  if (el) el.style.display = 'none';
}

function getSlugFromURL(): string | null {
  const match = window.location.pathname.match(/\/editor\/([^/]+)/);
  return match ? match[1] : null;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Start ──────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', boot);
}

export { boot, shell };
