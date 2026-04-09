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
import type { Variable, VariableValue, Color } from '../engine/types';
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

  // Optionally add dark mode
  let darkModeId: string | undefined;
  if (options.darkMode) {
    darkModeId = `mode-dark-${Date.now()}`;
    collection.modes.push({ modeId: darkModeId, name: MODE_DARK });
  }

  const index: TokenIndex = {
    collectionId: collection.id,
    tokens: new Map(),
    modeIds: { light: lightModeId, dark: darkModeId },
  };

  // Helper: create a variable and register in index
  function addToken(name: string, type: 'COLOR' | 'FLOAT' | 'STRING', lightValue: VariableValue, darkValue?: VariableValue): Variable {
    const variable = graph.createVariable(name, type, collection.id, lightValue);

    // Set dark mode value if applicable
    if (darkModeId) {
      variable.valuesByMode[darkModeId] = darkValue ?? lightValue;
    }

    index.tokens.set(name, variable.id);
    return variable;
  }

  // ── Color tokens ────────────────────────────────────────────
  if (ds.colors.roles) {
    for (const [role, hex] of ds.colors.roles) {
      const color = hexToColor(hex);
      const darkColor = options.darkMode ? invertColorForDarkMode(color, role) : undefined;
      addToken(`color.${role}`, 'COLOR', color, darkColor);
    }
  }
  // Ensure semantic shortcuts exist
  const semanticColors = ['primary', 'background', 'text', 'accent'] as const;
  for (const role of semanticColors) {
    const value = ds.colors[role];
    if (value && !index.tokens.has(`color.${role}`)) {
      const color = hexToColor(value);
      const darkColor = options.darkMode ? invertColorForDarkMode(color, role) : undefined;
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
