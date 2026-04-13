/**
 * Token Bridge — DesignSystem → VariableCollection
 *
 * Converts parsed DESIGN.md into a SceneGraph VariableCollection
 * with semantic token names that agents can reference directly:
 *
 *   color.primary, color.background, color.text, color.accent, ...
 *   type.hero.size, type.hero.weight, type.hero.lineHeight, ...
 *   space.unit, space.xs, space.sm, space.md, space.lg, space.xl
 *   radius.sm, radius.md, radius.lg, radius.full
 *
 * Tokens are SceneGraph Variables under the hood — full mode support
 * (light/dark), alias chains, and per-node binding.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { Variable, VariableValue, Color, VariableCollection } from '../engine/types';
import type { DesignSystem } from './types';

// ─── Constants ──────────────────────────────────────────────

export const TOKEN_COLLECTION_NAME = 'design-tokens';
export const MODE_LIGHT = 'light';
export const MODE_DARK = 'dark';

// ─── Token name helpers ─────────────────────────────────────

/** CSS-variable-safe name: color.primary → --color-primary */
export function tokenToCssVar(tokenName: string): string {
  return `--${tokenName.replace(/\./g, '-')}`;
}

/** Reverse: --color-primary → color.primary */
export function cssVarToToken(cssVar: string): string {
  return cssVar.replace(/^--/, '').replace(/-/g, '.');
}

// ─── Hex parsing ────────────────────────────────────────────

function hexToColor(hex: string): Color {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  if (h.length === 4) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]+h[3]+h[3];
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

