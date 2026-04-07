import { type INode } from '../../host';
import type {
  BannerLayoutClass,
  BannerLayoutProfile,
  BannerLayoutSignals,
  EngineResizeHints
} from './types';
import { BANNER_LAYOUT_CLASSIFIER_VERSION } from './types';
import { collectBannerLayoutSignals } from './collect-banner-layout-signals';

function hintsForClass(c: BannerLayoutClass, signals?: BannerLayoutSignals): EngineResizeHints {
  const nearlySquare =
    signals != null && signals.aspectRatio > 0.85 && signals.aspectRatio < 1.15;
  switch (c) {
    case 'full_bleed_hero':
      return {
        trustLetterboxBackground: true,
        preferClusterNativeRescale: true,
        crossMasterOrdinalPolicy: 'default',
        extras: { note: 'large hero/backdrop — avoid double background transform' }
      };
    case 'split_or_collage':
      return {
        trustLetterboxBackground: false,
        crossMasterOrdinalPolicy: 'relaxed',
        extras: { note: 'several regions — ordinal tie-breaks more useful' }
      };
    case 'text_stack_bottom':
      return {
        /** Near-square cross targets: relaxed avoids forcing Y-ordinal over geometry when spread enables that path. */
        crossMasterOrdinalPolicy: nearlySquare ? 'relaxed' : 'strict',
        trustLetterboxBackground: true,
        extras: {
          note: nearlySquare
            ? 'multiple bottom texts — near-square: cross pins slots to clone map (sourceNodeId) when set; ordinal override skipped per slot'
            : 'multiple bottom texts — preserve Y order vs slots'
        }
      };
    case 'minimal_ui':
      return {
        preferClusterNativeRescale: false,
        trustLetterboxBackground: true,
        extras: { note: 'few layers — letterbox slot math often matches oLD' }
      };
    case 'product_forward':
      return {
        trustLetterboxBackground: true,
        preferClusterNativeRescale: true,
        extras: { note: 'hero product shot — similar to full_bleed but text secondary' }
      };
    default:
      return { crossMasterOrdinalPolicy: 'default' };
  }
}

function scoreClass(s: BannerLayoutSignals): { layoutClass: BannerLayoutClass; confidence: number } {
  const { aspectRatio } = s;
  const nearlySquare = aspectRatio > 0.85 && aspectRatio < 1.15;

  // Order matters: from more specific to general.
  if (s.rootChildCount <= 5 && s.textNodeCount <= 4 && s.nestedFrameDepthMax <= 4) {
    const conf = nearlySquare ? 0.55 : 0.72;
    if (s.largestRectAreaRatio < 0.35 && s.textNodeCount <= 3) {
      return { layoutClass: 'minimal_ui', confidence: conf };
    }
  }

  if (s.textInLowerThirdCount >= 2 && s.textNodeCount >= 2) {
    return { layoutClass: 'text_stack_bottom', confidence: 0.68 };
  }

  if (
    s.largestRectAreaRatio < 0.42 &&
    s.imageFillAreaRatioApprox > 0.12 &&
    s.rootChildCount >= 4
  ) {
    return { layoutClass: 'split_or_collage', confidence: 0.62 };
  }

  if (s.imageFillAreaRatioApprox > 0.18 && s.textNodeCount <= 5 && s.largestRectAreaRatio < 0.52) {
    return { layoutClass: 'product_forward', confidence: 0.58 };
  }

  if (s.largestRectAreaRatio > 0.48 || s.imageFillAreaRatioApprox > 0.3) {
    return { layoutClass: 'full_bleed_hero', confidence: 0.7 };
  }

  return { layoutClass: 'unknown', confidence: 0.35 };
}

/**
 * Main API: frame → class + hints + signals.
 * Does not change engine behavior yet — call from pipeline when ready to merge hints.
 */
export function resolveBannerLayoutProfile(frame: INode): BannerLayoutProfile {
  const signals = collectBannerLayoutSignals(frame);
  const { layoutClass, confidence } = scoreClass(signals);
  const hints = hintsForClass(layoutClass, signals);

  return {
    layoutClass,
    confidence,
    signals,
    hints,
    classifierVersion: BANNER_LAYOUT_CLASSIFIER_VERSION
  };
}

export function resolveBannerLayoutProfileFromSignals(signals: BannerLayoutSignals): BannerLayoutProfile {
  const { layoutClass, confidence } = scoreClass(signals);
  return {
    layoutClass,
    confidence,
    signals,
    hints: hintsForClass(layoutClass, signals),
    classifierVersion: BANNER_LAYOUT_CLASSIFIER_VERSION
  };
}
