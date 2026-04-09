/**
 * React Exporter — INode → React functional component
 *
 * Generates clean, idiomatic React/JSX.
 * Supports inline styles and CSS modules output.
 * Maps INode layout to flexbox, absolute positioning, typography.
 */

import { type INode, NodeType, MIXED, type ISolidPaint } from '../host';
import type { StateOverride, ResponsiveRule } from '../engine/types';

// ─── Types ────────────────────────────────────────────────────

export interface ReactExportOptions {
  /** Component name (default: derived from root node name) */
  componentName?: string;
  /** TypeScript annotations (default: true) */
  typescript?: boolean;
  /** Indent size (default: 2) */
  indent?: number;
  /** Output CSS modules instead of inline styles (default: false) */
  cssModules?: boolean;
  /** Include image placeholders as <img> tags (default: true) */
  images?: boolean;
}

export interface ReactExportResult {
  /** The React component code */
  component: string;
  /** CSS module content (only when cssModules: true) */
  css?: string;
}

// ─── Main Export ──────────────────────────────────────────────

/** Export an INode tree to a React functional component string. */
export function exportToReact(node: INode, options?: ReactExportOptions): string {
  const result = exportToReactModule(node, options);
  if (result.css) {
    return `/* --- ${sanitizeComponentName(options?.componentName ?? node.name)}.module.css --- */\n\n${result.css}\n\n/* --- Component --- */\n\n${result.component}`;
  }
  return result.component;
}

/** Export with separate component and CSS module files. */
export function exportToReactModule(node: INode, options?: ReactExportOptions): ReactExportResult {
  const name = sanitizeComponentName(options?.componentName ?? node.name);
  const ts = options?.typescript ?? true;
  const indentSize = options?.indent ?? 2;
  const useCssModules = options?.cssModules ?? false;
  const useImages = options?.images ?? true;

  const cssClasses = new Map<string, Record<string, string | number>>();
  let classCounter = 0;

  // Collect behavioral CSS (states + responsive) from the tree
  const behaviorStyles: string[] = [];
  let behaviorCounter = 0;
  const behaviorClassMap = new Map<string, string>();

  function collectBehavior(n: INode) {
    if (n.removed || n.visible === false) return;
    const hasStates = n.states && Object.keys(n.states).length > 0;
    const hasResponsive = n.responsive && n.responsive.length > 0;

    if (hasStates || hasResponsive) {
      const cls = `rf${behaviorCounter++}`;
      behaviorClassMap.set(nodeKey(n), cls);

      if (hasStates) {
        const stateMap: Record<string, string> = {
          hover: ':hover', active: ':active', focus: ':focus',
          disabled: '[disabled]', selected: '[aria-selected="true"]',
        };
        for (const [state, override] of Object.entries(n.states!)) {
          const pseudo = stateMap[state] ?? `:${state}`;
          const cssProps = stateOverrideToCssReact(override as StateOverride);
          if (cssProps.length > 0) {
            const transition = (override as StateOverride).transition ?? 150;
            behaviorStyles.push(`.${cls}${pseudo} { ${cssProps.join('; ')} }`);
            if (!behaviorStyles.some(s => s.includes(`.${cls} {`) && s.includes('transition'))) {
              behaviorStyles.push(`.${cls} { transition: all ${transition}ms ease; }`);
            }
          }
        }
      }
      if (hasResponsive) {
        for (const rule of n.responsive!) {
          const cssProps = responsiveRuleToCssReact(rule);
          if (cssProps.length > 0) {
            behaviorStyles.push(`@media (max-width: ${rule.maxWidth}px) { .${cls} { ${cssProps.join('; ')} } }`);
          }
        }
      }
    }
    if (n.children) for (const c of n.children) collectBehavior(c);
  }
  collectBehavior(node);

  const jsx = renderNode(node, true, indentSize, 1, useCssModules, cssClasses, () => `node${classCounter++}`, useImages, behaviorClassMap);

  const typeAnnotation = ts ? ': React.FC' : '';
  const imports: string[] = [`import React from 'react';`];
  if (useCssModules) {
    imports.push(`import styles from './${name}.module.css';`);
  }

  // Build style tag for states/responsive if any
  const styleJsx = behaviorStyles.length > 0
    ? `\n      <style>{\`\n        ${behaviorStyles.join('\n        ')}\n      \`}</style>`
    : '';

  const lines: string[] = [
    ...imports,
    '',
    `const ${name}${typeAnnotation} = () => {`,
    `  return (`,
    `    <>`,
    jsx,
    styleJsx ? styleJsx : '',
    `    </>`,
    `  );`,
    `};`,
    '',
    `export default ${name};`,
    '',
  ].filter(l => l !== '');

  const result: ReactExportResult = { component: lines.join('\n') };

  if (useCssModules) {
    const cssLines: string[] = [];
    for (const [className, styleObj] of cssClasses) {
      cssLines.push(`.${className} {`);
      for (const [prop, val] of Object.entries(styleObj)) {
        cssLines.push(`  ${camelToKebab(prop)}: ${formatCssValue(prop, val)};`);
      }
      cssLines.push('}');
      cssLines.push('');
    }
    result.css = cssLines.join('\n');
  }

  return result;
}

