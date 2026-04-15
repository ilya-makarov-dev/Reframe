/**
 * Platform Bootstrap — upgrades the platform scene page's iframe preview
 * to an interactive CanvasKit canvas.
 *
 * This is loaded as a <script> in the platform scene page.
 * It detects #reframe-viewport canvas and #reframe-preview-fallback iframe,
 * initializes CanvasKit, and swaps visibility.
 *
 * Progressive enhancement: if CanvasKit fails to load, the iframe stays.
 */

import { createReframeEditor, type ReframeEditorShell } from '../canvas/editor-shell.js';
import { setupCanvasInteraction } from '../canvas/interaction.js';
import { setupFileDragDrop } from './file-handler.js';
import { getContextMenuItems, renderContextMenu, executeContextAction } from './context-menu.js';
import { MCPClient } from '../sync/mcp-client.js';

let shell: ReframeEditorShell | null = null;

/**
 * Initialize the interactive viewport on the platform scene page.
 * Call this after the page DOM is ready.
 */
export async function initPlatformViewport(): Promise<ReframeEditorShell | null> {
  const canvas = document.getElementById('reframe-viewport') as HTMLCanvasElement | null;
  const iframe = document.getElementById('reframe-preview-fallback') as HTMLIFrameElement | null;

  if (!canvas) return null; // Not on a scene page

  const sessionId = canvas.dataset.session;

  try {
    // 1. Create editor shell
    shell = await createReframeEditor({
      canvas,
      onSelectionChanged: (ids) => {
        // Dispatch custom event for platform JS to handle
        window.dispatchEvent(new CustomEvent('reframe:selection', {
          detail: { selectedIds: [...ids] },
        }));
      },
      onGraphChanged: () => {
        window.dispatchEvent(new CustomEvent('reframe:graph-changed'));
      },
    });

    // 2. Resize canvas to container
    const container = canvas.parentElement!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = container.clientWidth * dpr;
      canvas.height = container.clientHeight * dpr;
      canvas.style.width = container.clientWidth + 'px';
      canvas.style.height = container.clientHeight + 'px';
      shell?.editor.requestRender();
    };
    new ResizeObserver(resize).observe(container);
    resize();

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

    // 6. Swap: hide iframe, show canvas
    canvas.style.display = 'block';
    if (iframe) iframe.style.display = 'none';

    // 7. Load scene from MCP if available
    if (sessionId) {
      try {
        const mcpClient = new MCPClient();
        const sceneData = await mcpClient.fetchScene(sessionId);
        if (sceneData) {
          // Scene loaded — viewport will render it
          shell.editor.zoomToFit();
          shell.editor.requestRender();
        }
      } catch { /* scene fetch failed — empty canvas */ }
    }

    // 8. Set page ID for layer tree
    const pages = shell.editor.getPages();
    if (pages.length > 0) {
      shell.editor.state.currentPageId = pages[0].id;
    }

    return shell;
  } catch (err) {
    // CanvasKit failed — keep iframe fallback
    console.warn('[reframe] CanvasKit init failed, keeping iframe preview:', err);
    canvas.style.display = 'none';
    if (iframe) iframe.style.display = 'block';
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

  // Dismiss on click outside
  const dismiss = (e: PointerEvent) => {
    if (!div.contains(e.target as Node)) {
      div.remove();
      document.removeEventListener('pointerdown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', dismiss), 0);
}
