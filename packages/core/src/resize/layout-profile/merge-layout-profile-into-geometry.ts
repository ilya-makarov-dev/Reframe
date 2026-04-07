import type { ExactSessionGeometryOptions } from '../postprocess/exact-session-types';
import type { BannerLayoutProfile } from './types';

export interface MergeLayoutProfileContext {
  wantStrictRemember: boolean;
  strictRememberUseClusterNativeGlobal: boolean;
}

export function mergeLayoutProfileIntoGeometry(
  base: ExactSessionGeometryOptions,
  profile: BannerLayoutProfile,
  ctx: MergeLayoutProfileContext
): ExactSessionGeometryOptions {
  const h = profile.hints;

  let clusterNativeRescale = base.clusterNativeRescale === true;
  if (ctx.wantStrictRemember) {
    if (h.preferClusterNativeRescale === false) {
      clusterNativeRescale = false;
    } else if (h.preferClusterNativeRescale === true) {
      clusterNativeRescale = true;
    } else {
      clusterNativeRescale = ctx.strictRememberUseClusterNativeGlobal;
    }
  }

  const trustLetterboxBackgroundOverride =
    typeof h.trustLetterboxBackground === 'boolean' ? h.trustLetterboxBackground : undefined;

  const crossFrameSkipNearSquareOrdinalOverride = h.crossMasterOrdinalPolicy === 'relaxed';

  return {
    ...base,
    clusterNativeRescale,
    trustLetterboxBackgroundOverride,
    layoutClass: profile.layoutClass,
    crossFrameSkipNearSquareOrdinalOverride
  };
}