// ─── Node Rendering ───────────────────────────────────────────

function renderNode(
  node: INode, isRoot: boolean, indentSize: number, depth: number,
  useCssModules: boolean, cssClasses: Map<string, Record<string, string | number>>,
  genClassName: () => string, useImages: boolean,
  behaviorClassMap?: Map<string, string>,
): string {
  const pad = ' '.repeat(indentSize * (depth + 2));
  const style = computeStyle(node, isRoot);

  const behaviorCls = behaviorClassMap?.get(nodeKey(node));
  let styleAttr: string;
  if (useCssModules) {
    const className = genClassName();
    cssClasses.set(className, style);
    styleAttr = behaviorCls
      ? `className={\`\${styles.${className}} ${behaviorCls}\`}`
      : `className={styles.${className}}`;
  } else {
    styleAttr = `style={${formatStyleObject(style, pad, indentSize)}}`;
    if (behaviorCls) styleAttr += ` className="${behaviorCls}"`;
  }

  // Image node
  if (hasImageFill(node) && useImages) {
    const src = getImageSrc(node);
    const alt = node.name || 'image';
    return `${pad}<img src="${src}" alt="${escapeJsx(alt)}" ${styleAttr} />`;
  }

  // Text node
  if (node.type === NodeType.Text) {
    const text = escapeJsx(node.characters ?? '');
    if (text.includes('\n')) {
      const lines = text.split('\n');
      const content = lines.map((l, i) => i < lines.length - 1 ? `${l}<br />` : l).join(`\n${pad}  `);
      return `${pad}<span ${styleAttr}>\n${pad}  ${content}\n${pad}</span>`;
    }
    return `${pad}<span ${styleAttr}>${text}</span>`;
  }

  // Ellipse → rounded div
  // Vector/other leaf → empty div

  // Container / shape
  const children = (node.children ?? []).filter(c => !c.removed && c.visible !== false);

  if (children.length === 0) {
    return `${pad}<div ${styleAttr} />`;
  }

  const childJsx = children
    .map(c => renderNode(c, false, indentSize, depth + 1, useCssModules, cssClasses, genClassName, useImages, behaviorClassMap))
    .join('\n');

  return `${pad}<div ${styleAttr}>\n${childJsx}\n${pad}</div>`;
}

// ─── Style Computation ────────────────────────────────────────

