/**
 * Barrel: master/result visual sync (copy from master, background fit, ellipse clusters, CTA glue).
 * Implementation lives in `master-visual-*.ts` modules.
 */

export {
  stretchGlowClusterChildren,
  copyVisualFromMasterNode,
  copyVisualFromMasterNodeDeep,
  copyVisualFromMasterChildren,
  cloneMasterBackgroundIntoResult,
  cloneMasterBackgroundDirectToFrame
} from './master-visual-copy-clone';

export { cloneMasterNodeIntoFrame } from './master-visual-clone-node';

export {
  coverBackgroundToTargetFrame,
  scaleChildrenNonUniform,
  fitBackgroundToTargetFrameNonUniform,
  fitBackgroundToSlotNonUniform,
  lockBackgroundSubtreeForDeterministicResize,
  scaleBackgroundSubtreeEffects
} from './master-visual-background-transform';

export {
  nodeHasBlurEffect,
  isEllipseLikeDecor,
  collectEllipseLocalBoxes,
  unionBoxes,
  alignEllipseCentersByMasterIndex,
  alignEllipseVisualByMasterIndex,
  alignEllipseClusterByMasterBBox
} from './master-visual-ellipse-align';

export type { LocalBox } from './master-visual-ellipse-align';

export {
  clampBackgroundVisualBoundsToTarget,
  clampBackgroundVisualBoundsToSlot,
  pickCanonicalBackgroundPlacement,
  resolveBackgroundSlotFromMasterNodeLive,
  resolveBackgroundSlotFromMasterNodeToTarget,
  syncSubtreeLayoutByMasterIndex,
  applyBackgroundFromMasterAbsolute,
  stretchCanonicalAndOrphanBackdropsToFrame,
  applyBackgroundCoverFromClone,
  alignBackgroundChildrenToMasterNormalized,
  alignBackgroundChildrenByMasterIndex
} from './master-visual-background-layout';

export { glueDetachedCtaRectangleToNearestLabel } from './master-visual-cta-glue';

export { masterButtonSubtreeHasCtaLabelText } from './semantic-logo-cta';
