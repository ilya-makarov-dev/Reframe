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
} from './io.js';

export { toSlug, uniqueSlug } from './slug.js';