function computeStyle(node: INode, isRoot: boolean): Record<string, string | number> {
  const s: Record<string, string | number> = {};

  // Position & Size
  if (isRoot) {
    s.position = 'relative';
    s.width = node.width;
    s.height = node.height;
  } else {
    const isFlexChild = node.parent?.layoutMode && node.parent.layoutMode !== 'NONE';
    if (!isFlexChild) {
      s.position = 'absolute';
      s.left = node.x;
      s.top = node.y;
    }
    s.width = node.width;
    s.height = node.height;

    // Flex grow
    if (isFlexChild && node.layoutGrow && node.layoutGrow > 0) {
      s.flexGrow = node.layoutGrow;
    }

    // Align-self
    if (isFlexChild && node.layoutAlignSelf && node.layoutAlignSelf !== 'AUTO') {
      const asMap: Record<string, string> = { MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch' };
      if (asMap[node.layoutAlignSelf]) s.alignSelf = asMap[node.layoutAlignSelf];
    }
  }

  // Layout (flex)
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    s.display = 'flex';
    s.flexDirection = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';

    if (node.primaryAxisAlign) {
      const map: Record<string, string> = {
        MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between',
      };
      if (map[node.primaryAxisAlign]) s.justifyContent = map[node.primaryAxisAlign];
    }

    if (node.counterAxisAlign) {
      const map: Record<string, string> = {
        MIN: 'flex-start', CENTER: 'center', MAX: 'flex-end', STRETCH: 'stretch', BASELINE: 'baseline',
      };
      if (map[node.counterAxisAlign]) s.alignItems = map[node.counterAxisAlign];
    }

    // Gap
    if (node.itemSpacing && node.counterAxisSpacing) {
      s.gap = `${node.counterAxisSpacing}px ${node.itemSpacing}px`;
    } else if (node.itemSpacing) {
      s.gap = node.itemSpacing;
    } else if (node.counterAxisSpacing) {
      s.rowGap = node.counterAxisSpacing;
    }

    if (node.layoutWrap === 'WRAP') s.flexWrap = 'wrap';
  }

  // Padding
  const pt = node.paddingTop, pr = node.paddingRight, pb = node.paddingBottom, pl = node.paddingLeft;
  if (pt || pr || pb || pl) {
    if (pt === pr && pr === pb && pb === pl && pt) {
      s.padding = pt;
    } else {
      s.padding = `${pt ?? 0}px ${pr ?? 0}px ${pb ?? 0}px ${pl ?? 0}px`;
    }
  }

  // Background
  const bg = computeBackground(node);
  if (bg) s.background = bg;

  // Border
  if (node.independentStrokeWeights) {
    const stroke = node.strokes?.find(st => st.type === 'SOLID' && st.visible !== false);
    if (stroke) {
      const solid = stroke as ISolidPaint;
      const color = colorToRgba(solid.color, solid.opacity);
      s.borderStyle = 'solid';
      s.borderColor = color;
      s.borderWidth = `${node.borderTopWeight ?? 0}px ${node.borderRightWeight ?? 0}px ${node.borderBottomWeight ?? 0}px ${node.borderLeftWeight ?? 0}px`;
    }
  } else {
    const border = computeBorder(node);
    if (border) s.border = border;
  }

  // Border radius
  const radius = computeBorderRadius(node);
  if (radius) s.borderRadius = radius;

  // Effects (box-shadow)
  const shadow = computeBoxShadow(node);
  if (shadow) s.boxShadow = shadow;

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    s.opacity = round(node.opacity);
  }

  // Rotation
  if (node.rotation !== undefined && node.rotation !== 0) {
    s.transform = `rotate(${round(node.rotation)}deg)`;
  }

  // Blend mode
  if (node.blendMode && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    s.mixBlendMode = node.blendMode.toLowerCase().replace(/_/g, '-');
  }

  // Clip
  if (node.clipsContent) s.overflow = 'hidden';

  // Blur filter
  if (node.effects) {
    const blurEffect = node.effects.find(e => e.visible !== false && (e.type === 'LAYER_BLUR' || e.type === 'BLUR'));
    if (blurEffect) {
      s.filter = `blur(${blurEffect.radius ?? 0}px)`;
    }
  }

  // Text styles
  if (node.type === NodeType.Text) {
    applyTextStyles(s, node);
  }

  // Ellipse → 50% border radius
  if (node.type === NodeType.Ellipse) {
    s.borderRadius = '50%';
  }

  return s;
}

function applyTextStyles(s: Record<string, string | number>, node: INode): void {
  const fontSize = node.fontSize;
  if (typeof fontSize === 'number') s.fontSize = fontSize;

  if (node.fontFamily) s.fontFamily = `"${node.fontFamily}", sans-serif`;
  if (node.fontWeight && node.fontWeight !== 400) s.fontWeight = node.fontWeight;
  if (node.italic) s.fontStyle = 'italic';

  // Text color from fills
  const textColor = getFirstSolidFill(node);
  if (textColor) s.color = colorToRgba(textColor.color, textColor.opacity);

  // Alignment
  if (node.textAlignHorizontal === 'CENTER') s.textAlign = 'center';
  else if (node.textAlignHorizontal === 'RIGHT') s.textAlign = 'right';
  else if (node.textAlignHorizontal === 'JUSTIFIED') s.textAlign = 'justify';

  // Line height
  if (node.lineHeight && node.lineHeight !== MIXED) {
    if (typeof node.lineHeight === 'number') {
      s.lineHeight = `${node.lineHeight}px`;
    } else if (typeof node.lineHeight === 'object' && 'value' in node.lineHeight) {
      s.lineHeight = node.lineHeight.unit === 'PERCENT'
        ? round(node.lineHeight.value / 100)
        : `${node.lineHeight.value}px`;
    }
  }

  // Letter spacing
  if (node.letterSpacing && node.letterSpacing !== MIXED) {
    if (typeof node.letterSpacing === 'number') {
      s.letterSpacing = `${node.letterSpacing}px`;
    } else if (typeof node.letterSpacing === 'object' && 'value' in node.letterSpacing) {
      s.letterSpacing = `${node.letterSpacing.value}px`;
    }
  }

  // Decoration
  if (node.textDecoration === 'UNDERLINE') s.textDecoration = 'underline';
  else if (node.textDecoration === 'STRIKETHROUGH') s.textDecoration = 'line-through';

  // Case
  if (node.textCase === 'UPPER') s.textTransform = 'uppercase';
  else if (node.textCase === 'LOWER') s.textTransform = 'lowercase';
  else if (node.textCase === 'TITLE') s.textTransform = 'capitalize';

  // Text truncation
  if (node.textTruncation === 'ENDING' && node.maxLines && node.maxLines > 0) {
    s.overflow = 'hidden';
    s.textOverflow = 'ellipsis';
    if (node.maxLines === 1) {
      s.whiteSpace = 'nowrap';
    } else {
      s.display = '-webkit-box';
      (s as any).WebkitLineClamp = node.maxLines;
      (s as any).WebkitBoxOrient = 'vertical';
    }
  }
}

