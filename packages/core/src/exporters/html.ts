/**
 * HTML/CSS Exporter — Scene Graph → HTML + inline CSS
 *
 * Converts a reframe scene into a self-contained HTML document
 * with absolute-positioned divs that mirror the design layout.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { SceneNode, Color, Fill, Stroke, Effect, GradientTransform, StateOverride, ResponsiveRule } from '../engine/types';
import { collectCssTokens, tokenToCssVar } from '../design-system/tokens';
import { semanticTag, ariaRole, headingLevel } from '../semantic';

/** Convert gradientTransform matrix back to CSS angle in degrees. */
function gradientTransformToAngle(t: GradientTransform): number {
  const rad = Math.atan2(t.m01, t.m00);
  return ((rad * 180 / Math.PI) + 90 + 360) % 360;
}

export interface HtmlExportOptions {
  /** Include a full HTML document wrapper (default: true) */
  fullDocument?: boolean;
  /** Include node names as data attributes (default: false) */
  dataAttributes?: boolean;
  /** Use CSS classes instead of inline styles (default: false) */
  cssClasses?: boolean;
  /** CSS class prefix (default: 'rf-') */
  classPrefix?: string;
  /** Include responsive meta viewport (default: true) */
  responsive?: boolean;
}

/**
 * Export a scene graph node to HTML + CSS.
 */
