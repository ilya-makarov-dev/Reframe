export type {
  BuildCrossFramePlacementsOpts,
  ExactSessionCaptureSize,
  ExactSessionGeometryMode,
  ExactSessionGeometryOptions,
  ExactSessionPlacement
} from './exact-session-types';

export {
  buildCrossFrameSessionPlacements,
  buildStrictPlacementsWithLiveGeometry,
  coalesceEllipseClusterPlacements,
  collectDisclaimerCrossSourceNodes,
  enrichCrossPlacementElementFromMasterLive,
  filterExactSessionPlacements,
  filterPlacementsSkipInsideButtonFrames,
  layoutAspectSpread,
  mergeGuideSlotElements,
  rewriteCrossPlacementsFromSourceGeometry,
  sortNodesByPositionInFrame,
  syncPlacementPixelRectsFromElements
} from './exact-session-placements';

export type { VisualLayerSig } from './cross-frame-visual-signature';
export {
  compositeVisiblePaintsFingerprint,
  crossOtherDecorMatchDistance,
  extractVisualSignature,
  nodeFillStrokeKeys,
  paintFingerprint,
  sumLayerBlurRadius,
  visualSigFromAnyDecorNode,
  visualSigFromMasterOtherRow,
  visualSignatureDistance
} from './cross-frame-visual-signature';

export { isGlowDecorClusterContainer, isEllipseOnlyClusterContainer } from './semantic-decor-containers';

export { tryResolveNodeById, tryResolveNodeByIdAsync } from './figma-node-resolve';

export type { LocalBox } from './master-visual-ellipse-align';

export {
  alignBackgroundChildrenByMasterIndex,
  alignBackgroundChildrenToMasterNormalized,
  alignEllipseCentersByMasterIndex,
  alignEllipseClusterByMasterBBox,
  alignEllipseVisualByMasterIndex,
  applyBackgroundCoverFromClone,
  applyBackgroundFromMasterAbsolute,
  cloneMasterBackgroundDirectToFrame,
  cloneMasterBackgroundIntoResult,
  cloneMasterNodeIntoFrame,
  collectEllipseLocalBoxes,
  copyVisualFromMasterChildren,
  copyVisualFromMasterNode,
  copyVisualFromMasterNodeDeep,
  coverBackgroundToTargetFrame,
  fitBackgroundToSlotNonUniform,
  fitBackgroundToTargetFrameNonUniform,
  glueDetachedCtaRectangleToNearestLabel,
  isEllipseLikeDecor,
  lockBackgroundSubtreeForDeterministicResize,
  nodeHasBlurEffect,
  pickCanonicalBackgroundPlacement,
  resolveBackgroundSlotFromMasterNodeLive,
  resolveBackgroundSlotFromMasterNodeToTarget,
  scaleBackgroundSubtreeEffects,
  scaleChildrenNonUniform,
  stretchCanonicalAndOrphanBackdropsToFrame,
  stretchGlowClusterChildren,
  syncSubtreeLayoutByMasterIndex,
  unionBoxes,
  clampBackgroundVisualBoundsToSlot,
  clampBackgroundVisualBoundsToTarget
} from './master-visual-sync';
