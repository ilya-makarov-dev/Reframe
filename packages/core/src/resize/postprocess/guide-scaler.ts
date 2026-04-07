/**
 * Public postprocess surface -- corresponds to exports from the reference
 * `oLD (bun unstuble)/src/postprocess/guide-scaler.ts`, but implementation is split across modules:
 *
 * | Reference (single file)   | Current module |
 * |---------------------------|----------------|
 * | applyGuidePostProcess     | guide-scaler-guide-flow |
 * | applyExactSessionPostProcess | guide-scaler-exact-session |
 * | buildSourceToResultNodeIdMap* | node-id-mapper |
 * | getSemanticTypes*         | semantic-classifier |
 * | buildAutoSessionSlots*, refresh*, rebuild* | session-slots |
 * | buildCrossFrame*, rewrite*, buildStrict*, filterExact* | cross-frame-matcher -> exact-session-placements |
 */

export { applyGuidePostProcess } from './guide-scaler-guide-flow';
export { applyExactSessionPostProcess } from './guide-scaler-exact-session';

export { buildSourceToResultNodeIdMapWithMeta, buildSourceToResultNodeIdMap } from './node-id-mapper';

export { getSemanticTypesForResultFrame, getSemanticTypesFromSourceGuide } from './semantic-classifier';

export {
  buildAutoSessionSlotsFromFrame,
  buildAutoSessionSlotsFromFrame2,
  refreshSessionCaptureAfterScale,
  rebuildSessionSlotsFromPlacements
} from './session-slots';

export {
  buildCrossFrameSessionPlacements,
  rewriteCrossPlacementsFromSourceGeometry,
  buildStrictPlacementsWithLiveGeometry,
  filterExactSessionPlacements,
  syncPlacementPixelRectsFromElements
} from './cross-frame-matcher';
