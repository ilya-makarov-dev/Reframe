/**
 * Brand inheritance — apply full component recipes from DESIGN.md.
 *
 * Where `rebrandColorsFromTokens` changes only fills based on semantic roles,
 * `applyBrandInheritance` applies the FULL component spec: padding, radius,
 * typography hierarchy, shadow elevation, font weights, letter-spacing,
 * text-case. This is what makes a "Stripe button" actually look like a Stripe
 * button and not just a Ferrari button with Stripe purple.
 *
 * Pipeline (applied in order):
 *
 *   1. Typography hierarchy — for each TEXT node with a semantic role, look
 *      up the brand's TypographyRule and apply fontFamily/fontSize/fontWeight/
 *      lineHeight/letterSpacing/textCase/fontFeatures.
 *
 *   2. Component recipes — for each node with a component role (button, card,
 *      badge, input, nav), apply the brand's spec:
 *        button → radius, padding, textCase, fontWeight (+ variant selection)
 *        card   → radius, padding, shadow, background, border
 *        badge  → radius, padding, fontSize, fontWeight, background, color
 *        input  → radius, padding, border, background
 *        nav    → height, background, borderBottom, fontSize, fontWeight
 *
 *   3. Shadow elevation — nodes with existing shadows get replaced by the
 *      brand's elevation level 1 stack (if depth is defined).
 *
 *   4. Root polarity — if the brand is light but the scene is dark (or vice
 *      versa), DON'T flip the root. The caller (rebrandColorsFromTokens)
 *      already handles polarity mismatches for colors. Inheritance only
 *      touches components, never top-level frames.
 *
 * Returns a detailed count of mutations by category.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type {
  DesignSystem,
  TypographyRule,
  ButtonSpec,
  ButtonVariant,
  CardSpec,
  BadgeSpec,
  InputSpec,
  NavSpec,
  ShadowLayer,
} from './types';
import type { Color } from '../engine/types';

// ─── Role → typography mapping ──────────────────────────────

/**
 * Map SemanticRole → TypographyRole. The typography hierarchy in DESIGN.md
 * uses roles like 'hero', 'title', 'body'; our scene graph uses 'heading',
 * 'paragraph', 'button'. This table bridges them.
 */
const SEMANTIC_TO_TYPO_ROLE: Record<string, string[]> = {
  heading:   ['hero', 'title', 'subtitle'],
  paragraph: ['body', 'subtitle'],
  label:     ['caption', 'body'],
  caption:   ['caption', 'disclaimer'],
  button:    ['button'],
  cta:       ['button'],
  link:      ['body', 'button'],
  badge:     ['caption'],
  tag:       ['caption'],
};

function findTypoRule(ds: DesignSystem, semanticRole: string): TypographyRule | undefined {
  const candidates = SEMANTIC_TO_TYPO_ROLE[semanticRole];
  if (!candidates) return undefined;
  for (const typoRole of candidates) {
    const rule = ds.typography.hierarchy.find(r => r.role === typoRole);
    if (rule) return rule;
  }
  return undefined;
}

// ─── Color parsing ──────────────────────────────────────────

function hexToColor(hex: string): Color | undefined {
  if (!hex) return undefined;
  let h = hex.replace(/^#/, '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length === 4) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return undefined;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  if (isNaN(r) || isNaN(g) || isNaN(b)) return undefined;
  return { r, g, b, a };
}

function cssColorToColor(value: string | undefined): Color | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v.startsWith('#')) return hexToColor(v);
  const rgba = v.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?))?\s*\)/i);
  if (rgba) {
    return {
      r: parseFloat(rgba[1]) / 255,
      g: parseFloat(rgba[2]) / 255,
      b: parseFloat(rgba[3]) / 255,
      a: rgba[4] !== undefined ? parseFloat(rgba[4]) : 1,
    };
  }
  return undefined;
}

// ─── Shadow conversion ──────────────────────────────────────

