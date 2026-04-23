// Panel artifacts — HTML-on-disk panels that hot-register into the
// Platform UI. See docs/INODE_PHASE_MAP.md (Phase 6) for the full picture.

export { resolveBindings, interpolateString, type PanelConfig } from './panel-bindings.js';
export {
  compilePanel,
  type CompilePanelOptions,
  type CompilePanelResult,
} from './compile-panel.js';