export function colorToHex(c: Color): string {
  const r = Math.round(c.r * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.g * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.b * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

// ─── Token index ────────────────────────────────────────────

/** In-memory index: token name → variable ID for fast lookup. */
export interface TokenIndex {
  collectionId: string;
  tokens: Map<string, string>;  // name → variableId
  modeIds: { light: string; dark?: string };
}

/**
 * Rebuild a TokenIndex from a SceneGraph that already has a
 * `design-tokens` VariableCollection. Used when an MCP session is
 * rehydrated from disk (stdio harness forks a fresh Node process per
 * request and the in-memory TokenIndex sidecar vanishes, but the
 * graph's variableCollections survive via scene serialization). With
 * this helper, `setMode` can reconstruct the index instead of failing
 * with "no tokens defined (run defineTokens first)".
 *
 * Returns undefined if the graph has no design-tokens collection.
 */
export function rebuildTokenIndexFromGraph(graph: SceneGraph): TokenIndex | undefined {
  let tokenCollection: VariableCollection | undefined;
  for (const col of graph.variableCollections.values()) {
    if (col.name === TOKEN_COLLECTION_NAME) {
      tokenCollection = col;
      break;
    }
  }
  if (!tokenCollection) return undefined;

  const tokens = new Map<string, string>();
  for (const v of graph.variables.values()) {
    if (v.collectionId === tokenCollection.id) {
      tokens.set(v.name, v.id);
    }
  }

  const lightMode = tokenCollection.modes.find(m => m.name === MODE_LIGHT);
  const darkMode = tokenCollection.modes.find(m => m.name === MODE_DARK);
  if (!lightMode) return undefined;

  return {
    collectionId: tokenCollection.id,
    tokens,
    modeIds: { light: lightMode.modeId, dark: darkMode?.modeId },
  };
}

// ─── Main: DesignSystem → Tokens ────────────────────────────

export interface TokenizeOptions {
  /** If true, create a dark mode with auto-inverted colors. Default false. */
  darkMode?: boolean;
}

/**
 * Convert a DesignSystem into SceneGraph Variables.
 * Returns a TokenIndex for fast name→id lookup.
 *
 * Token naming convention:
 *   color.<role>        — color.primary, color.background, color.text, etc.
 *   type.<role>.size    — type.hero.size = 72
 *   type.<role>.weight  — type.hero.weight = 700
 *   type.<role>.lineHeight — type.hero.lineHeight = 1.07
 *   type.<role>.letterSpacing — type.hero.letterSpacing = -2.16
 *   type.<role>.family  — type.hero.family = "Inter"
 *   space.unit          — base spacing unit (e.g. 8)
 *   space.xs/sm/md/lg/xl — derived spacing (unit*0.5, unit*1, unit*2, unit*3, unit*5)
 *   radius.<scale_idx>  — radius.0 = 0, radius.1 = 4, radius.2 = 8, ...
 *   radius.sm/md/lg/full — semantic aliases
 */
export function tokenizeDesignSystem(
  graph: SceneGraph,
  ds: DesignSystem,
  options: TokenizeOptions = {},
): TokenIndex {
  const collection = graph.createCollection(TOKEN_COLLECTION_NAME);
  const lightModeId = collection.defaultModeId;

  // Rename default mode to "light"
  const mode = collection.modes[0];
  if (mode) mode.name = MODE_LIGHT;

  // Always add a dark mode collection so `setMode: 'dark'` works out of the box.
  // Values mirror light unless an explicit dark override is supplied; color roles
  // get inverted via invertColorForDarkMode() when options.darkMode is true.
  const darkModeId: string = `mode-dark-${Date.now()}`;
  collection.modes.push({ modeId: darkModeId, name: MODE_DARK });
  const generateDarkOverrides = options.darkMode !== false;

  const index: TokenIndex = {
    collectionId: collection.id,
    tokens: new Map(),
    modeIds: { light: lightModeId, dark: darkModeId },
  };

  // Helper: create a variable and register in index
  function addToken(name: string, type: 'COLOR' | 'FLOAT' | 'STRING', lightValue: VariableValue, darkValue?: VariableValue): Variable {
    const variable = graph.createVariable(name, type, collection.id, lightValue);
    // Always populate dark mode — either with provided override or mirror of light.
    variable.valuesByMode[darkModeId] = darkValue ?? lightValue;
    index.tokens.set(name, variable.id);
    return variable;
  }

  // ── Color tokens ────────────────────────────────────────────
  if (ds.colors.roles) {
    for (const [role, hex] of ds.colors.roles) {
      const color = hexToColor(hex);
      const darkColor = generateDarkOverrides ? invertColorForDarkMode(color, role) : undefined;
      addToken(`color.${role}`, 'COLOR', color, darkColor);
    }
  }
  // Ensure semantic shortcuts exist
  const semanticColors = ['primary', 'background', 'text', 'accent'] as const;
  for (const role of semanticColors) {
    const value = ds.colors[role];
    if (value && !index.tokens.has(`color.${role}`)) {
      const color = hexToColor(value);
      const darkColor = generateDarkOverrides ? invertColorForDarkMode(color, role) : undefined;
      addToken(`color.${role}`, 'COLOR', color, darkColor);
    }
  }

  // ── Typography tokens ───────────────────────────────────────
  for (const rule of ds.typography.hierarchy) {
    addToken(`type.${rule.role}.size`, 'FLOAT', rule.fontSize);
    addToken(`type.${rule.role}.weight`, 'FLOAT', rule.fontWeight);
    addToken(`type.${rule.role}.lineHeight`, 'FLOAT', rule.lineHeight);
    addToken(`type.${rule.role}.letterSpacing`, 'FLOAT', rule.letterSpacing);
    if (rule.fontFamily) {
      addToken(`type.${rule.role}.family`, 'STRING', rule.fontFamily);
    }
  }

  // ── Spacing tokens ──────────────────────────────────────────
  const unit = ds.layout.spacingUnit;
  if (unit > 0) {
    addToken('space.unit', 'FLOAT', unit);
    addToken('space.xs', 'FLOAT', Math.round(unit * 0.5));
    addToken('space.sm', 'FLOAT', unit);
    addToken('space.md', 'FLOAT', unit * 2);
    addToken('space.lg', 'FLOAT', unit * 3);
    addToken('space.xl', 'FLOAT', unit * 5);
    addToken('space.xxl', 'FLOAT', unit * 8);
  }

  // ── Radius tokens ──────────────────────────────────────────
  const scale = ds.layout.borderRadiusScale;
  for (let i = 0; i < scale.length; i++) {
    addToken(`radius.${i}`, 'FLOAT', scale[i]);
  }
  // Semantic aliases based on scale size
  if (scale.length >= 3) {
    addToken('radius.sm', 'FLOAT', scale[Math.min(1, scale.length - 1)]);
    addToken('radius.md', 'FLOAT', scale[Math.min(2, scale.length - 1)]);
    addToken('radius.lg', 'FLOAT', scale[Math.min(Math.floor(scale.length * 0.7), scale.length - 1)]);
  }
  // Pill/full
  const fullRadius = scale.find(r => r >= 9999) ?? 9999;
  addToken('radius.full', 'FLOAT', fullRadius);

  // ── Spacing scale tokens ────────────────────────────────────
  if (ds.layout.spacingScale && ds.layout.spacingScale.length > 0) {
    for (const val of ds.layout.spacingScale) {
      addToken(`space.${val}`, 'FLOAT', val);
    }
  }
  if (ds.layout.sectionSpacing) {
    addToken('space.section', 'FLOAT', ds.layout.sectionSpacing);
  }
  if (ds.layout.maxWidth) {
    addToken('layout.maxWidth', 'FLOAT', ds.layout.maxWidth);
  }

  // ── Button tokens ──────────────────────────────────────────
  if (ds.components.button) {
    const btn = ds.components.button;
    addToken('button.radius', 'FLOAT', btn.borderRadius);
    if (btn.fontWeight) addToken('button.fontWeight', 'FLOAT', btn.fontWeight);
    if (btn.textTransform) addToken('button.textTransform', 'STRING', btn.textTransform);

    // Button variants
    if (btn.variants) {
      for (const v of btn.variants) {
        const prefix = `button.${v.name}`;
        if (v.background) addToken(`${prefix}.bg`, 'COLOR', hexToColor(v.background));
        if (v.color) addToken(`${prefix}.color`, 'COLOR', hexToColor(v.color));
        if (v.borderRadius != null) addToken(`${prefix}.radius`, 'FLOAT', v.borderRadius);
        if (v.fontWeight) addToken(`${prefix}.fontWeight`, 'FLOAT', v.fontWeight);
        if (v.fontSize) addToken(`${prefix}.fontSize`, 'FLOAT', v.fontSize);
        if (v.paddingX != null) addToken(`${prefix}.paddingX`, 'FLOAT', v.paddingX);
        if (v.paddingY != null) addToken(`${prefix}.paddingY`, 'FLOAT', v.paddingY);
        if (v.minHeight) addToken(`${prefix}.minHeight`, 'FLOAT', v.minHeight);
        if (v.hover?.background) addToken(`${prefix}.hoverBg`, 'COLOR', hexToColor(v.hover.background));
      }
    }
  }

  // ── Card tokens ────────────────────────────────────────────
  if (ds.components.card) {
    const card = ds.components.card;
    addToken('card.radius', 'FLOAT', card.borderRadius);
    if (card.background) addToken('card.bg', 'COLOR', hexToColor(card.background));
    if (card.borderColor) addToken('card.borderColor', 'COLOR', hexToColor(card.borderColor));
    if (card.padding) addToken('card.padding', 'FLOAT', card.padding);
  }

  // ── Badge tokens ───────────────────────────────────────────
  if (ds.components.badge) {
    const badge = ds.components.badge;
    addToken('badge.radius', 'FLOAT', badge.borderRadius);
    if (badge.fontSize) addToken('badge.fontSize', 'FLOAT', badge.fontSize);
    if (badge.fontWeight) addToken('badge.fontWeight', 'FLOAT', badge.fontWeight);
    if (badge.paddingX != null) addToken('badge.paddingX', 'FLOAT', badge.paddingX);
    if (badge.paddingY != null) addToken('badge.paddingY', 'FLOAT', badge.paddingY);
    if (badge.background) addToken('badge.bg', 'COLOR', hexToColor(badge.background));
    if (badge.color) addToken('badge.color', 'COLOR', hexToColor(badge.color));
  }

  // ── Input tokens ───────────────────────────────────────────
  if (ds.components.input) {
    const input = ds.components.input;
    addToken('input.radius', 'FLOAT', input.borderRadius);
    if (input.borderColor) addToken('input.borderColor', 'COLOR', hexToColor(input.borderColor));
    if (input.fontSize) addToken('input.fontSize', 'FLOAT', input.fontSize);
    if (input.height) addToken('input.height', 'FLOAT', input.height);
    if (input.focusBorderColor) addToken('input.focusBorderColor', 'COLOR', hexToColor(input.focusBorderColor));
  }

  // ── Nav tokens ─────────────────────────────────────────────
  if (ds.components.nav) {
    const nav = ds.components.nav;
    if (nav.height) addToken('nav.height', 'FLOAT', nav.height);
    if (nav.fontSize) addToken('nav.fontSize', 'FLOAT', nav.fontSize);
    if (nav.fontWeight) addToken('nav.fontWeight', 'FLOAT', nav.fontWeight);
    if (nav.background) addToken('nav.bg', 'COLOR', hexToColor(nav.background));
  }

  // ── Font feature tokens ────────────────────────────────────
  if (ds.typography.fontFeatures && ds.typography.fontFeatures.length > 0) {
    const featureStr = ds.typography.fontFeatures.map(f => f.tag).join(',');
    addToken('type.fontFeatures', 'STRING', featureStr);
  }

  // ── Gradient tokens ────────────────────────────────────────
  if (ds.colors.gradients) {
    for (const [name, css] of ds.colors.gradients) {
      addToken(`gradient.${name}`, 'STRING', css);
    }
  }

  return index;
}

// ─── Dark mode color inversion ──────────────────────────────

function invertColorForDarkMode(color: Color, role: string): Color {
  // Background → make dark
  if (role === 'background' || role === 'surface') {
    return { r: 0.06, g: 0.06, b: 0.06, a: color.a };
  }
  // Text → make light
  if (role === 'text' || role === 'muted') {
    return { r: 0.93, g: 0.93, b: 0.93, a: color.a };
  }
  // Primary/accent — keep hue, boost brightness if too dark
  const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  if (luminance < 0.3) {
    // Lighten: move toward white by ~40%
    return {
      r: Math.min(1, color.r + (1 - color.r) * 0.4),
      g: Math.min(1, color.g + (1 - color.g) * 0.4),
      b: Math.min(1, color.b + (1 - color.b) * 0.4),
      a: color.a,
    };
  }
  return color; // bright colors stay as-is
}

// ─── Resolve token by name ──────────────────────────────────

/**
 * Resolve a token name to its current value.
 * Uses the active mode of the collection.
 */
export function resolveToken(
  graph: SceneGraph,
  index: TokenIndex,
  tokenName: string,
): VariableValue | undefined {
  const varId = index.tokens.get(tokenName);
  if (!varId) return undefined;
  return graph.resolveVariable(varId);
}

/**
 * Resolve a token to a Color value. Returns undefined if not a color token.
 */
export function resolveColorToken(
  graph: SceneGraph,
  index: TokenIndex,
  tokenName: string,
): Color | undefined {
  const varId = index.tokens.get(tokenName);
  if (!varId) return undefined;
  return graph.resolveColorVariable(varId);
}

/**
 * Resolve a token to a number value. Returns undefined if not a number token.
 */
export function resolveNumberToken(
  graph: SceneGraph,
  index: TokenIndex,
  tokenName: string,
): number | undefined {
  const varId = index.tokens.get(tokenName);
  if (!varId) return undefined;
  return graph.resolveNumberVariable(varId);
}

// ─── Bind token to node ─────────────────────────────────────

/**
 * Bind a token to a node property. Also sets the resolved value on the node.
 * Returns the resolved value, or undefined if token not found.
 */
export function bindTokenToNode(
  graph: SceneGraph,
  index: TokenIndex,
  nodeId: string,
  field: string,
  tokenName: string,
): VariableValue | undefined {
  const varId = index.tokens.get(tokenName);
  if (!varId) return undefined;

  graph.bindVariable(nodeId, field, varId);
  return graph.resolveVariable(varId);
}

// ─── Auto-bind tokens to a scene graph ─────────────────────

/**
 * Walk a subtree and bind every node property whose current value matches a
 * registered token. Until this runs, defineTokens creates tokens but no node
 * actually references them, so setMode "dark" updates 0 properties — the
 * agent's report says "121 tokens defined" but nothing changes when modes
 * switch. Auto-binding closes that loop by value-matching:
 *
 *   - SOLID fill colors against `color.*` tokens (exact channel match)
 *   - fontSize / fontWeight against `type.<role>.size|weight` tokens
 *   - padding{Top,Right,Bottom,Left} / itemSpacing against `space.*` and
 *     direct numeric scale tokens (`space.16`, `space.24`, ...)
 *   - cornerRadius against `radius.*` tokens
 *
 * Returns the number of properties that were bound. Idempotent — re-binding a
 * field that already points at the same variable is a no-op.
 */
export function autoBindTokensFromGraph(
  graph: SceneGraph,
  rootId: string,
  index: TokenIndex,
): number {
  // Build value→variableId reverse lookups once.
  const colorByHex = new Map<string, string>();      // "#ff0000" → varId
  const numberByValue = new Map<number, string[]>(); // value → [varId, ...]
  for (const [name, varId] of index.tokens) {
    const variable = graph.variables.get(varId);
    if (!variable) continue;
    const value = graph.resolveVariable(varId);
    if (value === undefined) continue;
    if (variable.type === 'COLOR' && typeof value === 'object' && 'r' in value) {
      colorByHex.set(colorToHex(value as Color).toLowerCase(), varId);
    } else if (variable.type === 'FLOAT' && typeof value === 'number') {
      const list = numberByValue.get(value) ?? [];
      list.push(varId);
      numberByValue.set(value, list);
    }
    // Bias number lookups: prefer variables in the more semantic namespace
    // (`type.*`, `space.*`, `radius.*`) over generic ones when the same number
    // is registered multiple times. The list is walked in insertion order.
    void name;
  }

  let bound = 0;
  const bindIfFree = (nodeId: string, field: string, varId: string) => {
    const node = graph.getNode(nodeId);
    if (!node) return;
    if (node.boundVariables[field] === varId) return; // already bound
    graph.bindVariable(nodeId, field, varId);
    bound++;
  };

  function walk(nodeId: string) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    // Color fills
    const fills = node.fills as any[] | undefined;
    if (Array.isArray(fills)) {
      for (let i = 0; i < fills.length; i++) {
        const fill = fills[i];
        if (!fill || fill.type !== 'SOLID' || !fill.color) continue;
        const hex = colorToHex(fill.color as Color).toLowerCase();
        const varId = colorByHex.get(hex);
        if (varId) bindIfFree(nodeId, `fills[${i}].color`, varId);
      }
    }

    // Font size / weight (text only)
    if (node.type === 'TEXT') {
      const fs = (node as any).fontSize;
      if (typeof fs === 'number') {
        const varId = numberByValue.get(fs)?.find(id => graph.variables.get(id)?.name.startsWith('type.') && graph.variables.get(id)!.name.endsWith('.size'));
        if (varId) bindIfFree(nodeId, 'fontSize', varId);
      }
      const fw = (node as any).fontWeight;
      if (typeof fw === 'number') {
        const varId = numberByValue.get(fw)?.find(id => graph.variables.get(id)?.name.endsWith('.weight'));
        if (varId) bindIfFree(nodeId, 'fontWeight', varId);
      }
    }

    // Spacing — padding + itemSpacing → space.* tokens
    const numericFields: Array<[string, number | undefined]> = [
      ['paddingTop', (node as any).paddingTop],
      ['paddingRight', (node as any).paddingRight],
      ['paddingBottom', (node as any).paddingBottom],
      ['paddingLeft', (node as any).paddingLeft],
      ['itemSpacing', (node as any).itemSpacing],
    ];
    for (const [field, val] of numericFields) {
      if (typeof val !== 'number' || val === 0) continue;
      const varId = numberByValue.get(val)?.find(id => graph.variables.get(id)?.name.startsWith('space.'));
      if (varId) bindIfFree(nodeId, field, varId);
    }

    // Corner radius → radius.* tokens
    const cr = (node as any).cornerRadius;
    if (typeof cr === 'number' && cr !== 0) {
      const varId = numberByValue.get(cr)?.find(id => graph.variables.get(id)?.name.startsWith('radius.'));
      if (varId) bindIfFree(nodeId, 'cornerRadius', varId);
    }

    for (const childId of node.childIds) walk(childId);
  }

  walk(rootId);
  return bound;
}

// ─── Semantic rebrand ───────────────────────────────────────

// Luminance (WCAG 2.1 relative luminance)
function channelLuminance(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relativeLuminance(c: Color): number {
  return 0.2126 * channelLuminance(c.r) + 0.7152 * channelLuminance(c.g) + 0.0722 * channelLuminance(c.b);
}
function contrastRatio(a: Color, b: Color): number {
  const la = relativeLuminance(a) + 0.05;
  const lb = relativeLuminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}
function isDark(c: Color): boolean {
  return relativeLuminance(c) < 0.2;
}

/**
 * Role-based semantic mapping: SemanticRole → token names.
 * Each role has a "light" and "dark" variant — the engine picks
 * based on scene polarity so text always contrasts with backgrounds.
 */
interface RoleColorMapping {
  /** Fill token for light-themed scenes */
  fill?: string;
  /** Text token candidates — best contrast wins */
  textCandidates: string[];
  /** Fill is an accent/interactive color (always applied regardless of polarity) */
  accentFill?: boolean;
}

const ROLE_MAPPINGS: Record<string, RoleColorMapping> = {
  // Structure — backgrounds adapt to polarity
  section:  { fill: 'color.background', textCandidates: ['color.text', 'color.background'] },
  hero:     { fill: 'color.background', textCandidates: ['color.text', 'color.background'] },
  header:   { fill: 'color.background', textCandidates: ['color.text', 'color.background'] },
  footer:   { fill: 'color.background', textCandidates: ['color.text', 'color.background'] },
  nav:      { fill: 'color.background', textCandidates: ['color.text', 'color.background'] },
  sidebar:  { fill: 'color.background', textCandidates: ['color.text', 'color.background'] },
  main:     { fill: 'color.background', textCandidates: ['color.text', 'color.background'] },
  card:     { fill: 'color.surface',    textCandidates: ['color.text', 'color.background'] },
  modal:    { fill: 'color.surface',    textCandidates: ['color.text', 'color.background'] },
  toast:    { fill: 'color.surface',    textCandidates: ['color.text', 'color.background'] },

  // Interactive — accent fill always applies
  button:   { fill: 'color.primary',    textCandidates: ['color.on-primary', 'color.background', 'color.text'], accentFill: true },
  cta:      { fill: 'color.primary',    textCandidates: ['color.on-primary', 'color.background', 'color.text'], accentFill: true },
  link:     { textCandidates: ['color.primary'] },

  // Text — no fill, contrast-aware text
  heading:  { textCandidates: ['color.text', 'color.background'] },
  paragraph:{ textCandidates: ['color.text', 'color.background'] },
  label:    { textCandidates: ['color.text-secondary', 'color.text', 'color.background'] },
  caption:  { textCandidates: ['color.text-secondary', 'color.text', 'color.background'] },

  // Components — accent fill always applies
  badge:    { fill: 'color.accent',     textCandidates: ['color.on-accent', 'color.background', 'color.text'], accentFill: true },
  tag:      { fill: 'color.accent',     textCandidates: ['color.on-accent', 'color.background', 'color.text'], accentFill: true },
  input:    { fill: 'color.surface',    textCandidates: ['color.text', 'color.background'] },
  divider:  { fill: 'color.border',     textCandidates: [] },
};

/**
 * Rebrand a scene by mapping semantic roles → brand color tokens.
 *
 * Unlike `autoBindTokensFromGraph` (which matches by current value),
 * this function OVERWRITES fills and text colors based on what the
 * node IS (its semanticRole). This is the engine behind "change brand
 * with one button".
 *
 * Contrast-aware strategy:
 *  1. Detect scene polarity (dark vs light) from root background.
 *  2. Detect brand polarity from color.background token.
 *  3. If polarities conflict (dark scene + light brand), skip structure
 *     fill changes — only apply accent/interactive colors. This preserves
 *     the scene's visual character while injecting brand identity.
 *  4. For every TEXT node, pick the text color candidate with the best
 *     contrast against the node's effective background (walking up ancestors).
 *  5. If no candidate achieves 3:1 contrast, auto-correct toward
 *     white or black (whichever is closer to the brand's text color).
 *
 * Returns the number of properties rebranded.
 */
export function rebrandColorsFromTokens(
  graph: SceneGraph,
  rootId: string,
  index: TokenIndex,
  options: { textOnly?: boolean } = {},
): number {
  let rebranded = 0;
  const textOnly = options.textOnly === true;

  // ── Resolve helpers ──────────────────────────────────────────

  function resolveColor(tokenName: string): { color: Color; varId: string } | undefined {
    const varId = index.tokens.get(tokenName);
    if (varId) {
      const val = graph.resolveVariable(varId);
      if (val && typeof val === 'object' && 'r' in val) {
        return { color: val as Color, varId };
      }
    }
    return undefined;
  }

  const FALLBACKS: Record<string, string[]> = {
    'color.surface':        ['color.background'],
    'color.on-primary':     ['color.background', 'color.text'],
    'color.on-accent':      ['color.background', 'color.text'],
    'color.text-secondary': ['color.text'],
    'color.border':         ['color.text-secondary', 'color.text'],
  };

  function resolveWithFallback(tokenName: string): { color: Color; varId: string } | undefined {
    const direct = resolveColor(tokenName);
    if (direct) return direct;
    const fallbacks = FALLBACKS[tokenName];
    if (fallbacks) {
      for (const fb of fallbacks) {
        const result = resolveColor(fb);
        if (result) return result;
      }
    }
    return undefined;
  }

  // ── Polarity detection ───────────────────────────────────────

  const root = graph.getNode(rootId);
  const rootFills = root ? (root as any).fills as any[] | undefined : undefined;
  const rootBg: Color = (rootFills?.[0]?.type === 'SOLID' && rootFills[0].color)
    ? rootFills[0].color
    : { r: 1, g: 1, b: 1, a: 1 }; // assume white if no fill
  const sceneDark = isDark(rootBg);

  const brandBg = resolveColor('color.background');
  const brandDark = brandBg ? isDark(brandBg.color) : false;

  // Polarity match: scene and brand are same theme (both dark or both light).
  // When mismatched, we skip structural fill changes to preserve the scene's
  // visual character — only accent colors and contrast-corrected text apply.
  const polarityMatch = sceneDark === brandDark;

  // ── Effective background lookup ──────────────────────────────

  /** Walk ancestors (starting from parent) to find the nearest solid fill.
   * Skip the node itself — for TEXT nodes, fills[0] IS the text color,
   * not the background. We need the ancestor's fill for contrast calculation. */
  function getEffectiveBackground(nodeId: string): Color {
    const startNode = graph.getNode(nodeId);
    if (!startNode) return rootBg;
    let current: string | undefined = (startNode as any).parentId as string | undefined;
    while (current) {
      const n = graph.getNode(current);
      if (!n) break;
      const fills = (n as any).fills as any[] | undefined;
      if (Array.isArray(fills) && fills.length > 0 && fills[0]?.type === 'SOLID' && fills[0]?.color) {
        const c = fills[0].color as Color;
        // Skip nearly transparent fills
        if ((c.a ?? 1) > 0.5) return c;
      }
      // Walk up — parentId is available on INode
      const parentId = (n as any).parentId as string | undefined;
      if (!parentId || parentId === current) break;
      current = parentId;
    }
    return rootBg; // fallback to root
  }

  // ── Apply fill ───────────────────────────────────────────────

  function applyFill(nodeId: string, tokenName: string): Color | undefined {
    const resolved = resolveWithFallback(tokenName);
    if (!resolved) return undefined;
    const node = graph.getNode(nodeId);
    if (!node) return undefined;
    const fills = (node as any).fills as any[] | undefined;
    if (Array.isArray(fills) && fills.length > 0 && fills[0]?.type === 'SOLID') {
      fills[0].color = { ...resolved.color };
      graph.bindVariable(nodeId, 'fills[0].color', resolved.varId);
      rebranded++;
      return resolved.color;
    }
    return undefined;
  }

  // ── Apply text with contrast awareness ───────────────────────

  /**
   * Pick the best text color from candidates, maximizing contrast
   * against the effective background. If no candidate achieves 3:1,
   * auto-correct toward white (on dark bg) or black (on light bg).
   */
  function applyTextContrastAware(nodeId: string, candidates: string[]): void {
    const node = graph.getNode(nodeId);
    if (!node || node.type !== 'TEXT') return;
    const fills = (node as any).fills as any[] | undefined;
    if (!Array.isArray(fills) || fills.length === 0 || fills[0]?.type !== 'SOLID') return;

    const bg = getEffectiveBackground(nodeId);

    // Evaluate all candidates, pick best contrast
    let best: { color: Color; varId: string; contrast: number } | undefined;
    for (const tokenName of candidates) {
      const resolved = resolveWithFallback(tokenName);
      if (!resolved) continue;
      const cr = contrastRatio(resolved.color, bg);
      if (!best || cr > best.contrast) {
        best = { color: resolved.color, varId: resolved.varId, contrast: cr };
      }
    }

    if (!best) return;

    // If best contrast is too low, auto-correct toward white or black
    let finalColor = best.color;
    let finalVarId = best.varId;

    if (best.contrast < 3) {
      // Determine correction target: white on dark bg, black on light bg
      const bgDark = isDark(bg);
      const corrected: Color = bgDark
        ? { r: 1, g: 1, b: 1, a: 1 }       // white
        : { r: 0, g: 0, b: 0, a: 1 };      // black

      // Check if any token matches the correction direction better
      const correctedCr = contrastRatio(corrected, bg);
      if (correctedCr > best.contrast) {
        // Try to find a token that's close to the correction target
        // (prefer brand token over raw white/black)
        const altTokens = bgDark
          ? ['color.background', 'color.text']  // on dark bg, try background (often white)
          : ['color.text', 'color.background']; // on light bg, try text (often dark)
        let foundBetter = false;
        for (const alt of altTokens) {
          const resolved = resolveWithFallback(alt);
          if (!resolved) continue;
          const cr = contrastRatio(resolved.color, bg);
          if (cr >= 3 && cr > best.contrast) {
            finalColor = resolved.color;
            finalVarId = resolved.varId;
            foundBetter = true;
            break;
          }
        }
        if (!foundBetter) {
          // No brand token works — use raw white/black but still bind
          // to the closest token for mode-switching support
          finalColor = corrected;
          // Keep the original varId for binding
        }
      }
    }

    fills[0].color = { ...finalColor };
    graph.bindVariable(nodeId, 'fills[0].color', finalVarId);
    rebranded++;
  }

  // ── Default text candidates for unclassified nodes ─────────

  const DEFAULT_TEXT_CANDIDATES = ['color.text', 'color.background'];

  // ── Per-node polarity inversion detector ─────────────────────
  /** True when the node's current fill polarity is OPPOSITE to the scene root.
   * A dark card in a light scene (or a light card in a dark scene) is treated
   * as an intentional authored inversion — the rebrand must preserve it rather
   * than normalizing it to the brand's default surface, which would both erase
   * creative emphasis AND trap any child text at near-1:1 contrast after the
   * background flip (the old Stripe "Team" bug). */
  function nodeInvertsRootPolarity(nodeId: string): boolean {
    const n = graph.getNode(nodeId);
    if (!n) return false;
    const fills = (n as any).fills as any[] | undefined;
    if (!Array.isArray(fills) || fills.length === 0) return false;
    const f = fills[0];
    if (f?.type !== 'SOLID' || !f?.color) return false;
    if ((f.color.a ?? 1) < 0.5) return false;
    const nodeDark = isDark(f.color);
    return nodeDark !== sceneDark;
  }

  // ── Main walk ────────────────────────────────────────────────

  function walk(nodeId: string) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    const role = (node as any).semanticRole as string | null;

    // Detect intentional polarity inversion on this node. Descendant text
    // color stays correct automatically because we skip the structural
    // fill rebrand on this node, so getEffectiveBackground walks up and
    // picks the preserved original fill.
    const invertsPolarity = nodeInvertsRootPolarity(nodeId);

    if (role && ROLE_MAPPINGS[role]) {
      const mapping = ROLE_MAPPINGS[role];

      // Apply fill color (background) — skipped in textOnly mode so that a
      // second pass after applyBrandInheritance can re-run the contrast-
      // aware text selection against the final (inheritance-applied) fills
      // without overwriting them.
      if (!textOnly && mapping.fill) {
        if (mapping.accentFill) {
          // Accent/interactive fills always apply (buttons, badges, CTAs)
          // — even inside an inverted subtree. A purple CTA on a dark card
          // is still a purple CTA.
          applyFill(nodeId, mapping.fill);
        } else if (polarityMatch && !invertsPolarity) {
          // Structure fills only when (a) brand polarity matches scene, AND
          // (b) this specific node isn't an intentional polarity inversion.
          applyFill(nodeId, mapping.fill);
        }
        // Otherwise: skip structure fill — preserve scene character.
      }

      // Apply text color — always contrast-aware. getEffectiveBackground
      // walks ancestors and picks up the preserved inversion fill, so
      // descendants of a dark card in a light scene get white text instead
      // of the brand's on-light heading color collapsing to 1:1 contrast.
      if (mapping.textCandidates.length > 0) {
        applyTextContrastAware(nodeId, mapping.textCandidates);
      }
    } else if (node.type === 'TEXT') {
      // Unclassified text nodes: still apply contrast-aware text coloring.
      // Without this, autoBindTokensFromGraph may have bound their fills
      // to a wrong-polarity color token (e.g. dark token on dark background),
      // producing invisible text. We fix that by evaluating all main text
      // token candidates and picking the one with best contrast.
      applyTextContrastAware(nodeId, DEFAULT_TEXT_CANDIDATES);
    }

    for (const childId of node.childIds) walk(childId);
  }

  walk(rootId);
  return rebranded;
}

// ─── Switch mode ────────────────────────────────────────────

/**
 * Switch the active mode for the token collection (e.g. light → dark).
 * Returns the mode ID that was activated.
 */
export function switchTokenMode(
  graph: SceneGraph,
  index: TokenIndex,
  modeName: string,
): string | undefined {
  const collection = graph.variableCollections.get(index.collectionId);
  if (!collection) return undefined;

  const mode = collection.modes.find(m => m.name === modeName);
  if (!mode) return undefined;

  graph.activeMode.set(index.collectionId, mode.modeId);
  return mode.modeId;
}

// ─── List tokens ────────────────────────────────────────────

export interface TokenInfo {
  name: string;
  type: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  value: VariableValue | undefined;
  cssVar: string;
}

/**
 * List all tokens with current resolved values.
 */
export function listTokens(
  graph: SceneGraph,
  index: TokenIndex,
): TokenInfo[] {
  const result: TokenInfo[] = [];
  for (const [name, varId] of index.tokens) {
    const variable = graph.variables.get(varId);
    if (!variable) continue;
    result.push({
      name,
      type: variable.type,
      value: graph.resolveVariable(varId),
      cssVar: tokenToCssVar(name),
    });
  }
  return result;
}

// ─── Collect bound tokens for CSS export ────────────────────

/**
 * Collect all variable bindings in a subtree and return
 * a map of CSS custom properties → resolved CSS values.
 * Used by HTML exporter to generate :root { --token: value } block.
 */
export function collectCssTokens(
  graph: SceneGraph,
  rootId: string,
): Map<string, string> {
  const cssVars = new Map<string, string>();
  const visited = new Set<string>();

  function walk(nodeId: string) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    for (const [field, varId] of Object.entries(node.boundVariables)) {
      if (visited.has(varId)) continue;
      visited.add(varId);

      const variable = graph.variables.get(varId);
      if (!variable) continue;

      const value = graph.resolveVariable(varId);
      if (value === undefined) continue;

      const cssVarName = tokenToCssVar(variable.name);
      cssVars.set(cssVarName, variableValueToCss(value, variable.type));
    }

    for (const childId of node.childIds) walk(childId);
  }

  walk(rootId);
  return cssVars;
}

/**
 * Convert a VariableValue to a CSS string.
 */
function variableValueToCss(value: VariableValue, type: string): string {
  if (type === 'COLOR' && typeof value === 'object' && 'r' in value) {
    return colorToHex(value as Color);
  }
  if (typeof value === 'number') {
    return `${value}`;
  }
  if (typeof value === 'string') return value;
  return String(value);
}

// ─── Check if node property is token-bound ──────────────────

/**
 * Check if a node's property is bound to a variable in the token collection.
 */
export function isTokenBound(
  graph: SceneGraph,
  index: TokenIndex,
  nodeId: string,
  field: string,
): boolean {
  const node = graph.getNode(nodeId);
  if (!node) return false;
  const varId = node.boundVariables[field];
  if (!varId) return false;
  const variable = graph.variables.get(varId);
  if (!variable) return false;
  return variable.collectionId === index.collectionId;
}