/**
 * Convert a DesignSystem ShadowLayer to a reframe DROP_SHADOW effect.
 */
function shadowLayerToEffect(layer: ShadowLayer): any {
  const color = cssColorToColor(layer.color) ?? { r: 0, g: 0, b: 0, a: 0.15 };
  return {
    type: layer.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
    offset: { x: layer.offsetX, y: layer.offsetY },
    blurRadius: layer.blur,
    spread: layer.spread ?? 0,
    color,
    visible: true,
    blendMode: 'NORMAL',
  };
}

// ─── Fill helpers ───────────────────────────────────────────

function setSolidFill(graph: SceneGraph, nodeId: string, color: Color): boolean {
  const node = graph.getNode(nodeId);
  if (!node) return false;
  const existing = (node as any).fills as any[] | undefined;
  const next: any[] = Array.isArray(existing) && existing.length > 0
    ? existing.map((f, i) =>
        i === 0
          ? { ...f, type: 'SOLID', color: { ...color }, visible: true }
          : f,
      )
    : [{ type: 'SOLID', color: { ...color }, visible: true, opacity: 1 }];
  graph.updateNode(nodeId, { fills: next });
  return true;
}

function setBorder(graph: SceneGraph, nodeId: string, hex: string, weight = 1): boolean {
  const color = hexToColor(hex);
  if (!color) return false;
  graph.updateNode(nodeId, {
    strokes: [{
      color,
      weight,
      opacity: 1,
      visible: true,
      align: 'INSIDE',
    }],
  });
  return true;
}

// ─── Result ─────────────────────────────────────────────────

export interface InheritanceResult {
  typography: number;
  buttons: number;
  cards: number;
  badges: number;
  inputs: number;
  navs: number;
  shadows: number;
  total: number;
}

// ─── Main function ──────────────────────────────────────────

