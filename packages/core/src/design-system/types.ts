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
    /**
     * Semantic typography roles (T3 #9) — display / body / ui / annotation
     * declared via `## Typography Roles` section in DESIGN.md.
     *
     * All roles are independently optional — brand may declare any subset.
     * `annotation` role wires into the existing annotation rendering chain
     * via `resolveAnnotationFont(ds)`; when declared, it overrides the
     * hardcoded ANNOTATION_FONT (Caveat 500) for that brand. The other
     * three roles surface in `reframe_inspect` for designer / agent
     * reference when authoring HTML — auto-application via semantic-tag
     * is reserved as a future signal.
     */
    roles?: TypographyRoles;
  };
  components: DesignSystemComponents;
  layout: DesignSystemLayout;
  responsive: DesignSystemResponsive;
  depth?: DesignSystemDepth;

  /**
   * Brand-mark variants (Week 5 #21). Logo SVGs live alongside DESIGN.md
   * under `.reframe/brands/<slug>/marks/<variant>.svg`. Parser surfaces
   * whatever's on disk via the `## Brand Mark` section in DESIGN.md.
   * Absent when the brand has no `marks/` directory — gracefully optional.
   */
  brandMark?: DesignSystemBrandMark;

  /**
   * Brand vocabulary (Week 5 #4). Power-words auto-emphasized at import
   * via `<strong>` wrap with brand accent color; industry terms recognized
   * for inspect surfacing but not styled. Section-absent → undefined,
   * importer skips wrap pass, output byte-identical to non-vocab build.
   */
  vocabulary?: BrandVocabulary;

  /**
   * Tweak surface (T2 #26) — token paths the brand author has marked
   * end-user-customizable. Bundle export with `tweakable: true` reads
   * this list, emits :root CSS vars for the listed paths, swaps inline
   * style values with var() references, and injects a floating tweak
   * panel + runtime IIFE that wires inputs to var updates +
   * localStorage persistence.
   *
   * Section absent in DESIGN.md → undefined. Bundle exporter then ignores
   * the `tweakable` option (graceful: no vars, no panel, warning logged).
   */
  tweakSurface?: TweakDef[];

  /**
   * Undertone axis (T3 #7) — palette temperature classification.
   *   warm    — red / orange / rose-leaning palette
   *   cool    — blue / cyan / azure-leaning palette
   *   neutral — balanced, achromatic-only, or below-threshold mix
   *
   * Computed via weighted hue analysis (see design-system/undertone.ts)
   * unless DESIGN.md declares an override under `## Undertone`. Drives:
   *   - inspect surfacing (one-line summary in design system section)
   *   - audit.undertone-clash rule (warns on scene colors fighting axis)
   *   - future warm-shifted / cool-shifted variant generation
   */
  undertone?: UndertoneAxis;

  /**
   * Origin of `undertone` field — 'computed' from palette, 'declared'
   * via `## Undertone` section in DESIGN.md. Lets inspect distinguish
   * "we inferred this" from "designer specified this".
   */
  undertoneSource?: 'computed' | 'declared';

  /** Raw markdown source (for debugging / re-export). */
  rawMarkdown?: string;
}

/**
 * Undertone temperature axis (T3 #7).
 *
 * Three-bucket classification of brand color palette mood. Computed by
 * `computeUndertone()` in design-system/undertone.ts via weighted hue
 * analysis with primary 2× boost; threshold ±0.25 keeps balanced
 * palettes labeled 'neutral' rather than slightly-warm or slightly-cool.
 */
export type UndertoneAxis = 'warm' | 'cool' | 'neutral';

