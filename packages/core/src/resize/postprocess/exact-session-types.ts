import { GuideElement, BannerElementType } from '../contracts/types';
import type { BannerLayoutClass } from '../layout-profile/types';
import type { INode } from '../../host';

/** One placed slot in exact Remember / cross-master mode. */
export interface ExactSessionPlacement {
  resultNodeId: string;
  masterSourceNodeId?: string;
  slotType: BannerElementType;
  element: GuideElement;
  x: number;
  y: number;
  w: number;
  h: number;
  /** If the node should be treated as a background/backdrop */
  isBackdrop?: boolean;
}

export interface ExactSessionCaptureSize {
  w: number;
  h: number;
}

export type ExactSessionGeometryMode = 'strict' | 'cross';

export interface ExactSessionGeometryOptions {
  mode: ExactSessionGeometryMode;
  /** Optional: at runtime post-process does not depend on id; populate for audit/logs. */
  sourceFrameId?: string;
  resultFrameId?: string;
  /** Remember capture dimensions (master layout) */
  capture?: { width: number; height: number };
  sourceWidth?: number;
  sourceHeight?: number;
  /**
   * Strict Remember + cluster `execute()` (as without guide): root is already targetW×H, slot fractions are relative to the **entire** frame.
   * Without this flag post-process maps slots via letterbox (Rw*u+ox) — must match the pipeline (usually contain, like oLD).
   */
  clusterNativeRescale?: boolean;
  /**
   * Layout classifier (`layout-profile`): override the "trust letterbox for background" heuristic.
   * If not set — computed in `applyExactSessionPostProcess`.
   */
  trustLetterboxBackgroundOverride?: boolean;
  /** Layout class (logs, debugging, future presets). */
  layoutClass?: BannerLayoutClass;
  /**
   * Cross-master: do not force near-square Y-ordinal override in `buildCrossFrameSessionPlacements`
   * (classifier: `crossMasterOrdinalPolicy === 'relaxed'`).
   */
  crossFrameSkipNearSquareOrdinalOverride?: boolean;
  /**
   * Cross: `syncPlacementPixelRectsFromElements` was called before post-process — trust `placement.x/y/w/h`
   * for positioning (otherwise comparison with `guideW` from element yields false miss → all text at ox).
   */
  trustSyncedPlacementRects?: boolean;
}

export interface BuildCrossFramePlacementsOpts {
  sourceFrame: INode;
  resultFrame: INode;
  masterSourceFrame?: INode;
}
