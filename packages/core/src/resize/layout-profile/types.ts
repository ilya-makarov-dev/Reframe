export const BANNER_LAYOUT_CLASSIFIER_VERSION = 1 as const;

export type BannerLayoutClass =
  | 'full_bleed_hero'
  | 'split_or_collage'
  | 'text_stack_bottom'
  | 'minimal_ui'
  | 'product_forward'
  | 'unknown';

export interface EngineResizeHints {
  preferClusterNativeRescale?: boolean;
  trustLetterboxBackground?: boolean;
  crossMasterOrdinalPolicy?: 'default' | 'relaxed' | 'strict';
  extras?: Record<string, unknown>;
}

export interface BannerLayoutSignals {
  width: number;
  height: number;
  aspectRatio: number;
  largestRectAreaRatio: number;
  textNodeCount: number;
  textInLowerThirdCount: number;
  nestedFrameDepthMax: number;
  imageFillAreaRatioApprox: number;
  rootChildCount: number;
}

export interface BannerLayoutProfile {
  layoutClass: BannerLayoutClass;
  confidence: number;
  signals: BannerLayoutSignals;
  hints: EngineResizeHints;
  classifierVersion: typeof BANNER_LAYOUT_CLASSIFIER_VERSION;
}
