/**
 * @reframe/editor — Interactive design editor.
 *
 * Combines @open-pencil/core (CanvasKit viewport, .fig, editing)
 * with @reframe/core (audit, tokens, resize, export, HTML import).
 */

// Bridge
export { GraphBridge } from './bridge/graph-bridge.js';
export {
  type ReframeExtension,
  extractExtension,
  applyExtension,
  opGridTrackToReframe,
  reframeGridTrackToOP,
} from './bridge/node-bridge.js';

// Canvas
export {
  createReframeEditor,
  type ReframeEditorOptions,
  type ReframeEditorShell,
} from './canvas/editor-shell.js';
export {
  drawAuditOverlay,
  createAuditOverlayState,
  type AuditOverlayState,
  type AuditIssueOverlay,
} from './canvas/audit-overlay.js';

// Sync
export { MCPClient, type MCPClientOptions } from './sync/mcp-client.js';
export { StoreSync, type StoreSyncOptions } from './sync/store-sync.js';

// Panels
export { renderPropertiesPanel, type PropertiesPanelData } from './panels/properties.js';
export { renderBlocksPanel, BLOCK_LIBRARY, type BlockDef } from './panels/blocks.js';
export { renderAIChatPanel, type AIChatPanelData, type AIChatMessage } from './panels/ai-chat.js';
export { renderExportPanel, EXPORT_OPTIONS, type ExportFormat, type ExportOption } from './panels/export.js';
export { renderDesignSystemPanel, type DesignSystemPanelData } from './panels/design-system.js';
export { renderAuditPanel, type AuditPanelData } from './panels/audit.js';

// Tool Bridge
export {
  importFigFile,
  exportToFig,
  runOPLint,
  getOPTools,
  executeOPTool,
  CAPABILITY_MAP,
} from './sync/tool-bridge.js';

// Canvas Interaction
export { setupCanvasInteraction, type InteractionCallbacks } from './canvas/interaction.js';

// App
export { renderEditorShell } from './app/shell-html.js';
export { initPlatformViewport, getEditorShell } from './app/platform-bootstrap.js';
export { setupFileDragDrop, openFileDialog } from './app/file-handler.js';
export {
  getContextMenuItems,
  renderContextMenu,
  executeContextAction,
  type ContextMenuItem,
} from './app/context-menu.js';
