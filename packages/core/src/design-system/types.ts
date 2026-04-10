/**
 * Design System types — machine-readable brand spec (parsed from DESIGN.md).
 *
 * A DesignSystem describes brand-level rules: typography hierarchy, color roles,
 * component styles, layout spacing, and responsive breakpoints.
 * The engine uses this to make smarter semantic classification and pixel-perfect
 * adaptation that respects the brand's design language.
 */

import type { BannerElementType } from '../resize/contracts/types';

// ---------------------------------------------------------------------------
//  Typography
// ---------------------------------------------------------------------------

export type TypographyRole = 'hero' | 'title' | 'subtitle' | 'body' | 'caption' | 'disclaimer' | 'button';

export interface TypographyRule {
  role: TypographyRole;
  fontFamily?: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;         // multiplier (1.0 = 100%)
  letterSpacing: number;      // px (negative = tight)
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  fontFeatures?: string[];    // OpenType features: ['ss01', 'tnum', 'cv01', 'salt', 'lnum']
}

/** OpenType font feature with scope info. */
export interface FontFeature {
  tag: string;                // e.g. 'ss01', 'tnum', 'cv01'
  scope: 'global' | 'heading' | 'body' | 'code'; // where it applies
  description?: string;       // e.g. 'alternate lowercase a'
}

/** Typography at a specific breakpoint (responsive scaling). */
export interface TypographyBreakpointOverride {
  breakpointName: string;
  role: TypographyRole;
  fontSize: number;
  letterSpacing?: number;
  lineHeight?: number;
}

// ---------------------------------------------------------------------------
//  Colors
// ---------------------------------------------------------------------------

export interface ColorRole {
  name: string;               // e.g. 'primary', 'cta', 'background', 'text', 'accent'
  hex: string;                // e.g. '#0071e3'
  opacity?: number;           // 0..1
}

export interface DesignSystemColors {
  primary?: string;
  background?: string;
  text?: string;
  accent?: string;
  /** Full semantic color map: role name → hex. */
  roles: Map<string, string>;
  /** Gradient definitions: name → CSS gradient string. */
  gradients?: Map<string, string>;
}

// ---------------------------------------------------------------------------
//  Components
// ---------------------------------------------------------------------------

export type ButtonStyle = 'pill' | 'rounded' | 'square';

export interface InteractiveState {
  background?: string;        // hex or rgba
  color?: string;             // text color
  opacity?: number;
  scale?: number;             // e.g. 1.02 for hover lift
  borderColor?: string;
  shadow?: string;            // CSS box-shadow shorthand
}

export interface ButtonVariant {
  name: string;               // 'primary', 'secondary', 'ghost', 'outline', 'pill', 'icon', 'destructive'
  background?: string;
  color?: string;
  borderRadius?: number;
  borderColor?: string;
  fontWeight?: number;
  fontSize?: number;
  textTransform?: 'uppercase' | 'none';
  minHeight?: number;         // px (accessibility: ≥44)
  paddingX?: number;          // horizontal padding
  paddingY?: number;          // vertical padding
  hover?: InteractiveState;
  active?: InteractiveState;
  focus?: InteractiveState;
  disabled?: InteractiveState;
}

export interface ButtonSpec {
  borderRadius: number;       // px (9999 = pill)
  style: ButtonStyle;
  fontWeight?: number;
  textTransform?: 'uppercase' | 'none';
  variants?: ButtonVariant[];
}

export interface CardSpec {
  borderRadius: number;
  shadowLayers?: number;
  background?: string;
  borderColor?: string;
  padding?: number;
  hover?: InteractiveState;
}

export interface BadgeSpec {
  borderRadius: number;
  fontSize?: number;
  fontWeight?: number;
  paddingX?: number;
  paddingY?: number;
  background?: string;
  color?: string;
}

export interface InputSpec {
  borderRadius: number;
  borderColor?: string;
  fontSize?: number;
  height?: number;
  paddingX?: number;
  background?: string;
  focusBorderColor?: string;
  focus?: InteractiveState;
}

export interface NavSpec {
  height?: number;
  background?: string;
  borderBottom?: string;
  fontSize?: number;
  fontWeight?: number;
  activeIndicator?: 'underline' | 'background' | 'bold' | 'dot';
}

export interface DesignSystemComponents {
  button?: ButtonSpec;
  card?: CardSpec;
  badge?: BadgeSpec;
  input?: InputSpec;
  nav?: NavSpec;
}

// ---------------------------------------------------------------------------
//  Layout & Spacing
// ---------------------------------------------------------------------------

export interface DesignSystemLayout {
  spacingUnit: number;        // base grid (e.g. 8)
  spacingScale?: number[];    // full scale: [2, 4, 8, 12, 16, 24, 32, 48, 64]
  maxWidth?: number;          // content container max-width
  sectionSpacing?: number;    // vertical gap between sections
  /**
   * Allowed range for section-level padding (e.g. [80, 160]). When set, audit
   * rules accept any padding within this range as section spacing — without it,
   * marketing-grade 80–120px hero padding gets snapped to micro-scale tokens.
   */
  sectionPaddingRange?: [number, number];
  borderRadiusScale: number[];// e.g. [0, 2, 4, 8, 12, 16, 9999]
}

// ---------------------------------------------------------------------------
//  Responsive
// ---------------------------------------------------------------------------

export interface Breakpoint {
  name: string;               // e.g. 'mobile', 'tablet', 'desktop'
  width: number;              // min-width px
}

