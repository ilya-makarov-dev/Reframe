export type {
  DesignSystem,
  DesignSystemColors,
  DesignSystemComponents,
  DesignSystemLayout,
  DesignSystemResponsive,
  DesignSystemDepth,
  TypographyRule,
  TypographyRole,
  TypographyBreakpointOverride,
  Breakpoint,
  ButtonSpec,
  ButtonStyle,
  ColorRole,
  ShadowLayer,
} from './types';

export {
  typographyRolesForSlot,
  slotForTypographyRole,
  findTypographyForSlot,
  findTypographyForSlotAtWidth,
  getButtonBorderRadius,
  snapToRadiusScale,
  fontSizeMatchesRole,
} from './types';

export { parseDesignMd } from './parser';
export {
  serializeDesignMd,
  replaceSection,
  replaceHexInPlace,
  type SerializeOpts,
  type SectionPatch,
  type HexReplaceResult,
} from './serializer';
export { extractDesignSystemFromFrame } from './extractor';
export { exportDesignMd } from './exporter';
export { applyBrandInheritance } from './inheritance';
export type { InheritanceResult } from './inheritance';

export {
  tokenizeDesignSystem,
  rebuildTokenIndexFromGraph,
  resolveToken,
  resolveColorToken,
  resolveNumberToken,
  bindTokenToNode,
  autoBindTokensFromGraph,
  rebrandColorsFromTokens,
  switchTokenMode,
  listTokens,
  collectCssTokens,
  isTokenBound,
  tokenToCssVar,
  cssVarToToken,
  colorToHex,
  hexToColor,
  TOKEN_COLLECTION_NAME,
  MODE_LIGHT,
  MODE_DARK,
} from './tokens';
export type { TokenIndex, TokenInfo, TokenizeOptions } from './tokens';

export {
  exportToDTCG,
  importFromDTCG,
  designSystemToDTCG,
} from './dtcg';
export type { DTCGToken, DTCGGroup, DTCGFile, DTCGImportOptions } from './dtcg';
