/**
 * SVG Importer — SVG markup → reframe scene graph
 *
 * Parses SVG and converts elements to reframe SceneNode tree.
 * Supports: rect, circle, ellipse, line, path, text, g, svg, polygon, polyline, image.
 */

import { SceneGraph } from '../engine/scene-graph';
import type { SceneNode, Color, Fill, Stroke } from '../engine/types';

// svg-parser types
interface SvgNode {
  type: 'element' | 'text';
  tagName?: string;
  properties?: Record<string, string | number>;
  children?: SvgNode[];
  value?: string;
}

interface SvgAst {
  type: 'root';
  children: SvgNode[];
}

let svgParser: { parse(svg: string): SvgAst } | null = null;

async function ensureParser(): Promise<void> {
  if (svgParser) return;
  try {
    const mod = await import('svg-parser');
    svgParser = (mod as any).default ?? mod;
  } catch {
    throw new Error('svg-parser not available. Install it: npm install svg-parser');
  }
}

// ─── Public API ────────────────────────────────────────────────

export interface SvgImportOptions {
  /** Override the scene name (default: from SVG title or "SVG Import") */
  name?: string;
}

export interface SvgImportResult {
  graph: SceneGraph;
  rootId: string;
  stats: {
    elements: number;
    unsupported: string[];
  };
}

/**
 * Import SVG markup into a reframe SceneGraph.
 */
export async function importFromSvg(
  svgMarkup: string,
  options: SvgImportOptions = {},
): Promise<SvgImportResult> {
  await ensureParser();

  const ast = svgParser!.parse(svgMarkup);
  const graph = new SceneGraph();
  const page = graph.addPage('SVG Import');

  let elementCount = 0;
  const unsupported: string[] = [];

  // Find the <svg> element
  const svgElement = findSvgElement(ast);
  if (!svgElement) {
    throw new Error('No <svg> element found in input');
  }

  const props = svgElement.properties ?? {};
  const viewBox = parseViewBox(String(props.viewBox ?? ''));
  const width = parseFloat(String(props.width ?? viewBox?.width ?? 300));
  const height = parseFloat(String(props.height ?? viewBox?.height ?? 150));

  // Create root frame
  const rootNode = graph.createNode('FRAME', page.id, {
    name: options.name ?? 'SVG Import',
    width,
    height,
    clipsContent: true,
    fills: [],
  });

  // Process children
  if (svgElement.children) {
    for (const child of svgElement.children) {
      processNode(graph, child, rootNode.id, { elementCount: 0, unsupported }, viewBox, width, height);
    }
  }

  // Count elements
  function countElements(nodeId: string): number {
    let count = 1;
    const node = graph.getNode(nodeId);
    if (node) {
      for (const childId of node.childIds) {
        count += countElements(childId);
      }
    }
    return count;
  }

  return {
    graph,
    rootId: rootNode.id,
    stats: {
      elements: countElements(rootNode.id),
      unsupported: [...new Set(unsupported)],
    },
  };
}

// ─── AST Processing ────────────────────────────────────────────

