/**
 * Tweak authoring helpers — Phase 2 Brief 2a Pin #4 + Pin #3 detection.
 *
 * Two pure helpers consumed by 115-tweaks-panel.js (authoring modal +
 * card-picker rendering) and exercised directly by week12 contract:
 *
 * - `inferSliderDefaults(prop)` — when designer adds a `kind: 'number'`
 *   tweak with the "Auto" checkbox enabled, infer { min, max, step }
 *   from the prop name. Reframe-superior to OD's manually-authored
 *   sliders: opacity becomes 0-1 / 0.05 by default, padding becomes
 *   0-128 / 4, etc. — semantically correct out of box without designer
 *   typing numbers.
 *
 * - `getCardPickerKindForTweak(tweak)` — convention-based detection
 *   for card-picker rendering vs <select> dropdown fallback. Select
 *   tweaks targeting `palette.*` tokens render as 24×24 swatch grid;
 *   targeting `typography.*` render as Aa-sample card grid; everything
 *   else falls through to the existing dropdown.
 */

// ─── Pin #4 — Adaptive slider defaults ────────────────────────
//
// Mapping covers the ~30 numeric CSS props designers most commonly
// expose as live tweaks. Unknown props fall to a sane 0-100 / 1
// fallback — never throws. Values reflect Figma muscle-memory ranges
// + reframe's audit-rule sweet spots (44px min touch target, 4-pt
// spacing scale, etc.).

export interface SliderDefaults {
  min: number;
  max: number;
  step: number;
}

const PROP_DEFAULTS: Record<string, SliderDefaults> = {
  // Color / opacity
  'opacity': { min: 0, max: 1, step: 0.05 },

  // Corner radius family
  'border-radius': { min: 0, max: 32, step: 1 },
  'corner-radius': { min: 0, max: 32, step: 1 },
  'corner-smoothing': { min: 0, max: 1, step: 0.05 },

  // Typography
  'font-size': { min: 8, max: 72, step: 1 },
  'font-weight': { min: 100, max: 900, step: 100 },
  'line-height': { min: 0.8, max: 2.4, step: 0.05 },
  'letter-spacing': { min: -0.05, max: 0.2, step: 0.005 },

  // Spacing — 4pt scale
  'padding': { min: 0, max: 128, step: 4 },
  'padding-top': { min: 0, max: 128, step: 4 },
  'padding-right': { min: 0, max: 128, step: 4 },
  'padding-bottom': { min: 0, max: 128, step: 4 },
  'padding-left': { min: 0, max: 128, step: 4 },
  'margin': { min: 0, max: 128, step: 4 },
  'margin-top': { min: 0, max: 128, step: 4 },
  'margin-right': { min: 0, max: 128, step: 4 },
  'margin-bottom': { min: 0, max: 128, step: 4 },
  'margin-left': { min: 0, max: 128, step: 4 },
  'gap': { min: 0, max: 64, step: 4 },

  // Sizing
  'width': { min: 0, max: 1440, step: 1 },
  'height': { min: 0, max: 1440, step: 1 },
  'min-width': { min: 0, max: 1440, step: 1 },
  'max-width': { min: 0, max: 1440, step: 1 },
  'min-height': { min: 44, max: 1440, step: 1 }, // 44 = WCAG touch target floor
  'max-height': { min: 0, max: 1440, step: 1 },

  // Stroke / border
  'border-width': { min: 0, max: 8, step: 1 },
  'stroke-weight': { min: 0, max: 8, step: 1 },

  // Shadow / elevation
  'shadow-blur': { min: 0, max: 64, step: 2 },
  'shadow-offset-y': { min: -32, max: 32, step: 1 },
  'shadow-spread': { min: -16, max: 16, step: 1 },

  // Rotation / scale
  'rotation': { min: -180, max: 180, step: 1 },
  'scale': { min: 0.5, max: 2, step: 0.1 },
};

export const SLIDER_DEFAULTS_FALLBACK: SliderDefaults = { min: 0, max: 100, step: 1 };

export function inferSliderDefaults(prop: string): SliderDefaults {
  if (!prop || typeof prop !== 'string') return SLIDER_DEFAULTS_FALLBACK;
  return PROP_DEFAULTS[prop] ?? SLIDER_DEFAULTS_FALLBACK;
}

/** Test hook — full prop coverage list for contract assertions. */
export function listKnownSliderProps(): string[] {
  return Object.keys(PROP_DEFAULTS);
}

// ─── Pin #3 — Card-picker kind detection ───────────────────────
//
// Convention: select tweaks targeting `palette.*` token paths get the
// swatch grid; `typography.*` get the type-sample grid. Anything else
// — generic enums, non-token select kinds — falls back to <select>
// dropdown to avoid surprising existing tweaks that expect that shape.
//
// Token-path convention is the single signal because:
//   1. Agent-declared tweaks already namespace token paths consistently
//   2. The card-picker UX is brand-system-aware — palette/typography
//      are the two domains where visual cards beat dropdowns
//   3. Adding more domains later (icon sets, illustration styles) is
//      one new branch, not a refactor

export type CardPickerKind = 'palette' | 'typography' | null;

export interface TweakLike {
  kind?: string;
  op?: {
    type?: string;
    tokenPath?: string;
    [key: string]: unknown;
  };
}

export function getCardPickerKindForTweak(tweak: TweakLike | null | undefined): CardPickerKind {
  if (!tweak || tweak.kind !== 'select') return null;
  if (!tweak.op || tweak.op.type !== 'token') return null;
  const path = (tweak.op.tokenPath || '').toLowerCase();
  if (!path) return null;
  if (path.startsWith('palette.') || path.startsWith('color.')) return 'palette';
  if (path.startsWith('typography.') || path.startsWith('font.')) return 'typography';
  return null;
}

// ─── ID auto-suggest from label ────────────────────────────────
//
// Authoring modal: when the designer types a Label, suggest an ID
// derived from it (slugified). Pure, deterministic — same label
// always produces same suggestion. Caller can override by typing
// in the ID field; this just removes the friction of typing twice.

export function suggestIdFromLabel(label: string): string {
  if (!label || typeof label !== 'string') return '';
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    // ID grammar requires `[a-z]` start — strip leading numeric runs +
    // their trailing separator until a letter appears.
    .replace(/^[0-9]+(-?)/, '')
    .slice(0, 60);
}

/** Validate ID matches the same regex as backend /api/tweaks/declare. */
export function isValidTweakId(id: string): boolean {
  return typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id);
}