export function applyBrandInheritance(
  graph: SceneGraph,
  rootId: string,
  ds: DesignSystem,
): InheritanceResult {
  const result: InheritanceResult = {
    typography: 0,
    buttons: 0,
    cards: 0,
    badges: 0,
    inputs: 0,
    navs: 0,
    shadows: 0,
    total: 0,
  };

  const components = ds.components;
  const buttonSpec = components.button;
  const cardSpec = components.card;
  const badgeSpec = components.badge;
  const inputSpec = components.input;
  const navSpec = components.nav;
  const primaryFont = ds.typography.primaryFont;

  // Pre-compute elevation level 1 shadow stack if depth is defined
  const elevationLevel1 = ds.depth?.elevationLevels?.[1] ?? ds.depth?.elevationLevels?.[0];

  // ─── Typography inheritance ────────────────────────────────

  function applyTypography(nodeId: string, role: string): boolean {
    const node = graph.getNode(nodeId);
    if (!node || node.type !== 'TEXT') return false;

    const rule = findTypoRule(ds, role);
    if (!rule) return false;

    const updates: Record<string, unknown> = {};

    // fontFamily — prefer rule's font, fall back to brand's primary
    const family = rule.fontFamily ?? primaryFont;
    if (family && (node as any).fontFamily !== family) {
      updates.fontFamily = family;
    }

    // fontSize, fontWeight, lineHeight, letterSpacing
    if (rule.fontSize && (node as any).fontSize !== rule.fontSize) {
      updates.fontSize = rule.fontSize;
    }
    if (rule.fontWeight && (node as any).fontWeight !== rule.fontWeight) {
      updates.fontWeight = rule.fontWeight;
    }
    if (rule.lineHeight && typeof rule.lineHeight === 'number') {
      const lh = rule.lineHeight < 10 ? rule.lineHeight * rule.fontSize : rule.lineHeight;
      if ((node as any).lineHeight !== lh) updates.lineHeight = lh;
    }
    if (typeof rule.letterSpacing === 'number' && (node as any).letterSpacing !== rule.letterSpacing) {
      updates.letterSpacing = rule.letterSpacing;
    }

    // textCase (text-transform)
    if (rule.textTransform && rule.textTransform !== 'none') {
      const caseMap: Record<string, string> = {
        uppercase: 'UPPER',
        lowercase: 'LOWER',
        capitalize: 'TITLE',
      };
      const tc = caseMap[rule.textTransform];
      if (tc && (node as any).textCase !== tc) updates.textCase = tc;
    }

    // OpenType font features
    if (rule.fontFeatures && rule.fontFeatures.length > 0) {
      updates.fontFeatureSettings = [...rule.fontFeatures];
    }

    if (Object.keys(updates).length > 0) {
      graph.updateNode(nodeId, updates);
      return true;
    }
    return false;
  }

  // ─── Button inheritance ────────────────────────────────────

  function pickButtonVariant(spec: ButtonSpec, _node: any): ButtonVariant | undefined {
    if (!spec.variants || spec.variants.length === 0) return undefined;
    // Default: first variant (usually "primary"). Without LLM context we can't
    // pick between "primary", "secondary", "ghost" — the first one is the
    // canonical brand voice.
    return spec.variants.find(v => v.name === 'primary') ?? spec.variants[0];
  }

  function applyButton(nodeId: string): boolean {
    if (!buttonSpec) return false;
    const node = graph.getNode(nodeId);
    if (!node) return false;

    const updates: Record<string, unknown> = {};

    // Radius
    if (typeof buttonSpec.borderRadius === 'number') {
      updates.cornerRadius = buttonSpec.borderRadius;
    }

    // Variant-level specs (optional)
    const variant = pickButtonVariant(buttonSpec, node);
    if (variant) {
      if (typeof variant.borderRadius === 'number') updates.cornerRadius = variant.borderRadius;
      if (typeof variant.paddingX === 'number') {
        updates.paddingLeft = variant.paddingX;
        updates.paddingRight = variant.paddingX;
      }
      if (typeof variant.paddingY === 'number') {
        updates.paddingTop = variant.paddingY;
        updates.paddingBottom = variant.paddingY;
      }
      if (typeof variant.minHeight === 'number') {
        updates.minHeight = Math.max(44, variant.minHeight); // WCAG touch target
      }
      if (variant.background) {
        const color = hexToColor(variant.background);
        if (color) {
          setSolidFill(graph, nodeId, color);
        }
      }
      if (variant.borderColor && variant.borderColor !== 'transparent') {
        setBorder(graph, nodeId, variant.borderColor, 1);
      }
    }

    if (Object.keys(updates).length > 0) {
      graph.updateNode(nodeId, updates);
    }

    // Apply text color + uppercase to button children (TEXT nodes)
    if (variant?.color || buttonSpec.textTransform || variant?.textTransform) {
      const textColor = variant?.color ? hexToColor(variant.color) : undefined;
      const textCase = (buttonSpec.textTransform ?? variant?.textTransform) === 'uppercase' ? 'UPPER' : undefined;
      function walkChildren(id: string) {
        const n = graph.getNode(id);
        if (!n) return;
        if (n.type === 'TEXT') {
          const childUpdates: Record<string, unknown> = {};
          if (textColor) {
            setSolidFill(graph, id, textColor);
          }
          if (textCase && (n as any).textCase !== textCase) {
            childUpdates.textCase = textCase;
          }
          if (typeof variant?.fontWeight === 'number') {
            childUpdates.fontWeight = variant.fontWeight;
          }
          if (typeof variant?.fontSize === 'number') {
            childUpdates.fontSize = variant.fontSize;
          }
          if (Object.keys(childUpdates).length > 0) {
            graph.updateNode(id, childUpdates);
          }
        }
        for (const cid of n.childIds) walkChildren(cid);
      }
      for (const cid of node.childIds) walkChildren(cid);
    }

    return true;
  }

  // ─── Card inheritance ──────────────────────────────────────

  function applyCard(nodeId: string): boolean {
    if (!cardSpec) return false;
    const node = graph.getNode(nodeId);
    if (!node) return false;

    const updates: Record<string, unknown> = {};

    if (typeof cardSpec.borderRadius === 'number') {
      updates.cornerRadius = cardSpec.borderRadius;
    }
    if (typeof cardSpec.padding === 'number') {
      updates.paddingTop = cardSpec.padding;
      updates.paddingRight = cardSpec.padding;
      updates.paddingBottom = cardSpec.padding;
      updates.paddingLeft = cardSpec.padding;
    }
    if (cardSpec.background) {
      const color = hexToColor(cardSpec.background);
      if (color) setSolidFill(graph, nodeId, color);
    }
    if (cardSpec.borderColor && cardSpec.borderColor !== 'transparent') {
      setBorder(graph, nodeId, cardSpec.borderColor, 1);
    }

    // Elevation (shadow) — apply brand's elevation level 1 if defined
    if (elevationLevel1 && elevationLevel1.length > 0) {
      const effects = elevationLevel1.map(shadowLayerToEffect);
      updates.effects = effects;
    }

    if (Object.keys(updates).length > 0) {
      graph.updateNode(nodeId, updates);
      return true;
    }
    return false;
  }

  // ─── Badge inheritance ─────────────────────────────────────

  function applyBadge(nodeId: string): boolean {
    if (!badgeSpec) return false;
    const spec = badgeSpec;
    const node = graph.getNode(nodeId);
    if (!node) return false;

    const updates: Record<string, unknown> = {};

    if (typeof spec.borderRadius === 'number') updates.cornerRadius = spec.borderRadius;
    if (typeof spec.paddingX === 'number') {
      updates.paddingLeft = spec.paddingX;
      updates.paddingRight = spec.paddingX;
    }
    if (typeof spec.paddingY === 'number') {
      updates.paddingTop = spec.paddingY;
      updates.paddingBottom = spec.paddingY;
    }
    if (spec.background) {
      const color = hexToColor(spec.background);
      if (color) setSolidFill(graph, nodeId, color);
    }

    if (Object.keys(updates).length > 0) {
      graph.updateNode(nodeId, updates);
    }

    // Apply text color to badge text children
    if (spec.color || typeof spec.fontSize === 'number' || typeof spec.fontWeight === 'number') {
      const textColor = spec.color ? hexToColor(spec.color) : undefined;
      function walkChildren(id: string) {
        const n = graph.getNode(id);
        if (!n) return;
        if (n.type === 'TEXT') {
          const cu: Record<string, unknown> = {};
          if (textColor) setSolidFill(graph, id, textColor);
          if (typeof spec.fontSize === 'number') cu.fontSize = spec.fontSize;
          if (typeof spec.fontWeight === 'number') cu.fontWeight = spec.fontWeight;
          if (Object.keys(cu).length > 0) graph.updateNode(id, cu);
        }
        for (const cid of n.childIds) walkChildren(cid);
      }
      for (const cid of node.childIds) walkChildren(cid);
    }

    return true;
  }

  // ─── Input inheritance ─────────────────────────────────────

  function applyInput(nodeId: string, spec: InputSpec): boolean {
    const updates: Record<string, unknown> = {};
    if (typeof spec.borderRadius === 'number') updates.cornerRadius = spec.borderRadius;
    if (typeof spec.paddingX === 'number') {
      updates.paddingLeft = spec.paddingX;
      updates.paddingRight = spec.paddingX;
    }
    if (typeof spec.height === 'number') updates.minHeight = spec.height;
    if (spec.background) {
      const color = hexToColor(spec.background);
      if (color) setSolidFill(graph, nodeId, color);
    }
    if (spec.borderColor) setBorder(graph, nodeId, spec.borderColor, 1);

    if (Object.keys(updates).length > 0) {
      graph.updateNode(nodeId, updates);
      return true;
    }
    return false;
  }

  // ─── Nav inheritance ───────────────────────────────────────

  function applyNav(nodeId: string, spec: NavSpec): boolean {
    const updates: Record<string, unknown> = {};
    if (typeof spec.height === 'number') updates.height = spec.height;
    if (spec.background) {
      const color = hexToColor(spec.background);
      if (color) setSolidFill(graph, nodeId, color);
    }

    if (Object.keys(updates).length > 0) {
      graph.updateNode(nodeId, updates);
      return true;
    }
    return false;
  }

  // ─── Structural role inference ─────────────────────────────

  /**
   * Detect component roles from visual structure — independent of the
   * banner classifier. The classifier only recognizes title/description/
   * button/background/ageRating, so long-form pages (marketplaces,
   * dashboards) miss buttons, cards, badges, inputs, and nav bars.
   *
   * Heuristics:
   *   nav    — top-level child of root, full-width, height 56-96px
   *   button — frame with 1 TEXT child, width 60-320px, height 36-72px,
   *            cornerRadius >= min(width,height)/4, has fill
   *   badge  — small frame (width < 200px, height < 40px) with 1 TEXT
   *            child, radius >= 2, padding < 16
   *   card   — frame with >= 2 children, has fill or shadow, radius 4-24,
   *            padding >= 12, width 200-600px
   *   input  — frame with 1 TEXT child (placeholder-ish), has stroke or
   *            muted fill, radius 4-9999, width >= 200px, height 36-60px
   */
  function inferStructuralRole(nodeId: string, node: any, isRootChild: boolean): string | undefined {
    if (node.type === 'TEXT') return undefined;

    const w: number = node.width ?? 0;
    const h: number = node.height ?? 0;
    const cr: number = Math.max(
      node.cornerRadius ?? 0,
      node.topLeftRadius ?? 0,
      node.topRightRadius ?? 0,
      node.bottomLeftRadius ?? 0,
      node.bottomRightRadius ?? 0,
    );

    const fills = node.fills as any[] | undefined;
    const hasFill = Array.isArray(fills) && fills.length > 0 && fills[0]?.visible !== false && fills[0]?.type === 'SOLID';
    const strokes = node.strokes as any[] | undefined;
    const hasStroke = Array.isArray(strokes) && strokes.length > 0 && strokes[0]?.visible !== false;
    const effects = node.effects as any[] | undefined;
    const hasShadow = Array.isArray(effects) && effects.some(e => e?.type === 'DROP_SHADOW' || e?.type === 'INNER_SHADOW');

    const children = node.childIds ?? [];
    const textChildren = children.filter((cid: string) => {
      const c = graph.getNode(cid);
      return c && c.type === 'TEXT';
    });

    const padH = Math.max(node.paddingLeft ?? 0, node.paddingRight ?? 0);
    const padV = Math.max(node.paddingTop ?? 0, node.paddingBottom ?? 0);
    const aspectRatio = h > 0 ? w / h : 0;

    // Check if a text child looks like a placeholder (ends with "…", contains "search"/"enter")
    function hasPlaceholderText(): boolean {
      for (const cid of textChildren) {
        const t = graph.getNode(cid) as any;
        const chars: string = (t?.characters ?? '').toLowerCase();
        if (!chars) continue;
        if (chars.endsWith('…') || chars.endsWith('...')) return true;
        if (/^(search|enter|type|min |max |your |email|e-?mail|password|\$|\d|filter)/i.test(chars)) return true;
      }
      return false;
    }

    // nav — top-level root child, wide and short
    if (isRootChild && w >= 1000 && h >= 48 && h <= 120) {
      return 'nav';
    }

    // input — placeholder text OR very wide/short aspect (>5:1)
    // Checked BEFORE button so a long search bar doesn't claim button role.
    const looksLikeInput =
      textChildren.length >= 1 &&
      w >= 120 && h >= 28 && h <= 72 &&
      cr >= 2 && cr <= 9999 &&
      (hasStroke || hasFill) &&
      padH >= 6 &&
      (hasPlaceholderText() || aspectRatio >= 5);
    if (looksLikeInput && children.length <= 4) return 'input';

    // button — frame with text, rounded, has fill, medium size
    const looksLikeButton =
      textChildren.length >= 1 &&
      textChildren.length === children.length &&
      w >= 60 && w <= 400 &&
      h >= 32 && h <= 72 &&
      cr >= Math.min(4, Math.min(w, h) / 4) &&
      (hasFill || hasStroke) &&
      padV <= 24 &&
      aspectRatio < 6; // long thin bars are not buttons
    if (looksLikeButton) return 'button';

    // badge — small, rounded, single text
    const looksLikeBadge =
      textChildren.length === 1 &&
      textChildren.length === children.length &&
      w > 0 && w <= 200 &&
      h > 0 && h <= 40 &&
      cr >= 2 &&
      (hasFill || hasStroke) &&
      padV <= 8;
    if (looksLikeBadge) return 'badge';

    // card — container with shadow or fill, multiple children, modest radius.
    // The outer frame of a card may have padding=0 (inner content div holds
    // the padding), so we don't require padV ≥ 8. Having a shadow OR having
    // an inner child with padding suffices.
    function hasInnerPadding(): boolean {
      for (const cid of children) {
        const c = graph.getNode(cid) as any;
        const p = Math.max(c?.paddingTop ?? 0, c?.paddingBottom ?? 0, c?.paddingLeft ?? 0, c?.paddingRight ?? 0);
        if (p >= 8) return true;
      }
      return false;
    }
    const looksLikeCard =
      children.length >= 2 &&
      w >= 160 && w <= 800 &&
      h >= 80 &&
      cr >= 4 && cr <= 32 &&
      (hasShadow || hasFill) &&
      (padV >= 8 || hasShadow || hasInnerPadding());
    if (looksLikeCard) return 'card';

    return undefined;
  }

  // ─── Main walk ─────────────────────────────────────────────

  function walk(nodeId: string, parentIsRoot: boolean) {
    const node = graph.getNode(nodeId);
    if (!node) return;

    const semanticRole = (node as any).semanticRole as string | null;

    // Typography — always apply for text nodes with a role
    if (semanticRole && node.type === 'TEXT') {
      if (applyTypography(nodeId, semanticRole)) result.typography++;
    }

    // Component recipes — prefer semantic role, fall back to structural inference.
    if (node.type !== 'TEXT') {
      // First try semantic role
      let componentRole: string | undefined;
      if (semanticRole) {
        switch (semanticRole) {
          case 'button':
          case 'cta':
            componentRole = 'button';
            break;
          case 'card':
          case 'modal':
          case 'toast':
            componentRole = 'card';
            break;
          case 'badge':
          case 'tag':
            componentRole = 'badge';
            break;
          case 'input':
            componentRole = 'input';
            break;
          case 'nav':
          case 'header':
            componentRole = 'nav';
            break;
        }
      }

      // Fall back to structural inference if no semantic role claims this node
      if (!componentRole) {
        componentRole = inferStructuralRole(nodeId, node, parentIsRoot);
      }

      if (componentRole) {
        switch (componentRole) {
          case 'button':
            if (applyButton(nodeId)) result.buttons++;
            break;
          case 'card':
            if (applyCard(nodeId)) result.cards++;
            break;
          case 'badge':
            if (applyBadge(nodeId)) result.badges++;
            break;
          case 'input':
            if (inputSpec && applyInput(nodeId, inputSpec)) result.inputs++;
            break;
          case 'nav':
            if (navSpec && applyNav(nodeId, navSpec)) result.navs++;
            break;
        }
      }
    }

    for (const childId of node.childIds) walk(childId, nodeId === rootId);
  }

  walk(rootId, false);

  result.total =
    result.typography +
    result.buttons +
    result.cards +
    result.badges +
    result.inputs +
    result.navs +
    result.shadows;

  return result;
}