interface ProcessContext {
  elementCount: number;
  unsupported: string[];
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function findSvgElement(ast: SvgAst): SvgNode | null {
  for (const child of ast.children) {
    if (child.type === 'element' && child.tagName === 'svg') return child;
  }
  return null;
}

function parseViewBox(vb: string): ViewBox | null {
  if (!vb) return null;
  const parts = vb.split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

function processNode(
  graph: SceneGraph,
  node: SvgNode,
  parentId: string,
  ctx: ProcessContext,
  viewBox: ViewBox | null,
  canvasW: number,
  canvasH: number,
): void {
  if (node.type === 'text') return; // text content handled by parent
  if (!node.tagName) return;

  const props = node.properties ?? {};
  const tag = node.tagName.toLowerCase();

  switch (tag) {
    case 'rect':
      createRect(graph, parentId, props, ctx);
      break;
    case 'circle':
      createCircle(graph, parentId, props, ctx);
      break;
    case 'ellipse':
      createEllipse(graph, parentId, props, ctx);
      break;
    case 'line':
      createLine(graph, parentId, props, ctx);
      break;
    case 'path':
      createPath(graph, parentId, props, ctx);
      break;
    case 'polygon':
    case 'polyline':
      createPolygonOrPolyline(graph, parentId, tag, props, ctx);
      break;
    case 'text':
      createText(graph, parentId, node, props, ctx);
      break;
    case 'g':
      createGroup(graph, parentId, node, props, ctx, viewBox, canvasW, canvasH);
      break;
    case 'defs':
    case 'style':
    case 'title':
    case 'desc':
    case 'metadata':
    case 'clipPath':
    case 'mask':
    case 'pattern':
    case 'linearGradient':
    case 'radialGradient':
    case 'symbol':
    case 'marker':
      // Skip definition elements (gradient/pattern support would go here)
      break;
    case 'use':
      // TODO: resolve <use> references
      ctx.unsupported.push('use');
      break;
    case 'image':
      createImage(graph, parentId, props, ctx);
      break;
    default:
      ctx.unsupported.push(tag);
      break;
  }
}

// ─── Element Creators ──────────────────────────────────────────

function createRect(
  graph: SceneGraph,
  parentId: string,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;
  const x = num(props.x);
  const y = num(props.y);
  const w = num(props.width);
  const h = num(props.height);
  const rx = num(props.rx);
  const ry = num(props.ry);
  const r = Math.max(rx, ry);

  graph.createNode('RECTANGLE', parentId, {
    name: str(props.id) || `rect-${ctx.elementCount}`,
    x, y, width: w, height: h,
    cornerRadius: r,
    topLeftRadius: r, topRightRadius: r,
    bottomLeftRadius: r, bottomRightRadius: r,
    fills: parseFill(props),
    strokes: parseStroke(props),
    opacity: num(props.opacity, 1),
  });
}

function createCircle(
  graph: SceneGraph,
  parentId: string,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;
  const cx = num(props.cx);
  const cy = num(props.cy);
  const r = num(props.r);

  graph.createNode('ELLIPSE', parentId, {
    name: str(props.id) || `circle-${ctx.elementCount}`,
    x: cx - r, y: cy - r,
    width: r * 2, height: r * 2,
    fills: parseFill(props),
    strokes: parseStroke(props),
    opacity: num(props.opacity, 1),
  });
}

function createEllipse(
  graph: SceneGraph,
  parentId: string,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;
  const cx = num(props.cx);
  const cy = num(props.cy);
  const rx = num(props.rx);
  const ry = num(props.ry);

  graph.createNode('ELLIPSE', parentId, {
    name: str(props.id) || `ellipse-${ctx.elementCount}`,
    x: cx - rx, y: cy - ry,
    width: rx * 2, height: ry * 2,
    fills: parseFill(props),
    strokes: parseStroke(props),
    opacity: num(props.opacity, 1),
  });
}

function createLine(
  graph: SceneGraph,
  parentId: string,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;
  const x1 = num(props.x1);
  const y1 = num(props.y1);
  const x2 = num(props.x2);
  const y2 = num(props.y2);

  graph.createNode('LINE', parentId, {
    name: str(props.id) || `line-${ctx.elementCount}`,
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    width: Math.abs(x2 - x1) || 1,
    height: Math.abs(y2 - y1) || 1,
    strokes: parseStroke(props),
    opacity: num(props.opacity, 1),
  });
}

function createPath(
  graph: SceneGraph,
  parentId: string,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;
  const d = str(props.d);
  const bounds = estimatePathBounds(d);

  graph.createNode('VECTOR', parentId, {
    name: str(props.id) || `path-${ctx.elementCount}`,
    x: bounds.x, y: bounds.y,
    width: bounds.width || 1,
    height: bounds.height || 1,
    fills: parseFill(props),
    strokes: parseStroke(props),
    opacity: num(props.opacity, 1),
  });
}

function createPolygonOrPolyline(
  graph: SceneGraph,
  parentId: string,
  tag: string,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;
  const points = parsePoints(str(props.points));
  const bounds = pointsBounds(points);

  graph.createNode('POLYGON', parentId, {
    name: str(props.id) || `${tag}-${ctx.elementCount}`,
    x: bounds.x, y: bounds.y,
    width: bounds.width || 1,
    height: bounds.height || 1,
    fills: tag === 'polygon' ? parseFill(props) : [],
    strokes: parseStroke(props),
    opacity: num(props.opacity, 1),
  });
}

function createText(
  graph: SceneGraph,
  parentId: string,
  node: SvgNode,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;
  const textContent = extractTextContent(node);
  const fontSize = num(props['font-size'] ?? props.fontSize, 16);

  graph.createNode('TEXT', parentId, {
    name: str(props.id) || `text-${ctx.elementCount}`,
    x: num(props.x), y: num(props.y) - fontSize,
    width: textContent.length * fontSize * 0.5,
    height: fontSize * 1.2,
    text: textContent,
    fontSize,
    fontFamily: str(props['font-family'] ?? props.fontFamily) || 'sans-serif',
    fontWeight: num(props['font-weight'] ?? props.fontWeight, 400),
    fills: parseFill(props),
    opacity: num(props.opacity, 1),
  });
}

function createGroup(
  graph: SceneGraph,
  parentId: string,
  node: SvgNode,
  props: Record<string, string | number>,
  ctx: ProcessContext,
  viewBox: ViewBox | null,
  canvasW: number,
  canvasH: number,
): void {
  ctx.elementCount++;
  const group = graph.createNode('GROUP', parentId, {
    name: str(props.id) || `group-${ctx.elementCount}`,
    opacity: num(props.opacity, 1),
  });

  if (node.children) {
    for (const child of node.children) {
      processNode(graph, child, group.id, ctx, viewBox, canvasW, canvasH);
    }
  }
}

function createImage(
  graph: SceneGraph,
  parentId: string,
  props: Record<string, string | number>,
  ctx: ProcessContext,
): void {
  ctx.elementCount++;

  graph.createNode('RECTANGLE', parentId, {
    name: str(props.id) || `image-${ctx.elementCount}`,
    x: num(props.x), y: num(props.y),
    width: num(props.width, 100),
    height: num(props.height, 100),
    fills: [{
      type: 'IMAGE' as const,
      color: { r: 1, g: 1, b: 1, a: 1 },
      opacity: 1,
      visible: true,
      imageHash: str(props.href ?? props['xlink:href']) || '',
    }],
  });
}

// ─── Style Parsing ─────────────────────────────────────────────

function parseFill(props: Record<string, string | number>): Fill[] {
  const fill = str(props.fill);
  if (fill === 'none' || fill === 'transparent') return [];

  const color = parseColor(fill || '#000000');
  if (!color) return [];

  return [{
    type: 'SOLID',
    color,
    opacity: num(props['fill-opacity'] ?? props.fillOpacity, 1),
    visible: true,
  }];
}

function parseStroke(props: Record<string, string | number>): Stroke[] {
  const stroke = str(props.stroke);
  if (!stroke || stroke === 'none' || stroke === 'transparent') return [];

  const color = parseColor(stroke);
  if (!color) return [];

  return [{
    color,
    weight: num(props['stroke-width'] ?? props.strokeWidth, 1),
    opacity: num(props['stroke-opacity'] ?? props.strokeOpacity, 1),
    visible: true,
    align: 'CENTER' as const,
  }];
}

function parseColor(value: string): Color | null {
  if (!value || value === 'none') return null;

  // Named colors (common subset)
  const named: Record<string, string> = {
    black: '#000000', white: '#ffffff', red: '#ff0000',
    green: '#008000', blue: '#0000ff', yellow: '#ffff00',
    orange: '#ffa500', purple: '#800080', gray: '#808080',
    grey: '#808080', pink: '#ffc0cb', cyan: '#00ffff',
    magenta: '#ff00ff', transparent: '#00000000',
  };
  const lower = value.toLowerCase().trim();
  if (named[lower]) value = named[lower];

  // Hex
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16) / 255,
        g: parseInt(hex[1] + hex[1], 16) / 255,
        b: parseInt(hex[2] + hex[2], 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
  }

  // rgb(r, g, b) / rgba(r, g, b, a)
  const rgbMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]) / 255,
      g: parseInt(rgbMatch[2]) / 255,
      b: parseInt(rgbMatch[3]) / 255,
      a: rgbMatch[4] ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  return null;
}

