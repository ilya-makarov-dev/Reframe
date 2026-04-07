/**
 * SVG Exporter
 *
 * Renders a reframe scene tree to SVG markup.
 * Supports: rectangles, ellipses, text, groups, frames,
 * fills (solid, gradient), strokes, effects (drop shadow, blur),
 * corner radius, opacity, rotation, clipping.
 */

import type {
  Fill, Stroke, Effect, Color,
  TextAlignHorizontal,
} from '../engine/types';

// ─── Types ─────────────────────────────────────────────────────

/** Any node-like object with the reframe scene format */
interface SceneNodeLike {
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  blendMode?: string;
  clipsContent?: boolean;

  // Shape
  fills?: Fill[];
  strokes?: Stroke[];
  effects?: Effect[];
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  independentCorners?: boolean;
  dashPattern?: number[];

  // Text
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  italic?: boolean;
  textAlignHorizontal?: TextAlignHorizontal | string;
  lineHeight?: number | null;
  letterSpacing?: number;

  // Children
  children?: SceneNodeLike[];
}

export interface SvgExportOptions {
  /** Include XML declaration (default: true) */
  xmlDeclaration?: boolean;
  /** Pretty print with indentation (default: true) */
  pretty?: boolean;
  /** Indent string (default: '  ') */
  indent?: string;
  /** Include node names as data attributes (default: false) */
  includeNames?: boolean;
  /** Background color for the SVG (default: none — transparent) */
  background?: string;
}

// ─── Color Helpers ─────────────────────────────────────────────

function colorToHex(c: Color): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function colorToRgba(c: Color): string {
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a.toFixed(3)})`;
}

// ─── SVG Builder ───────────────────────────────────────────────

let _defCounter = 0;
let _defs: string[] = [];

function resetDefs(): void {
  _defCounter = 0;
  _defs = [];
}

function addDef(def: string): string {
  const id = `d${_defCounter++}`;
  _defs.push(def.replace('__ID__', id));
  return id;
}

function buildGradientDef(fill: Fill): string | null {
  if (!fill.gradientStops?.length) return null;

  const stops = fill.gradientStops
    .map(s => `<stop offset="${s.position}" stop-color="${colorToHex(s.color)}" stop-opacity="${s.color.a}"/>`)
    .join('');

  if (fill.type === 'GRADIENT_LINEAR') {
    const t = fill.gradientTransform;
    const xform = t
      ? ` gradientTransform="matrix(${t.m00} ${t.m10} ${t.m01} ${t.m11} ${t.m02} ${t.m12})"`
      : '';
    return addDef(`<linearGradient id="__ID__"${xform}>${stops}</linearGradient>`);
  }
  if (fill.type === 'GRADIENT_RADIAL') {
    return addDef(`<radialGradient id="__ID__">${stops}</radialGradient>`);
  }
  return null;
}

function buildDropShadowFilter(effects: Effect[]): string | null {
  const shadows = effects.filter(e => e.type === 'DROP_SHADOW' && e.visible !== false);
  if (!shadows.length) return null;

  const filters = shadows.map(s =>
    `<feDropShadow dx="${s.offset.x}" dy="${s.offset.y}" stdDeviation="${s.radius / 2}" flood-color="${colorToRgba(s.color)}" flood-opacity="${s.color.a}"/>`
  ).join('');

  return addDef(`<filter id="__ID__">${filters}</filter>`);
}

function buildBlurFilter(effects: Effect[]): string | null {
  const blurs = effects.filter(e => e.type === 'LAYER_BLUR' && e.visible !== false);
  if (!blurs.length) return null;

  const blur = blurs[0];
  return addDef(
    `<filter id="__ID__"><feGaussianBlur stdDeviation="${blur.radius / 2}"/></filter>`
  );
}

function getFillAttr(fills?: Fill[]): { fill: string; fillOpacity?: string } {
  if (!fills?.length) return { fill: 'none' };

  // Use last visible fill (Figma renders top fill last = on top)
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    if (f.visible === false) continue;

    if (f.type === 'SOLID') {
      const hex = colorToHex(f.color);
      const opacity = f.opacity * f.color.a;
      if (opacity >= 1) return { fill: hex };
      return { fill: hex, fillOpacity: opacity.toFixed(3) };
    }

    if (f.type.startsWith('GRADIENT_')) {
      const gradId = buildGradientDef(f);
      if (gradId) return { fill: `url(#${gradId})` };
    }

    if (f.type === 'IMAGE') {
      // Represent image fills as a gray placeholder in SVG
      return { fill: '#cccccc' };
    }
  }

  return { fill: 'none' };
}