// ─── Style Helpers ────────────────────────────────────────────

function hasImageFill(node: INode): boolean {
  if (!node.fills || node.fills === MIXED) return false;
  return node.fills.some(f => f.type === 'IMAGE');
}

function getImageSrc(node: INode): string {
  if (!node.fills || node.fills === MIXED) return '';
  const img = node.fills.find(f => f.type === 'IMAGE');
  if (!img) return '';
  return (img as any).imageHash ?? '';
}

function getFirstSolidFill(node: INode): ISolidPaint | null {
  if (!node.fills || node.fills === MIXED) return null;
  const fill = node.fills.find(f => f.type === 'SOLID' && f.visible !== false);
  return fill ? fill as ISolidPaint : null;
}

function computeBackground(node: INode): string | null {
  if (!node.fills || node.fills === MIXED) return null;
  if (node.type === NodeType.Text) return null;
  if (hasImageFill(node)) return null; // images rendered as <img>

  const visible = node.fills.filter(f => f.visible !== false);
  if (visible.length === 0) return null;

  const backgrounds: string[] = [];
  for (const fill of visible) {
    if (fill.type === 'SOLID') {
      const solid = fill as ISolidPaint;
      backgrounds.push(colorToRgba(solid.color, solid.opacity));
    } else if (fill.type === 'GRADIENT_LINEAR' && 'gradientStops' in fill) {
      const stops = ((fill as any).gradientStops ?? []) as GradientStop[];
      const gt = (fill as any).gradientTransform;
      const anglePrefix = gt ? `${round(gradientTransformToAngle(gt))}deg, ` : '';
      backgrounds.push(`linear-gradient(${anglePrefix}${stops.map(gs => `${colorToRgba(gs.color)} ${round(gs.position * 100)}%`).join(', ')})`);
    } else if (fill.type === 'GRADIENT_RADIAL' && 'gradientStops' in fill) {
      const stops = ((fill as any).gradientStops ?? []) as GradientStop[];
      backgrounds.push(`radial-gradient(${stops.map(gs => `${colorToRgba(gs.color)} ${round(gs.position * 100)}%`).join(', ')})`);
    }
  }

  return backgrounds.length > 0 ? backgrounds.join(', ') : null;
}

interface GradientStop { color: { r: number; g: number; b: number; a?: number }; position: number }

function computeBorder(node: INode): string | null {
  if (!node.strokes || node.strokes.length === 0) return null;
  const stroke = node.strokes.find(s => s.type === 'SOLID' && s.visible !== false);
  if (!stroke) return null;
  const solid = stroke as ISolidPaint;
  const weight = (typeof node.strokeWeight === 'number') ? node.strokeWeight : 1;
  return `${weight}px solid ${colorToRgba(solid.color, solid.opacity)}`;
}

function computeBorderRadius(node: INode): string | null {
  if (node.topLeftRadius || node.topRightRadius || node.bottomLeftRadius || node.bottomRightRadius) {
    const tl = node.topLeftRadius ?? 0;
    const tr = node.topRightRadius ?? 0;
    const br = node.bottomRightRadius ?? 0;
    const bl = node.bottomLeftRadius ?? 0;
    if (tl === tr && tr === br && br === bl) return `${tl}px`;
    return `${tl}px ${tr}px ${br}px ${bl}px`;
  }
  if (node.cornerRadius && node.cornerRadius !== MIXED && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    return `${node.cornerRadius}px`;
  }
  return null;
}

