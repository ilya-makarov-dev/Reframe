/**
 * @reframe/editor — Interactive design editor (DOM-canvas only).
 *
 * As of 2026-04-22 reframe ships a single editor backend: the
 * DOM canvas (iframe + HTML exporter + CSS 3D). All @open-pencil/core
 * / CanvasKit / Skia code paths removed in the same release.
 */

// Canvas — DOM backend
export {
  createDOMCanvas,
  type DOMCanvasOptions,
  createSceneRenderer,
  type SceneRendererOptions,
  createZoomPan,
  ZOOM_LEVELS,
  type ZoomPanState,
  createSelectionOverlay,
  type SelectionRect,
  type HandlePosition,
  hitTest,
  type HitTestResult,
  type HitTestOptions,
  createPresentMode,
  type CameraPreset,
  type FilterPreset,
  type PresentModeController,
  isTexElementAvailable,
  getTexElementFunction,
  createWebGLPresentMode,
} from './canvas-dom/index.js';

// Sync (DOM canvas uses SSE directly via renderer.ts; MCPClient kept
// for any future headless integration)
export { MCPClient, type MCPClientOptions } from './sync/mcp-client.js';

// Panels (non-canvas-specific rendering helpers)
export { renderBlocksPanel, BLOCK_LIBRARY, type BlockDef } from './panels/blocks.js';
export { renderAIChatPanel, type AIChatPanelData, type AIChatMessage } from './panels/ai-chat.js';
export { renderExportPanel, EXPORT_OPTIONS, type ExportFormat, type ExportOption } from './panels/export.js';
export { renderDesignSystemPanel, type DesignSystemPanelData } from './panels/design-system.js';
export { renderAuditPanel, type AuditPanelData } from './panels/audit.js';

// App
export { renderEditorShell } from './app/shell-html.js';
export { initPlatformViewport, getEditorShell } from './app/platform-bootstrap.js';
