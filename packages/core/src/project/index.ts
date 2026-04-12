/**
 * Project system — persistent .reframe directory format.
 */

export {
  PROJECT_VERSION,
  createManifest,
  createSceneEntry,
  type ProjectManifest,
  type SceneEntry,
  type ProjectEvent,
} from './types.js';

export {
  initProject,
  loadProject,
  projectExists,
  saveScene,
  loadSceneFromProject,
  loadAllScenes,
  listScenes,
  deleteScene,
  saveDesignSystem,
  loadDesignSystem,
  readSceneJson,
  writeSceneJson,
  saveSourceHtml,
  loadSourceHtml,
  compileHtmlIntoProject,
  registerBrand,
  loadBrandFromProject,
  setActiveBrand,
  listRegisteredBrands,
} from './io.js';

export { toSlug, uniqueSlug } from './slug.js';

// Phase 3: operation history log
export {
  appendOp,
  appendOps,
  readOps,
  clearOps,
  replayHistory,
  historyFilePath,
  nextOpId,
  // Phase 5b: squash + compaction
  squashOps,
  compactHistory,
  type CompactOptions,
} from './history.js';

// Phase 4: responsive variants above the resize pipeline
export {
  generateVariant,
  listVariants,
  refreshVariants,
  loadSceneWithVariants,
  type Viewport,
  type GenerateVariantOptions,
} from './variants.js';

// Phase 5: macros (named, parameterized op sequences)
export {
  saveMacro,
  loadMacro,
  listMacros,
  deleteMacro,
  applyMacro,
  type MacroFile,
  type MacroTemplate,
  type ApplyMacroResult,
} from './macros.js';

// Phase 6: project-level component registry
export {
  saveComponentMaster,
  loadComponentMaster,
  listComponents,
  deleteComponent,
  componentFilePath,
  createInstancePlaceholder,
  expandInstances,
  collapseInstances,
  type ComponentFile,
  type SavedComponentEntry,
} from './components.js';

// Phase 7.0: intent model (multi-part messages, lifecycle, templates)
export * from './intents/index.js';

// Phase 8: threads (conversation grouping on an anchor).
// Direct imports via './threads/index.js' preferred — the subsystems
// intentionally share the `orphanMissingAnchors` / `countByStatus` names
// which would collide in a flat re-export. Consumers grab what they need
// from the subsystem modules.

// Phase 8: annotations (persistent visual markers).
// See note above — import from './annotations/index.js' directly.

// Phase 8: orphan garbage collection (called from saveScene)
export { sweepOrphans, collectLiveAnchors, type OrphanSweepResult } from './gc.js';

// Phase 8: thread hydration — join layer across threads + intents + annotations
export {
  hydrateThread,
  collectAnchorContext,
  cascadeResolveOnAccept,
  type HydratedThread,
} from './hydrate.js';