export function exportToHtml(
  graph: SceneGraph,
  rootId: string,
  options: HtmlExportOptions = {},
): string {
  const root = graph.getNode(rootId);
  if (!root) throw new Error(`Node ${rootId} not found`);

  const fullDoc = options.fullDocument ?? true;
  const dataAttrs = options.dataAttributes ?? false;
  const useCssClasses = options.cssClasses ?? false;
  const prefix = options.classPrefix ?? 'rf-';

  const classes: Map<string, string> = new Map();
  let classCounter = 0;

  function getClassName(): string {
    return `${prefix}${classCounter++}`;
  }

  // Collect CSS custom properties from token bindings (used in :root and per-node var())
  const cssTokens = collectCssTokens(graph, rootId);

  // Build a lookup of node → field → CSS variable name for token-bound properties
  const tokenVarLookup = new Map<string, Map<string, string>>();
  if (cssTokens.size > 0) {
    function buildTokenLookup(nodeId: string) {
      const n = graph.getNode(nodeId);
      if (!n) return;
      const bindings = n.boundVariables;
      if (Object.keys(bindings).length > 0) {
        const fieldMap = new Map<string, string>();
        for (const [field, varId] of Object.entries(bindings)) {
          const variable = graph.variables.get(varId);
          if (variable) fieldMap.set(field, tokenToCssVar(variable.name));
        }
        if (fieldMap.size > 0) tokenVarLookup.set(nodeId, fieldMap);
      }
      for (const cid of n.childIds) buildTokenLookup(cid);
    }
    buildTokenLookup(rootId);
  }

  // Collect behavior CSS: state pseudo-classes and responsive media queries
  const behaviorStyles: string[] = [];
  let behaviorNodeCounter = 0;

  function collectBehaviorCss(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;

    const hasStates = n.states && Object.keys(n.states).length > 0;
    const hasResponsive = n.responsive && n.responsive.length > 0;

    if (hasStates || hasResponsive) {
      const cls = `rf-b${behaviorNodeCounter++}`;
      behaviorClassMap.set(nodeId, cls);

      // State pseudo-classes
      if (hasStates) {
        const stateMap: Record<string, string> = {
          hover: ':hover', active: ':active', focus: ':focus',
          disabled: '[disabled]', selected: '[aria-selected="true"]',
        };
        for (const [state, override] of Object.entries(n.states!)) {
          const pseudo = stateMap[state] ?? `:${state}`;
          const cssProps = stateOverrideToCss(override as StateOverride);
          if (cssProps.length > 0) {
            const transition = (override as StateOverride).transition ?? 150;
            behaviorStyles.push(`.${cls}${pseudo} { ${cssProps.join('; ')} }`);
            // Add transition to base element
            if (!behaviorTransitions.has(cls)) {
              behaviorTransitions.set(cls, `transition: all ${transition}ms ease`);
            }
          }
        }
      }

      // Responsive media queries
      if (hasResponsive) {
        for (const rule of n.responsive!) {
          const cssProps = responsiveRuleToCss(rule);
          if (cssProps.length > 0) {
            behaviorStyles.push(`@media (max-width: ${rule.maxWidth}px) { .${cls} { ${cssProps.join('; ')} } }`);
          }
        }
      }
    }

    for (const cid of n.childIds) collectBehaviorCss(cid);
  }

  const behaviorClassMap = new Map<string, string>();
  const behaviorTransitions = new Map<string, string>();
  collectBehaviorCss(rootId);

  // Auto-add hover for interactive elements (buttons, links) that don't have explicit states
  function autoInteractiveHover(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;
    const role = n.semanticRole;
    const isInteractive = role === 'button' || role === 'link' || role === 'cta'
      || n.name === 'Button' || n.name === 'CTA' || n.name === 'NavItem' || n.name === 'Link';
    if (isInteractive && !behaviorClassMap.has(nodeId)) {
      const cls = `rf-b${behaviorNodeCounter++}`;
      behaviorClassMap.set(nodeId, cls);
      behaviorStyles.push(`.${cls}:hover { opacity: 0.85; transform: translateY(-1px) }`);
      behaviorTransitions.set(cls, 'transition: all 150ms ease');
    }
    for (const cid of n.childIds) autoInteractiveHover(cid);
  }
  autoInteractiveHover(rootId);

  function renderNode(node: SceneNode, isRoot: boolean, parentLayout?: string): string {
    // Root is often an invisible “artboard” frame; still export children for HTML round-trip / Studio MCP.
    if (!node.visible && !isRoot) return '';

    // Semantic tag selection
    let tag: string;
    if (node.semanticRole === 'heading' && node.type === 'TEXT') {
      tag = headingLevel(node.fontSize || 16) ?? 'h2';
    } else {
      tag = semanticTag(node.semanticRole, node.type);
    }

    const tokenVars = tokenVarLookup.get(node.id);
    const styles = computeStyles(node, isRoot, parentLayout, tokenVars);

    // Add transition CSS if this node has behavior states
    const behaviorCls = behaviorClassMap.get(node.id);
    const transitionCss = behaviorCls ? behaviorTransitions.get(behaviorCls) : undefined;
    const fullStyles = transitionCss ? `${styles}; ${transitionCss}` : styles;

    const attrs: string[] = [];

    if (useCssClasses) {
      const className = getClassName();
      classes.set(className, fullStyles);
      const allClasses = behaviorCls ? `${className} ${behaviorCls}` : className;
      attrs.push(`class="${allClasses}"`);
    } else {
      attrs.push(`style="${fullStyles}"`);
      if (behaviorCls) attrs.push(`class="${behaviorCls}"`);
    }

    // Navigation link
    if (node.href) {
      tag = 'a';
      attrs.push(`href="${escapeHtml(node.href)}"`);
      if (node.href.startsWith('http')) attrs.push('target="_blank" rel="noopener"');
      // Hash links get data-nav-link for router active state tracking
      if (node.href.startsWith('#')) {
        attrs.push(`data-nav-link="${escapeHtml(node.href.slice(1))}"`);
      }
    }

    // ARIA role attribute
    const aria = ariaRole(node.semanticRole);
    if (aria && tag !== 'a') attrs.push(`role="${aria}"`);

    // Content slot data attribute
    if (node.slot) attrs.push(`data-slot="${escapeHtml(node.slot)}"`);

    if (dataAttrs) {
      attrs.push(`data-id="${node.id}"`);
      attrs.push(`data-name="${escapeHtml(node.name)}"`);
      attrs.push(`data-type="${node.type}"`);
      if (node.semanticRole) attrs.push(`data-role="${node.semanticRole}"`);
    }

    const attrStr = attrs.join(' ');

    // Text node
    if (node.type === 'TEXT' && node.text) {
      // Rich text: render styleRuns as <span> per range
      if (node.styleRuns.length > 0) {
        const richHtml = renderStyleRuns(node.text, node.styleRuns);
        return `<${tag} ${attrStr}>${richHtml}</${tag}>`;
      }
      const textHtml = escapeHtml(node.text).replace(/\n/g, '<br/>');
      return `<${tag} ${attrStr}>${textHtml}</${tag}>`;
    }

    // Self-closing tags
    if (tag === 'img') {
      return `<${tag} ${attrStr} alt="${escapeHtml(node.name)}" />`;
    }

    // Container with children
    const childLayout = node.layoutMode !== 'NONE' ? node.layoutMode : undefined;
    const children = node.childIds
      .map(id => graph.getNode(id))
      .filter((n): n is SceneNode => n !== null && n !== undefined)
      .map(child => renderNode(child, false, childLayout))
      .filter(Boolean);

    if (children.length === 0) {
      return `<${tag} ${attrStr}></${tag}>`;
    }

    return `<${tag} ${attrStr}>\n${indent(children.join('\n'), 2)}\n</${tag}>`;
  }

  const html = renderNode(root, true);

  // Collect all font families used in the tree
  const usedFonts = new Set<string>();
  const usedWeights = new Map<string, Set<number>>();
  function collectFonts(nodeId: string) {
    const n = graph.getNode(nodeId);
    if (!n) return;
    if (n.type === 'TEXT' && n.fontFamily) {
      const family = n.fontFamily;
      if (family !== 'monospace' && family !== 'serif' && family !== 'sans-serif') {
        usedFonts.add(family);
        if (!usedWeights.has(family)) usedWeights.set(family, new Set());
        usedWeights.get(family)!.add(n.fontWeight || 400);
      }
    }
    for (const cid of n.childIds) collectFonts(cid);
  }
  collectFonts(rootId);

  // Google Fonts link
  const fontLinks: string[] = [];
  if (usedFonts.size > 0) {
    const families = [...usedFonts].map(f => {
      const weights = [...(usedWeights.get(f) ?? [400])].sort((a, b) => a - b);
      return `family=${f.replace(/ /g, '+')}:wght@${weights.join(';')}`;
    });
    fontLinks.push(
      `<link rel="preconnect" href="https://fonts.googleapis.com">`,
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
      `<link href="https://fonts.googleapis.com/css2?${families.join('&')}&display=swap" rel="stylesheet">`,
    );
  }

  const tokenBlock = cssTokens.size > 0
    ? `\n  :root {\n${[...cssTokens].map(([k, v]) => `    ${k}: ${v};`).join('\n')}\n  }`
    : '';

  const behaviorBlock = behaviorStyles.length > 0
    ? '\n  ' + behaviorStyles.join('\n  ')
    : '';

  if (!fullDoc) {
    if (useCssClasses || tokenBlock || behaviorBlock) {
      const classBlock = useCssClasses ? generateCssBlock(classes) : '';
      return `<style>${tokenBlock}\n${classBlock}${behaviorBlock}</style>\n${html}`;
    }
    return html;
  }

  // Full document with production-quality base styles
  const css = useCssClasses ? `\n<style>\n${generateCssBlock(classes)}</style>` : '';
  const viewport = (options.responsive ?? true)
    ? '\n  <meta name="viewport" content="width=device-width, initial-scale=1">'
    : '';

  const primaryFont = [...usedFonts][0] ?? 'system-ui';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">${viewport}
  <title>${escapeHtml(root.name)}</title>
  ${fontLinks.join('\n  ')}
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
    body { font-family: '${primaryFont}', system-ui, -apple-system, sans-serif; line-height: 1.5; }
    a { color: inherit; text-decoration: none; }
    img, svg { display: block; max-width: 100%; }${tokenBlock}${behaviorBlock}
  </style>${css}
</head>
<body>
${indent(html, 2)}
</body>
</html>`;
}

// ─── Behavior CSS Helpers ──────────────────────────────────────

function stateOverrideToCss(override: StateOverride): string[] {
  const props: string[] = [];
  if (override.fills && override.fills.length > 0) {
    const fill = override.fills[0];
    if (fill.type === 'SOLID') {
      props.push(`background: ${colorToRgba(fill.color, fill.opacity)}`);
    }
  }
  if (override.strokes && override.strokes.length > 0) {
    const stroke = override.strokes[0];
    if (stroke.visible) {
      props.push(`border-color: ${colorToRgba(stroke.color, stroke.opacity)}`);
    }
  }
  if (override.effects && override.effects.length > 0) {
    const shadow = computeBoxShadow(override.effects);
    if (shadow) props.push(shadow);
  }
  if (override.opacity !== undefined) props.push(`opacity: ${round(override.opacity)}`);
  if (override.cornerRadius !== undefined) props.push(`border-radius: ${px(override.cornerRadius)}`);
  if (override.fontSize !== undefined) props.push(`font-size: ${px(override.fontSize)}`);
  if (override.fontWeight !== undefined) props.push(`font-weight: ${override.fontWeight}`);
  if (override.letterSpacing !== undefined) props.push(`letter-spacing: ${px(override.letterSpacing)}`);
  return props;
}

function responsiveRuleToCss(rule: ResponsiveRule): string[] {
  const props: string[] = [];
  const p = rule.props;
  if (p.width !== undefined) props.push(`width: ${px(p.width)}`);
  if (p.height !== undefined) props.push(`height: ${px(p.height)}`);
  if (p.fontSize !== undefined) props.push(`font-size: ${px(p.fontSize)}`);
  if (p.fontWeight !== undefined) props.push(`font-weight: ${p.fontWeight}`);
  if (p.lineHeight !== undefined && p.lineHeight !== null) props.push(`line-height: ${lineHeightCss(p.lineHeight)}`);
  if (p.letterSpacing !== undefined) props.push(`letter-spacing: ${px(p.letterSpacing)}`);
  if (p.itemSpacing !== undefined) props.push(`gap: ${px(p.itemSpacing)}`);
  if (p.opacity !== undefined) props.push(`opacity: ${round(p.opacity)}`);
  if (p.visible === false) props.push('display: none');
  if (p.layoutMode !== undefined) {
    props.push(`flex-direction: ${p.layoutMode === 'VERTICAL' ? 'column' : 'row'}`);
  }
  if (p.paddingTop !== undefined || p.paddingRight !== undefined || p.paddingBottom !== undefined || p.paddingLeft !== undefined) {
    props.push(`padding: ${px(p.paddingTop ?? 0)} ${px(p.paddingRight ?? 0)} ${px(p.paddingBottom ?? 0)} ${px(p.paddingLeft ?? 0)}`);
  }
  return props;
}

// ─── Style Computation ─────────────────────────────────────────

function computeStyles(node: SceneNode, isRoot: boolean, parentLayout?: string, tokenVars?: Map<string, string>): string {
  const s: string[] = [];
  const hasFlexLayout = node.layoutMode !== 'NONE' && node.layoutMode !== 'GRID';

  /** Get CSS value: use var(--token) if token-bound, otherwise use the literal. */
  function tv(field: string, literal: string): string {
    if (tokenVars) {
      const cssVar = tokenVars.get(field);
      if (cssVar) return `var(${cssVar})`;
    }
    return literal;
  }

  // Position & size
  if (isRoot) {
    s.push('position: relative');
    s.push(`width: ${px(node.width)}`);
    // Root with auto-layout: min-height so content can grow beyond frame
    if (hasFlexLayout) {
      s.push(`min-height: ${px(node.height)}`);
    } else {
      s.push(`height: ${px(node.height)}`);
    }
    s.push('margin: 0 auto');
  } else if (parentLayout && node.layoutPositioning !== 'ABSOLUTE') {
    // ── Child of a flex container ──
    // parentLayout is HORIZONTAL or VERTICAL.
    // In a HORIZONTAL row: primary axis = width, counter axis = height.
    // In a VERTICAL column: primary axis = height, counter axis = width.

    const isParentRow = parentLayout === 'HORIZONTAL';
    const primarySizing = node.primaryAxisSizing ?? 'FIXED';
    const counterSizing = node.counterAxisSizing ?? 'FIXED';
    const isText = node.type === 'TEXT';
    const autoResize = node.textAutoResize;
    const hasLayout = node.layoutMode && node.layoutMode !== 'NONE';

    // Detect if dimensions are likely invalid (Yoga couldn't compute without font metrics)
    const primaryDim = isParentRow ? node.width : node.height;
    const counterDim = isParentRow ? node.height : node.width;
    const primarySuspect = primaryDim <= 0 || (hasLayout && primarySizing !== 'FIXED' && primaryDim === 100);
    const counterSuspect = counterDim <= 0 || (hasLayout && counterSizing !== 'FIXED' && counterDim === 100);

    // Primary axis (along parent direction)
    if (node.layoutGrow > 0 || primarySizing === 'FILL') {
      s.push(`flex: ${node.layoutGrow || 1}`);
    } else if (primarySizing === 'HUG' || primarySuspect || (isText && autoResize !== 'NONE')) {
      // HUG or suspect dimension = content-sized, let CSS compute
      s.push('flex: 0 0 auto');
    } else {
      // FIXED with valid dimension
      if (isParentRow) {
        s.push(`width: ${px(node.width)}`);
      } else {
        s.push(`height: ${px(node.height)}`);
      }
    }

    // Counter axis (perpendicular to parent direction)
    const selfAlign = node.layoutAlignSelf;
    if (selfAlign === 'STRETCH' || counterSizing === 'FILL') {
      s.push('align-self: stretch');
    } else if (counterSizing === 'HUG' || counterSuspect || (isText && (autoResize === 'WIDTH_AND_HEIGHT' || autoResize === 'HEIGHT'))) {
      // HUG or suspect counter axis — let CSS auto-size
      if (selfAlign && selfAlign !== 'AUTO') {
        const asMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch' };
        if (asMap[selfAlign]) s.push(`align-self: ${asMap[selfAlign]}`);
      }
    } else {
      // FIXED counter axis with valid dimension
      if (isParentRow) {
        if (node.height > 0) s.push(`height: ${px(node.height)}`);
      } else {
        if (node.width > 0) s.push(`width: ${px(node.width)}`);
      }
      if (selfAlign && selfAlign !== 'AUTO') {
        const asMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch' };
        if (asMap[selfAlign]) s.push(`align-self: ${asMap[selfAlign]}`);
      }
    }
  } else {
    s.push('position: absolute');
    s.push(`left: ${px(node.x)}`);
    s.push(`top: ${px(node.y)}`);
    s.push(`width: ${px(node.width)}`);
    s.push(`height: ${px(node.height)}`);
  }

  // Flex layout (when this node IS a flex container)
  const isGrid = node.layoutMode === 'GRID';
  if (isGrid && node.type !== 'TEXT') {
    // CSS Grid layout
    s.push('display: grid');

    if (node.gridTemplateColumns.length > 0) {
      s.push(`grid-template-columns: ${gridTracksToCSS(node.gridTemplateColumns)}`);
    }
    if (node.gridTemplateRows.length > 0) {
      s.push(`grid-template-rows: ${gridTracksToCSS(node.gridTemplateRows)}`);
    }
    if (node.gridColumnGap > 0) s.push(`column-gap: ${px(node.gridColumnGap)}`);
    if (node.gridRowGap > 0) s.push(`row-gap: ${px(node.gridRowGap)}`);

    // Padding
    if (node.paddingTop > 0 || node.paddingRight > 0 || node.paddingBottom > 0 || node.paddingLeft > 0) {
      s.push(`padding: ${tv('paddingTop', px(node.paddingTop))} ${tv('paddingRight', px(node.paddingRight))} ${tv('paddingBottom', px(node.paddingBottom))} ${tv('paddingLeft', px(node.paddingLeft))}`);
    }
  } else if (hasFlexLayout && node.type !== 'TEXT') {
    s.push('display: flex');
    s.push(`flex-direction: ${node.layoutMode === 'VERTICAL' ? 'column' : 'row'}`);

    // primaryAxisAlign → justify-content
    const jc = node.primaryAxisAlign === 'CENTER' ? 'center'
      : node.primaryAxisAlign === 'MAX' ? 'flex-end'
      : node.primaryAxisAlign === 'SPACE_BETWEEN' ? 'space-between'
      : 'flex-start';
    s.push(`justify-content: ${jc}`);

    // counterAxisAlign → align-items
    const ai = node.counterAxisAlign === 'CENTER' ? 'center'
      : node.counterAxisAlign === 'MAX' ? 'flex-end'
      : node.counterAxisAlign === 'STRETCH' ? 'stretch'
      : node.counterAxisAlign === 'BASELINE' ? 'baseline'
      : 'flex-start';
    s.push(`align-items: ${ai}`);

    // Wrap
    if (node.layoutWrap === 'WRAP') {
      s.push('flex-wrap: wrap');
    }

    // Gap
    if (node.itemSpacing > 0 && node.counterAxisSpacing > 0) {
      s.push(`gap: ${tv('counterAxisSpacing', px(node.counterAxisSpacing))} ${tv('itemSpacing', px(node.itemSpacing))}`);
    } else if (node.itemSpacing > 0) {
      s.push(`gap: ${tv('itemSpacing', px(node.itemSpacing))}`);
    } else if (node.counterAxisSpacing > 0) {
      s.push(`row-gap: ${tv('counterAxisSpacing', px(node.counterAxisSpacing))}`);
    }

    // Padding
    if (node.paddingTop > 0 || node.paddingRight > 0 || node.paddingBottom > 0 || node.paddingLeft > 0) {
      s.push(`padding: ${tv('paddingTop', px(node.paddingTop))} ${tv('paddingRight', px(node.paddingRight))} ${tv('paddingBottom', px(node.paddingBottom))} ${tv('paddingLeft', px(node.paddingLeft))}`);
    }
  }

  // Grid child positioning
  if (node.gridPosition) {
    const gp = node.gridPosition;
    s.push(`grid-column: ${gp.column} / span ${gp.columnSpan}`);
    s.push(`grid-row: ${gp.row} / span ${gp.rowSpan}`);
  }

  // Size constraints
  if (node.minWidth !== null && node.minWidth > 0) s.push(`min-width: ${px(node.minWidth)}`);
  if (node.maxWidth !== null) s.push(`max-width: ${px(node.maxWidth)}`);
  if (node.minHeight !== null && node.minHeight > 0) s.push(`min-height: ${px(node.minHeight)}`);
  if (node.maxHeight !== null) s.push(`max-height: ${px(node.maxHeight)}`);


  // Opacity
  if (node.opacity < 1) {
    s.push(`opacity: ${round(node.opacity)}`);
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    const cssBlend = blendModeToCSS(node.blendMode);
    if (cssBlend) s.push(`mix-blend-mode: ${cssBlend}`);
  }

  // Transform (rotation + flip)
  const transforms: string[] = [];
  if (node.rotation !== 0) transforms.push(`rotate(${round(node.rotation)}deg)`);
  if (node.flipX) transforms.push('scaleX(-1)');
  if (node.flipY) transforms.push('scaleY(-1)');
  if (transforms.length > 0) s.push(`transform: ${transforms.join(' ')}`);

  // Background (fills) — skip for TEXT nodes (fills = text color, handled below)
  if (node.type !== 'TEXT') {
    const fillColorVar = tokenVars?.get('fills[0].color');
    if (fillColorVar && node.fills?.length === 1 && node.fills[0]?.type === 'SOLID') {
      // Token-bound single solid fill → use CSS variable
      s.push(`background: var(${fillColorVar})`);
    } else {
      const bg = computeBackground(node.fills);
      if (bg) s.push(bg);
    }
  }

  // Border (strokes)
  if (node.independentStrokeWeights) {
    // Per-side border weights
    const stroke = node.strokes?.find(st => st.visible);
    if (stroke) {
      const hasDash = (stroke.dashPattern?.length ?? 0) > 0 || (node.dashPattern?.length ?? 0) > 0;
      const style = hasDash ? 'dashed' : 'solid';
      const color = colorToRgba(stroke.color, stroke.opacity);
      s.push(`border-style: ${style}`);
      s.push(`border-color: ${color}`);
      s.push(`border-width: ${px(node.borderTopWeight)} ${px(node.borderRightWeight)} ${px(node.borderBottomWeight)} ${px(node.borderLeftWeight)}`);
    }
  } else {
    const border = computeBorder(node.strokes, node.dashPattern);
    if (border) s.push(border);
  }

  // Border radius
  if (node.type === 'ELLIPSE') {
    s.push('border-radius: 50%');
  } else {
    const crVar = tokenVars?.get('cornerRadius');
    if (crVar && node.cornerRadius && !node.independentCorners) {
      s.push(`border-radius: var(${crVar})`);
    } else {
      const radius = computeBorderRadius(node);
      if (radius) s.push(radius);
    }
  }

  // Effects (box-shadow)
  const shadow = computeBoxShadow(node.effects);
  if (shadow) s.push(shadow);

  // Effects (blur filter)
  const blurEffect = node.effects?.find(e => e.visible && e.type === 'LAYER_BLUR');
  if (blurEffect) {
    s.push(`filter: blur(${px(blurEffect.radius)})`);
  }

  // Clip
  if (node.clipsContent) {
    s.push('overflow: hidden');
  }

  // Text styles
  if (node.type === 'TEXT') {
    s.push(`font-size: ${tv('fontSize', px(node.fontSize || 16))}`);
    if (node.fontFamily) s.push(`font-family: ${tv('fontFamily', `'${node.fontFamily}', sans-serif`)}`);
    if (node.fontWeight && node.fontWeight !== 400) s.push(`font-weight: ${tv('fontWeight', String(node.fontWeight))}`);
    if (node.italic) s.push('font-style: italic');
    if (node.letterSpacing) s.push(`letter-spacing: ${tv('letterSpacing', px(node.letterSpacing))}`);
    if (node.lineHeight) s.push(`line-height: ${tv('lineHeight', lineHeightCss(node.lineHeight))}`);

    const textColor = node.fills?.find(f => f.visible && f.type === 'SOLID');
    if (textColor) {
      // Check if fill[0].color is token-bound
      const fillColorVar = tokenVars?.get('fills[0].color');
      s.push(`color: ${fillColorVar ? `var(${fillColorVar})` : colorToRgba(textColor.color, textColor.opacity)}`);
    }

    // Text align
    if (node.textAlignHorizontal === 'CENTER') s.push('text-align: center');
    else if (node.textAlignHorizontal === 'RIGHT') s.push('text-align: right');
    else if (node.textAlignHorizontal === 'JUSTIFIED') s.push('text-align: justify');

    // Vertical align — only use flex if explicitly centering/bottom-aligning
    if (node.textAlignVertical === 'CENTER' || node.textAlignVertical === 'BOTTOM') {
      s.push('display: flex');
      s.push(`align-items: ${node.textAlignVertical === 'CENTER' ? 'center' : 'flex-end'}`);
    }

    // Text decoration
    if (node.textDecoration === 'UNDERLINE') s.push('text-decoration: underline');
    else if (node.textDecoration === 'STRIKETHROUGH') s.push('text-decoration: line-through');

    // Text transform
    if (node.textCase === 'UPPER') s.push('text-transform: uppercase');
    else if (node.textCase === 'LOWER') s.push('text-transform: lowercase');

    // Text truncation (maxLines + ellipsis)
    if (node.textTruncation === 'ENDING' && node.maxLines && node.maxLines > 0) {
      s.push('overflow: hidden');
      s.push('text-overflow: ellipsis');
      if (node.maxLines === 1) {
        s.push('white-space: nowrap');
      } else {
        s.push('display: -webkit-box');
        s.push(`-webkit-line-clamp: ${node.maxLines}`);
        s.push('-webkit-box-orient: vertical');
      }
    }
  }

  return s.join('; ');
}

function computeBackground(fills: Fill[]): string | null {
  if (!fills || fills.length === 0) return null;

  const visibleFills = fills.filter(f => f.visible);
  if (visibleFills.length === 0) return null;

  // Single solid fill
  if (visibleFills.length === 1 && visibleFills[0].type === 'SOLID') {
    return `background: ${colorToRgba(visibleFills[0].color, visibleFills[0].opacity)}`;
  }

  // Multiple fills → layered backgrounds (CSS supports this)
  const backgrounds = visibleFills.map(fill => {
    if (fill.type === 'SOLID') {
      return colorToRgba(fill.color, fill.opacity);
    }
    if (fill.type === 'GRADIENT_LINEAR' && fill.gradientStops) {
      const stops = fill.gradientStops
        .map(s => `${colorToRgba(s.color)} ${round(s.position * 100)}%`)
        .join(', ');
      const angle = fill.gradientTransform
        ? `${round(gradientTransformToAngle(fill.gradientTransform))}deg, `
        : '';
      return `linear-gradient(${angle}${stops})`;
    }
    if (fill.type === 'GRADIENT_RADIAL' && fill.gradientStops) {
      const stops = fill.gradientStops
        .map(s => `${colorToRgba(s.color)} ${round(s.position * 100)}%`)
        .join(', ');
      return `radial-gradient(${stops})`;
    }
    return null;
  }).filter(Boolean);

  if (backgrounds.length === 0) return null;
  return `background: ${backgrounds.join(', ')}`;
}

function computeBorder(strokes: Stroke[], nodeDashPattern?: number[]): string | null {
  if (!strokes || strokes.length === 0) return null;
  const stroke = strokes.find(s => s.visible);
  if (!stroke) return null;

  const hasDash = (stroke.dashPattern?.length ?? 0) > 0 || (nodeDashPattern?.length ?? 0) > 0;
  const style = hasDash ? 'dashed' : 'solid';
  return `border: ${px(stroke.weight)} ${style} ${colorToRgba(stroke.color, stroke.opacity)}`;
}

function computeBorderRadius(node: SceneNode): string | null {
  if (node.independentCorners) {
    const tl = node.topLeftRadius || 0;
    const tr = node.topRightRadius || 0;
    const br = node.bottomRightRadius || 0;
    const bl = node.bottomLeftRadius || 0;
    if (tl === 0 && tr === 0 && br === 0 && bl === 0) return null;
    return `border-radius: ${px(tl)} ${px(tr)} ${px(br)} ${px(bl)}`;
  }

  if (!node.cornerRadius) return null;
  return `border-radius: ${px(node.cornerRadius)}`;
}

function computeBoxShadow(effects: Effect[]): string | null {
  if (!effects || effects.length === 0) return null;

  const shadows = effects
    .filter(e => e.visible && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map(e => {
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      return `${inset}${px(e.offset.x)} ${px(e.offset.y)} ${px(e.radius)} ${px(e.spread)} ${colorToRgba(e.color)}`;
    });

  if (shadows.length === 0) return null;
  return `box-shadow: ${shadows.join(', ')}`;
}

// ─── CSS Generation ────────────────────────────────────────────

function generateCssBlock(classes: Map<string, string>): string {
  const lines: string[] = [];
  for (const [className, styles] of classes) {
    const props = styles.split('; ').map(p => `  ${p};`).join('\n');
    lines.push(`.${className} {\n${props}\n}`);
  }
  return lines.join('\n\n');
}

// ─── Rich Text ────────────────────────────────────────────────

function renderStyleRuns(text: string, runs: { start: number; length: number; style: any }[]): string {
  // Sort runs by start position
  const sorted = [...runs].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;

  for (const run of sorted) {
    // Gap before this run — render as plain text
    if (run.start > cursor) {
      parts.push(escapeHtml(text.slice(cursor, run.start)).replace(/\n/g, '<br/>'));
    }

    const end = run.start + run.length;
    const fragment = escapeHtml(text.slice(run.start, end)).replace(/\n/g, '<br/>');
    const s = run.style;
    const css: string[] = [];

    if (s.fontSize) css.push(`font-size: ${px(s.fontSize)}`);
    if (s.fontWeight) css.push(`font-weight: ${s.fontWeight}`);
    if (s.fontFamily) css.push(`font-family: '${s.fontFamily}', sans-serif`);
    if (s.italic) css.push('font-style: italic');
    if (s.letterSpacing) css.push(`letter-spacing: ${px(s.letterSpacing)}`);
    if (typeof s.lineHeight === 'number') css.push(`line-height: ${lineHeightCss(s.lineHeight)}`);
    if (s.textDecoration === 'UNDERLINE') css.push('text-decoration: underline');
    else if (s.textDecoration === 'STRIKETHROUGH') css.push('text-decoration: line-through');
    if (s.textCase === 'UPPER') css.push('text-transform: uppercase');
    else if (s.textCase === 'LOWER') css.push('text-transform: lowercase');
    if (s.fillColor) {
      css.push(`color: ${colorToRgba(s.fillColor)}`);
    }

    if (css.length > 0) {
      parts.push(`<span style="${css.join('; ')}">${fragment}</span>`);
    } else {
      parts.push(fragment);
    }
    cursor = end;
  }

  // Remaining text after last run
  if (cursor < text.length) {
    parts.push(escapeHtml(text.slice(cursor)).replace(/\n/g, '<br/>'));
  }

  return parts.join('');
}

// ─── Grid Helpers ─────────────────────────────────────────────

function gridTracksToCSS(tracks: { type: string; value: number }[]): string {
  return tracks.map(t => {
    if (t.type === 'FR') return `${t.value}fr`;
    if (t.type === 'AUTO') return 'auto';
    return px(t.value); // FIXED
  }).join(' ');
}

// ─── Utils ─────────────────────────────────────────────────────

function colorToRgba(color: Color, opacity = 1): string {
  if (!color) return 'transparent';
  const r = Math.round(Math.max(0, Math.min(1, color.r ?? 0)) * 255);
  const g = Math.round(Math.max(0, Math.min(1, color.g ?? 0)) * 255);
  const b = Math.round(Math.max(0, Math.min(1, color.b ?? 0)) * 255);
  const a = round(Math.max(0, Math.min(1, (color.a ?? 1) * opacity)));

  if (a === 1) {
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function hex(n: number): string {
  const clamped = Math.max(0, Math.min(255, n));
  return clamped.toString(16).padStart(2, '0');
}

function px(n: number | undefined | null): string {
  if (n === undefined || n === null || isNaN(n)) return '0';
  if (n === 0) return '0';
  return `${round(n)}px`;
}

/** Values in (0, 4) are treated as unitless multipliers (typical Figma line-height); larger → px. */
function lineHeightCss(lh: number): string {
  if (isNaN(lh)) return '1.5';
  if (lh > 0 && lh < 4) return String(round(lh));
  return px(lh);
}

function round(n: number): number {
  if (isNaN(n)) return 0;
  return Math.round(n * 100) / 100;
}

function blendModeToCSS(mode: string): string | null {
  const map: Record<string, string> = {
    MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay',
    DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge',
    COLOR_BURN: 'color-burn', HARD_LIGHT: 'hard-light', SOFT_LIGHT: 'soft-light',
    DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue',
    SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
  };
  return map[mode] ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function indent(s: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return s.split('\n').map(l => pad + l).join('\n');
}
