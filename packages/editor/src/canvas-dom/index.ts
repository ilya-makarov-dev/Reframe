/**
 * Phase 2 — DOM-native canvas editor. Barrel export.
 *
 * Status: foundation (view + select + zoom + pan + overlay).
 * Pending: drag-to-move, drag-to-resize, text inline-edit, incremental
 * DOM patch (Phase 2c), present-mode WebGL compose (Phase 3 — see
 * `webgl-present.ts` for the architectural stub).
 *
 * Not yet loaded by default at `/platform/project/:slug` — opt-in via URL
 * flag (see `platform-bootstrap-dom.ts` wiring in `app/`).
 */

export { createDOMCanvas, type DOMCanvasOptions } from './dom-canvas.js';
export { createSceneRenderer, type SceneRendererOptions } from './renderer.js';
export { createZoomPan, ZOOM_LEVELS, type ZoomPanState } from './zoom-pan.js';
export { createSelectionOverlay, type SelectionRect, type HandlePosition } from './overlay.js';
export { hitTest, viewportToIframeCoords, type HitTestResult, type HitTestOptions } from './pointer.js';
export { isTexElementAvailable, getTexElementFunction, createPresentMode as createWebGLPresentMode } from './webgl-present.js';
export {
  createPresentMode,
  type CameraPreset, type FilterPreset,
  type PresentModeOptions, type PresentModeController,
} from './present.js';