/**
 * Single typography role declaration (T3 #9). Each role is a tuple of
 * font family + weight + letter-spacing + size scale. Fields are
 * independently optional; partial roles still register.
 *
 * `letterSpacing` is a CSS-compatible string (`-0.03em`, `0.5px`,
 * `normal`) so the value can paste directly into emitted styles.
 *
 * `sizes` is the discrete scale the role lives on (e.g. display heads
 * are 48/64/80/96; body is 14/16/18). Audit rules + designer guidance
 * read this as the legal-size set for the role.
 *
 * Named TypographyRoleSpec to avoid collision with the legacy
 * `TypographyRole` string union (which is the hierarchy role label —
 * 'hero' / 'title' / 'body' / etc. — used in TypographyRule entries).
 */
export interface TypographyRoleSpec {
  family?: string;
  weight?: number;
  letterSpacing?: string;
  sizes?: number[];
}

/**
 * Four canonical typography roles (T3 #9). Each independently optional.
 *   display    — large headline / hero typography
 *   body       — paragraph / longform text
 *   ui         — buttons, labels, inline controls
 *   annotation — designer notes / margin scribbles (overrides ANNOTATION_FONT)
 *
 * Future signals may add roles (e.g. `code`, `caption`, `quote`) — append
 * to this interface, parser auto-picks them up via the section walker.
 */
export interface TypographyRoles {
  display?: TypographyRoleSpec;
  body?: TypographyRoleSpec;
  ui?: TypographyRoleSpec;
  annotation?: TypographyRoleSpec;
}

/**
 * Single tweakable token declared under `## Tweak Surface` in DESIGN.md.
 *
 * Phase 0 supports two control types:
 *   - `color` → `<input type="color">` rendered in panel; tokenPath value
 *     stored as hex (#rrggbb). Substituted into scene styles wherever the
 *     resolved initial color appears as a literal.
 *   - `range` → `<input type="range">` with min/max/step/unit. Substituted
 *     into scene styles wherever the resolved initial value appears with
 *     matching unit.
 *
 * Future signals: enum (dropdown), boolean (toggle), text (free input),
 * derived (computed-from-other-tokens). Reserved for Variant 2 schema-
 * driven controls.
 */
export interface TweakDef {
  /** Slash-separated path, e.g. 'color/primary', 'radius/medium', 'spacing/scale'. */
  tokenPath: string;
  /** Control type. Phase 0 supports 'color' | 'range' only. */
  type: 'color' | 'range';
  /** Human-readable label rendered above the input in the panel. */
  label: string;
  /** Range min (numeric). Required when `type: 'range'`. */
  min?: number;
  /** Range max (numeric). Required when `type: 'range'`. */
  max?: number;
  /** Range step (numeric). Default 1 when omitted on range types. */
  step?: number;
  /** Unit suffix appended at substitution time, e.g. 'px', 'x', '%', ''. */
  unit?: string;
}

/**
 * Logo SVG variants for a brand. `variants` is the discovered set,
 * `defaultVariant` is the recommended one (`primary` when present).
 * `paths` map variant → repo-relative path (.reframe/brands/<slug>/marks/<variant>.svg).
 */
export interface DesignSystemBrandMark {
  variants: string[];
  defaultVariant: string;
  paths: Record<string, string>;
}

/**
 * Brand vocabulary — voice signature in the content layer.
 *
 * `powerWords` = phrases the importer auto-emphasizes (wraps in
 * `<strong>` with the resolved style attrs). Case-insensitive match
 * with case-preserved output. Multi-word phrases supported (sorted
 * longest-first to avoid sub-string mis-matches).
 *
 * `industryTerms` = phrases the parser recognizes but does NOT style.
 * Surfaced as occurrence counts in `reframe_inspect` for taste audits
 * (future #22 critic enhancements).
 *
 * `style.color` accepts: `'accent'` (resolves to brand primary at wrap
 * time), `'text-high'` / `'text-low'`, a hex literal, or a brand-token
 * name. Phase 0 resolves only the keyword shorthands + hex.
 */
export interface BrandVocabulary {
  powerWords: string[];
  industryTerms: string[];
  style: {
    weight: number;
    color: string;
    decoration: 'none' | 'underline' | 'highlight';
  };
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