function computeBoxShadow(node: INode): string | null {
  if (!node.effects || node.effects.length === 0) return null;
  const shadows = node.effects
    .filter(e => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map(e => {
      const offset = (e as any).offset ?? { x: 0, y: 0 };
      const radius = e.radius ?? 0;
      const spread = (e as any).spread ?? 0;
      const color = (e as any).color ? colorToRgba((e as any).color) : 'rgba(0,0,0,0.25)';
      const inset = e.type === 'INNER_SHADOW' ? 'inset ' : '';
      return `${inset}${offset.x}px ${offset.y}px ${radius}px ${spread}px ${color}`;
    });
  return shadows.length > 0 ? shadows.join(', ') : null;
}

// ─── Utilities ────────────────────────────────────────────────

function colorToRgba(color: { r: number; g: number; b: number; a?: number }, opacity?: number): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = round((color.a ?? 1) * (opacity ?? 1));
  if (a >= 1) {
    // Use hex for clean output
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Stable key for a node (used to match behavior classes) */
function nodeKey(node: INode): string {
  return node.id ?? `${node.name}:${node.x}:${node.y}`;
}

/** Convert StateOverride to CSS properties */
function stateOverrideToCssReact(override: StateOverride): string[] {
  const props: string[] = [];
  if (override.fills && override.fills.length > 0) {
    const fill = override.fills[0] as any;
    if (fill?.type === 'SOLID' && fill.color) {
      props.push(`background: ${colorToRgba(fill.color, fill.opacity)}`);
    }
  }
  if (override.opacity !== undefined) props.push(`opacity: ${round(override.opacity)}`);
  if (override.cornerRadius !== undefined) props.push(`border-radius: ${override.cornerRadius}px`);
  if (override.fontSize !== undefined) props.push(`font-size: ${override.fontSize}px`);
  if (override.fontWeight !== undefined) props.push(`font-weight: ${override.fontWeight}`);
  return props;
}

/** Convert ResponsiveRule to CSS properties */
function responsiveRuleToCssReact(rule: ResponsiveRule): string[] {
  const props: string[] = [];
  const p = rule.props as any;
  if (p.width !== undefined) props.push(`width: ${p.width}px`);
  if (p.height !== undefined) props.push(`height: ${p.height}px`);
  if (p.fontSize !== undefined) props.push(`font-size: ${p.fontSize}px`);
  if (p.fontWeight !== undefined) props.push(`font-weight: ${p.fontWeight}`);
  if (p.opacity !== undefined) props.push(`opacity: ${p.opacity}`);
  if (p.visible === false) props.push('display: none');
  if (p.layoutMode !== undefined) {
    props.push(`flex-direction: ${p.layoutMode === 'VERTICAL' ? 'column' : 'row'}`);
  }
  return props;
}

function gradientTransformToAngle(t: { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number }): number {
  const rad = Math.atan2(t.m01, t.m00);
  return ((rad * 180 / Math.PI) + 90 + 360) % 360;
}

function escapeJsx(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;');
}

function sanitizeComponentName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toUpperCase());
  return cleaned || 'Design';
}

function formatStyleObject(style: Record<string, string | number>, pad: string, indent: number): string {
  const entries = Object.entries(style);
  if (entries.length === 0) return '{}';
  if (entries.length <= 3) {
    const pairs = entries.map(([k, v]) => `${k}: ${formatStyleValue(v)}`).join(', ');
    return `{ ${pairs} }`;
  }
  const inner = ' '.repeat(indent);
  const pairs = entries.map(([k, v]) => `${pad}${inner}${k}: ${formatStyleValue(v)},`).join('\n');
  return `{\n${pairs}\n${pad}}`;
}

function formatStyleValue(v: string | number): string {
  if (typeof v === 'number') return String(v);
  return `'${v}'`;
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`);
}

function formatCssValue(prop: string, val: string | number): string {
  if (typeof val === 'number') {
    // Properties that don't need units
    const unitless = new Set(['opacity', 'fontWeight', 'flexGrow', 'flexShrink', 'zIndex', 'lineHeight']);
    if (unitless.has(prop)) return String(val);
    return `${val}px`;
  }
  return val;
}