export interface DesignSystemResponsive {
  breakpoints: Breakpoint[];
  /** Typography overrides per breakpoint. */
  typographyOverrides: TypographyBreakpointOverride[];
}

// ---------------------------------------------------------------------------
//  Shadows / Depth
// ---------------------------------------------------------------------------

export interface ShadowLayer {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;              // rgba string or hex
  inset?: boolean;            // inset shadow (recessed/sunken effect)
}

export interface DesignSystemDepth {
  elevationLevels: ShadowLayer[][];  // index = elevation level, value = shadow stack
}

// ---------------------------------------------------------------------------
//  Root DesignSystem
// ---------------------------------------------------------------------------

export interface DesignSystem {
  brand: string;
  version?: string;

  colors: DesignSystemColors;
  typography: {
    hierarchy: TypographyRule[];
    fontFeatures?: FontFeature[];     // global OpenType features
    primaryFont?: string;             // primary font family name
    secondaryFont?: string;           // secondary/accent font
    /**
     * Every font size found in the typography table, regardless of role dedup.
     * Audit rules use this as the authoritative "is this size legal?" set so a
     * brand documenting Display 72/64/48 isn't reduced to a single hero entry.
     */
    allSizes?: number[];
  };
  components: DesignSystemComponents;
  layout: DesignSystemLayout;
  responsive: DesignSystemResponsive;
  depth?: DesignSystemDepth;

  /** Raw markdown source (for debugging / re-export). */
  rawMarkdown?: string;
}

// ---------------------------------------------------------------------------
//  Mapping helpers: TypographyRole ↔ BannerElementType
// ---------------------------------------------------------------------------

const SLOT_TO_TYPO: Partial<Record<BannerElementType, TypographyRole[]>> = {
  title:       ['hero', 'title'],
  description: ['subtitle', 'body'],
  disclaimer:  ['caption', 'disclaimer'],
  button:      ['button'],
  ageRating:   ['caption'],
};

const TYPO_TO_SLOT: Partial<Record<TypographyRole, BannerElementType>> = {
  hero:       'title',
  title:      'title',
  subtitle:   'description',
  body:       'description',
  caption:    'disclaimer',
  disclaimer: 'disclaimer',
  button:     'button',
};

/** Get candidate typography roles for a semantic slot type. */
export function typographyRolesForSlot(slot: BannerElementType): TypographyRole[] {
  return SLOT_TO_TYPO[slot] ?? [];
}

/** Get the most likely slot type for a typography role. */
export function slotForTypographyRole(role: TypographyRole): BannerElementType {
  return TYPO_TO_SLOT[role] ?? 'other';
}

// ---------------------------------------------------------------------------
//  Query helpers
// ---------------------------------------------------------------------------

/** Find the best matching typography rule for a slot type. */
export function findTypographyForSlot(ds: DesignSystem, slot: BannerElementType): TypographyRule | undefined {
  const roles = typographyRolesForSlot(slot);
  for (const role of roles) {
    const rule = ds.typography.hierarchy.find(r => r.role === role);
    if (rule) return rule;
  }
  return undefined;
}

/** Find typography rule for a slot at a specific target width (responsive). */
export function findTypographyForSlotAtWidth(
  ds: DesignSystem,
  slot: BannerElementType,
  targetWidth: number
): TypographyRule | undefined {
  const base = findTypographyForSlot(ds, slot);
  if (!base) return undefined;

  // Find the applicable breakpoint for this width
  const sorted = [...ds.responsive.breakpoints].sort((a, b) => b.width - a.width);
  const bp = sorted.find(b => targetWidth >= b.width);
  if (!bp) return base;

  // Check for override at this breakpoint
  const roles = typographyRolesForSlot(slot);
  for (const role of roles) {
    const override = ds.responsive.typographyOverrides.find(
      o => o.breakpointName === bp.name && o.role === role
    );
    if (override) {
      return {
        ...base,
        fontSize: override.fontSize,
        letterSpacing: override.letterSpacing ?? base.letterSpacing,
        lineHeight: override.lineHeight ?? base.lineHeight,
      };
    }
  }

  return base;
}

/** Get button border radius from design system. */
export function getButtonBorderRadius(ds: DesignSystem): number {
  return ds.components.button?.borderRadius ?? 8;
}

/** Find closest border-radius in the design system's scale. */
export function snapToRadiusScale(ds: DesignSystem, rawRadius: number): number {
  const scale = ds.layout.borderRadiusScale;
  if (scale.length === 0) return rawRadius;
  let best = scale[0];
  let bestDist = Math.abs(rawRadius - best);
  for (const r of scale) {
    const d = Math.abs(rawRadius - r);
    if (d < bestDist) { bestDist = d; best = r; }
  }
  return best;
}

/**
 * Check if a fontSize approximately matches a typography role.
 * Checks every entry with the given role — typography parsers preserve
 * multiple rows per role (e.g. Apple has Section Heading 40, Tile Heading 28,
 * Card Title 21 all classified as 'title'), and a single-`find` would only
 * compare against the first row, mass-rejecting valid sizes.
 *
 * Tolerance is ±10%: looser would conflate adjacent roles (17px body sits
 * within 20% of 21px Card Title and would mass-tag body as title), tighter
 * would miss legitimate variants like 39px on a 40px-defined Section Heading.
 */
export function fontSizeMatchesRole(ds: DesignSystem, fontSize: number, role: TypographyRole): boolean {
  for (const rule of ds.typography.hierarchy) {
    if (rule.role !== role) continue;
    const ratio = fontSize / rule.fontSize;
    if (ratio >= 0.9 && ratio <= 1.1) return true;
  }
  return false;
}