// ─── Geometry Helpers ──────────────────────────────────────────

function estimatePathBounds(d: string): { x: number; y: number; width: number; height: number } {
  if (!d) return { x: 0, y: 0, width: 0, height: 0 };

  const numbers = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
  if (numbers.length < 2) return { x: 0, y: 0, width: 0, height: 0 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  // Simple heuristic: treat pairs of numbers as x,y coordinates
  for (let i = 0; i < numbers.length - 1; i += 2) {
    const x = numbers[i];
    const y = numbers[i + 1];
    if (isFinite(x) && isFinite(y)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function parsePoints(pointsStr: string): Array<{ x: number; y: number }> {
  if (!pointsStr) return [];
  const nums = pointsStr.trim().split(/[\s,]+/).map(Number);
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    points.push({ x: nums[i], y: nums[i + 1] });
  }
  return points;
}

function pointsBounds(points: Array<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function extractTextContent(node: SvgNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (!node.children) return '';
  return node.children.map(extractTextContent).join('');
}

// ─── Utils ─────────────────────────────────────────────────────

function num(val: string | number | undefined, def = 0): number {
  if (val === undefined || val === null || val === '') return def;
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? def : n;
}

function str(val: string | number | undefined): string {
  if (val === undefined || val === null) return '';
  return String(val);
}