function getStrokeAttrs(strokes?: Stroke[], nodeDashPattern?: number[]): Record<string, string> {
  if (!strokes?.length) return {};
  const s = strokes.find(s => s.visible !== false);
  if (!s) return {};

  const attrs: Record<string, string> = {
    stroke: colorToHex(s.color),
    'stroke-width': String(s.weight),
  };
  if (s.opacity < 1) attrs['stroke-opacity'] = s.opacity.toFixed(3);
  // dashPattern can live on stroke or node — check both
  const dash = s.dashPattern?.length ? s.dashPattern : nodeDashPattern;
  if (dash?.length) attrs['stroke-dasharray'] = dash.join(' ');
  if (s.cap && s.cap !== 'NONE') attrs['stroke-linecap'] = s.cap.toLowerCase();
  if (s.join && s.join !== 'MITER') attrs['stroke-linejoin'] = s.join.toLowerCase();

  return attrs;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function attrs(obj: Record<string, string | undefined>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
}

// ─── Node Renderers ────────────────────────────────────────────

function renderNode(
  node: SceneNodeLike,
  depth: number,
  opts: Required<SvgExportOptions>,
): string {
  if (node.visible === false) return '';

  const indent = opts.pretty ? opts.indent.repeat(depth) : '';
  const nl = opts.pretty ? '\n' : '';
  const lines: string[] = [];

  // Transform
  const transforms: string[] = [];
  const nx = node.x || 0;
  const ny = node.y || 0;
  const nw = node.width || 0;
  const nh = node.height || 0;
  if (nx || ny) transforms.push(`translate(${nx},${ny})`);
  if (node.rotation) transforms.push(`rotate(${-node.rotation},${nw / 2},${nh / 2})`);
  const transform = transforms.length ? transforms.join(' ') : undefined;

  // Group-level attributes
  const groupAttrs: Record<string, string | undefined> = {};
  if (transform) groupAttrs.transform = transform;
  if (node.opacity !== undefined && node.opacity < 1) groupAttrs.opacity = node.opacity.toFixed(3);
  if (opts.includeNames && node.name) groupAttrs['data-name'] = escapeXml(node.name);

  // Effects
  const filterIds: string[] = [];
  if (node.effects?.length) {
    const shadowFilter = buildDropShadowFilter(node.effects);
    if (shadowFilter) filterIds.push(shadowFilter);
    const blurFilter = buildBlurFilter(node.effects);
    if (blurFilter) filterIds.push(blurFilter);
  }
  if (filterIds.length) {
    groupAttrs.filter = filterIds.map(id => `url(#${id})`).join(' ');
  }

  const type = node.type;

  // Clip mask for frames
  let clipId: string | undefined;
  if (node.clipsContent && node.children?.length) {
    const rx = node.independentCorners
      ? Math.max(node.topLeftRadius || 0, node.topRightRadius || 0, node.bottomRightRadius || 0, node.bottomLeftRadius || 0)
      : (node.cornerRadius || 0);
    clipId = addDef(
      `<clipPath id="__ID__"><rect width="${nw}" height="${nh}" rx="${rx}"/></clipPath>`
    );
  }

  switch (type) {
    case 'TEXT': {
      const { fill, fillOpacity } = getFillAttr(node.fills);
      const textAttrs: Record<string, string | undefined> = {
        ...groupAttrs,
        fill,
        'fill-opacity': fillOpacity,
        'font-family': node.fontFamily || 'Inter',
        'font-size': String(node.fontSize || 16),
        'font-weight': node.fontWeight && node.fontWeight !== 400 ? String(node.fontWeight) : undefined,
        'font-style': node.italic ? 'italic' : undefined,
        'letter-spacing': node.letterSpacing ? `${node.letterSpacing}px` : undefined,
        ...getStrokeAttrs(node.strokes, node.dashPattern),
      };

      // Text anchor
      const align = node.textAlignHorizontal || 'LEFT';
      let textX = '0';
      let anchor = 'start';
      if (align === 'CENTER') { textX = String(nw / 2); anchor = 'middle'; }
      else if (align === 'RIGHT') { textX = String(nw); anchor = 'end'; }
      textAttrs['text-anchor'] = anchor;

      const lh = node.lineHeight || (node.fontSize || 16) * 1.2;

      // Split text into lines
      const textContent = node.text || '';
      const textLines = textContent.split('\n');

      if (textLines.length === 1) {
        textAttrs.x = textX;
        textAttrs.y = String(lh * 0.8); // baseline offset
        lines.push(`${indent}<text ${attrs(textAttrs)}>${escapeXml(textContent)}</text>`);
      } else {
        lines.push(`${indent}<text ${attrs(textAttrs)}>`);
        textLines.forEach((line, i) => {
          const tspanAttrs: Record<string, string> = {
            x: textX,
            dy: i === 0 ? String(lh * 0.8) : String(lh),
          };
          lines.push(`${indent}${opts.indent}<tspan ${attrs(tspanAttrs)}>${escapeXml(line)}</tspan>`);
        });
        lines.push(`${indent}</text>`);
      }
      break;
    }

    case 'ELLIPSE': {
      const { fill, fillOpacity } = getFillAttr(node.fills);
      const cx = nw / 2;
      const cy = nh / 2;
      const ellipseAttrs: Record<string, string | undefined> = {
        ...groupAttrs,
        cx: String(cx), cy: String(cy),
        rx: String(cx), ry: String(cy),
        fill,
        'fill-opacity': fillOpacity,
        ...getStrokeAttrs(node.strokes, node.dashPattern),
      };
      lines.push(`${indent}<ellipse ${attrs(ellipseAttrs)}/>`);
      break;
    }

    case 'LINE': {
      const strokeAttrs = getStrokeAttrs(node.strokes, node.dashPattern);
      if (!strokeAttrs.stroke) strokeAttrs.stroke = '#000000';
      const lineAttrs: Record<string, string | undefined> = {
        ...groupAttrs,
        x1: '0', y1: '0',
        x2: String(nw), y2: String(nh),
        ...strokeAttrs,
      };
      lines.push(`${indent}<line ${attrs(lineAttrs)}/>`);
      break;
    }

    default: {
      // FRAME, RECTANGLE, GROUP, COMPONENT, INSTANCE, etc.
      const hasChildren = node.children?.length;
      const isContainer = hasChildren || type === 'FRAME' || type === 'GROUP' ||
        type === 'COMPONENT' || type === 'INSTANCE' || type === 'SECTION';

      if (isContainer) {
        // Render as <g> with optional background rect
        lines.push(`${indent}<g ${attrs(groupAttrs)}>`);

        // Background rect for frames/rectangles with fills
        if (node.fills?.length && node.fills.some(f => f.visible !== false)) {
          const { fill, fillOpacity } = getFillAttr(node.fills);
          const strokeAttrs = getStrokeAttrs(node.strokes, node.dashPattern);
          if (node.independentCorners && hasDistinctCorners(node)) {
            const d = roundedRectPath(nw, nh, node.topLeftRadius || 0, node.topRightRadius || 0, node.bottomRightRadius || 0, node.bottomLeftRadius || 0);
            lines.push(`${indent}${opts.indent}<path d="${d}" fill="${fill}" fill-opacity="${fillOpacity}" ${attrs(strokeAttrs)}/>`);
          } else {
            const rx = node.cornerRadius || 0;
            const rectAttrs: Record<string, string | undefined> = {
              width: String(nw), height: String(nh),
              fill, 'fill-opacity': fillOpacity,
              rx: rx ? String(rx) : undefined,
              ...strokeAttrs,
            };
            lines.push(`${indent}${opts.indent}<rect ${attrs(rectAttrs)}/>`);
          }
        }

        // Clip children if needed
        if (clipId) {
          lines.push(`${indent}${opts.indent}<g clip-path="url(#${clipId})">`);
        }

        // Render children
        if (hasChildren) {
          for (const child of node.children!) {
            const childSvg = renderNode(child, depth + (clipId ? 2 : 1), opts);
            if (childSvg) lines.push(childSvg);
          }
        }

        if (clipId) {
          lines.push(`${indent}${opts.indent}</g>`);
        }

        lines.push(`${indent}</g>`);
      } else {
        // Leaf rectangle
        const { fill, fillOpacity } = getFillAttr(node.fills);
        const strokeAttrs = getStrokeAttrs(node.strokes, node.dashPattern);
        if (node.independentCorners && hasDistinctCorners(node)) {
          const d = roundedRectPath(nw, nh, node.topLeftRadius || 0, node.topRightRadius || 0, node.bottomRightRadius || 0, node.bottomLeftRadius || 0);
          const pathAttrs: Record<string, string | undefined> = {
            ...groupAttrs,
            d, fill, 'fill-opacity': fillOpacity,
            ...strokeAttrs,
          };
          lines.push(`${indent}<path ${attrs(pathAttrs)}/>`);
          return lines.join('\n');
        }
        const rx = node.cornerRadius || 0;
        const rectAttrs: Record<string, string | undefined> = {
          ...groupAttrs,
          width: String(nw),
          height: String(nh),
          fill,
          'fill-opacity': fillOpacity,
          rx: rx ? String(rx) : undefined,
          ...strokeAttrs,
        };
        lines.push(`${indent}<rect ${attrs(rectAttrs)}/>`);
      }
      break;
    }
  }

  return lines.join(nl);
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Export a reframe scene tree to SVG markup.
 *
 * @param scene - Scene object with { root: SceneNodeLike } or a direct node tree
 * @param options - Export options
 * @returns SVG markup string
 *
 * @example
 * ```ts
 * const svg = exportToSvg(scene);
 * fs.writeFileSync('output.svg', svg);
 * ```
 */
export function exportToSvg(
  scene: { root: SceneNodeLike } | SceneNodeLike,
  options?: SvgExportOptions,
): string {
  const opts: Required<SvgExportOptions> = {
    xmlDeclaration: options?.xmlDeclaration ?? true,
    pretty: options?.pretty ?? true,
    indent: options?.indent ?? '  ',
    includeNames: options?.includeNames ?? false,
    background: options?.background ?? '',
  };

  const root = 'root' in scene ? scene.root : scene;
  const nl = opts.pretty ? '\n' : '';

  resetDefs();

  // Render all nodes first (collects defs)
  const bodyParts: string[] = [];

  // Optional background
  if (opts.background) {
    bodyParts.push(`${opts.indent}<rect width="${root.width}" height="${root.height}" fill="${opts.background}"/>`);
  }

  // Background fill of the root frame
  if (root.fills?.length && root.fills.some(f => f.visible !== false)) {
    const { fill, fillOpacity } = getFillAttr(root.fills);
    bodyParts.push(`${opts.indent}<rect width="${root.width}" height="${root.height}" fill="${fill}"${fillOpacity ? ` fill-opacity="${fillOpacity}"` : ''}/>`);
  }

  // Render children
  if (root.children?.length) {
    for (const child of root.children) {
      const childSvg = renderNode(child, 1, opts);
      if (childSvg) bodyParts.push(childSvg);
    }
  }

  // Assemble SVG
  const parts: string[] = [];

  if (opts.xmlDeclaration) {
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  }

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${root.width}" height="${root.height}" viewBox="0 0 ${root.width} ${root.height}">`);

  // Defs
  if (_defs.length) {
    parts.push(`${opts.indent}<defs>`);
    for (const def of _defs) {
      parts.push(`${opts.indent}${opts.indent}${def}`);
    }
    parts.push(`${opts.indent}</defs>`);
  }

  parts.push(...bodyParts);
  parts.push(`</svg>`);

  return parts.join(nl) + nl;
}

/**
 * Export a SceneGraph node to SVG.
 * Convenience wrapper that extracts the node tree from a SceneGraph.
 */
export function exportSceneGraphToSvg(
  graph: { getNode(id: string): any },
  rootId: string,
  options?: SvgExportOptions,
): string {
  const root = graph.getNode(rootId);
  if (!root) throw new Error(`Node ${rootId} not found in graph`);

  // Convert SceneGraph flat map to nested tree
  const tree = graphNodeToTree(graph, rootId);
  return exportToSvg(tree, options);
}

function graphNodeToTree(
  graph: { getNode(id: string): any },
  nodeId: string,
): SceneNodeLike {
  const node = graph.getNode(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);

  const result: SceneNodeLike = {
    type: node.type,
    name: node.name,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: node.rotation,
    opacity: node.opacity,
    visible: node.visible,
    blendMode: node.blendMode,
    clipsContent: node.clipsContent,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    cornerRadius: node.cornerRadius,
    topLeftRadius: node.topLeftRadius,
    topRightRadius: node.topRightRadius,
    bottomRightRadius: node.bottomRightRadius,
    bottomLeftRadius: node.bottomLeftRadius,
    independentCorners: node.independentCorners,
    text: node.text,
    fontSize: node.fontSize,
    fontFamily: node.fontFamily,
    fontWeight: node.fontWeight,
    italic: node.italic,
    textAlignHorizontal: node.textAlignHorizontal,
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    dashPattern: node.dashPattern,
  };

  if (node.childIds?.length) {
    result.children = node.childIds
      .map((id: string) => graphNodeToTree(graph, id))
      .filter(Boolean);
  }

  return result;
}

// ─── Independent corner radii helpers ─────────────────────────

function hasDistinctCorners(node: { topLeftRadius?: number; topRightRadius?: number; bottomRightRadius?: number; bottomLeftRadius?: number }): boolean {
  const tl = node.topLeftRadius || 0;
  const tr = node.topRightRadius || 0;
  const br = node.bottomRightRadius || 0;
  const bl = node.bottomLeftRadius || 0;
  return !(tl === tr && tr === br && br === bl);
}

/** Build an SVG path for a rounded rect with independent corner radii. */
function roundedRectPath(w: number, h: number, tl: number, tr: number, br: number, bl: number): string {
  // Clamp radii so they don't exceed half the dimension
  const maxR = Math.min(w / 2, h / 2);
  tl = Math.min(tl, maxR); tr = Math.min(tr, maxR);
  br = Math.min(br, maxR); bl = Math.min(bl, maxR);
  return [
    `M ${tl} 0`,
    `H ${w - tr}`,
    tr ? `A ${tr} ${tr} 0 0 1 ${w} ${tr}` : `L ${w} 0`,
    `V ${h - br}`,
    br ? `A ${br} ${br} 0 0 1 ${w - br} ${h}` : `L ${w} ${h}`,
    `H ${bl}`,
    bl ? `A ${bl} ${bl} 0 0 1 0 ${h - bl}` : `L 0 ${h}`,
    `V ${tl}`,
    tl ? `A ${tl} ${tl} 0 0 1 ${tl} 0` : `L 0 0`,
    'Z',
  ].join(' ');
}
