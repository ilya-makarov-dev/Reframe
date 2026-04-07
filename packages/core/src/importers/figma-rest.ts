/**
 * Figma REST API Importer
 *
 * Fetches a Figma file via REST API and converts the node tree
 * into reframe's SceneNode format.
 *
 * Usage:
 *   const scene = await importFromFigma('FILE_KEY', { token: 'figd_...' });
 *   // scene is a JSON-serializable node tree ready for adaptScene()
 */

import type {
  SceneNode, NodeType, Fill, Stroke, Effect, Color,
  TextAlignHorizontal, TextAlignVertical, TextAutoResize,
  BlendMode, StrokeAlign, StrokeCap, StrokeJoin,
  LayoutMode, LayoutAlign, LayoutCounterAlign, LayoutSizing,
  ConstraintType, StyleRun,
} from '../engine/types';

// ─── Figma API Types ───────────────────────────────────────────

interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  gradientStops?: Array<{ color: FigmaColor; position: number }>;
  gradientHandlePositions?: Array<{ x: number; y: number }>;
  scaleMode?: string;
  imageRef?: string;
  imageTransform?: number[][];
}

interface FigmaEffect {
  type: string;
  visible?: boolean;
  radius?: number;
  color?: FigmaColor;
  offset?: { x: number; y: number };
  spread?: number;
  blendMode?: string;
}

interface FigmaConstraint {
  type: string;
  value: number;
}

interface FigmaLayoutConstraint {
  vertical: string;
  horizontal: string;
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  relativeTransform?: number[][];
  size?: { x: number; y: number };
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  strokeCap?: string;
  strokeJoin?: string;
  strokeDashes?: number[];
  individualStrokeWeights?: { top: number; right: number; bottom: number; left: number };
  effects?: FigmaEffect[];
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  cornerSmoothing?: number;
  clipsContent?: boolean;
  constraints?: FigmaLayoutConstraint;

  // Text
  characters?: string;
  style?: {
    fontFamily?: string;
    fontWeight?: number;
    fontSize?: number;
    italic?: boolean;
    textAlignHorizontal?: string;
    textAlignVertical?: string;
    letterSpacing?: number;
    lineHeightPx?: number;
    lineHeightPercent?: number;
    lineHeightPercentFontSize?: number;
    lineHeightUnit?: string;
    textCase?: string;
    textDecoration?: string;
    textAutoResize?: string;
    maxLines?: number;
    textTruncation?: string;
  };
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, any>;

  // Layout
  layoutMode?: string;
  layoutWrap?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  layoutPositioning?: string;
  layoutGrow?: number;
  layoutAlign?: string;
  itemReverseZIndex?: boolean;
  strokesIncludedInLayout?: boolean;
  counterAxisAlignContent?: string;

  // Sizing
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // Children
  children?: FigmaNode[];

  // Component
  componentId?: string;
  overrides?: any[];

  // Vector
  fillGeometry?: any[];
  strokeGeometry?: any[];

  // Ellipse
  arcData?: { startingAngle: number; endingAngle: number; innerRadius: number };

  // Star / Polygon
  pointCount?: number;
  starInnerRadius?: number;

  // Rotation
  rotation?: number;
}

interface FigmaFile {
  document: FigmaNode;
  name: string;
  lastModified: string;
  version: string;
}

// ─── Options ───────────────────────────────────────────────────

export interface FigmaImportOptions {
  /** Figma personal access token (figd_...) */
  token: string;
  /** Specific node IDs to import (default: all pages) */
  nodeIds?: string[];
  /** Include invisible nodes (default: false) */
  includeHidden?: boolean;
  /** Figma API base URL (default: https://api.figma.com) */
  apiBase?: string;
}

export interface FigmaImportResult {
  /** Root scene node tree (JSON-serializable) */
  scene: Record<string, any>;
  /** File metadata */
  meta: {
    name: string;
    lastModified: string;
    version: string;
    fileKey: string;
    nodeCount: number;
  };
}

// ─── API Client ────────────────────────────────────────────────

async function fetchFigmaFile(
  fileKey: string,
  opts: FigmaImportOptions,
): Promise<FigmaFile> {
  const base = opts.apiBase || 'https://api.figma.com';
  let url = `${base}/v1/files/${fileKey}`;

  if (opts.nodeIds?.length) {
    url += `?ids=${opts.nodeIds.map(id => encodeURIComponent(id)).join(',')}`;
  }

  const res = await fetch(url, {
    headers: { 'X-Figma-Token': opts.token },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<FigmaFile>;
}

// ─── Converter ─────────────────────────────────────────────────

function convertColor(c: FigmaColor): Color {
  return { r: c.r, g: c.g, b: c.b, a: c.a };
}

function convertFill(paint: FigmaPaint): Fill {
  const fill: Fill = {
    type: (paint.type || 'SOLID') as Fill['type'],
    color: paint.color ? convertColor(paint.color) : { r: 0, g: 0, b: 0, a: 1 },
    opacity: paint.opacity ?? 1,
    visible: paint.visible ?? true,
  };

  if (paint.gradientStops) {
    fill.gradientStops = paint.gradientStops.map(s => ({
      color: convertColor(s.color),
      position: s.position,
    }));
  }

  if (paint.imageRef) {
    fill.imageHash = paint.imageRef;
  }

  if (paint.scaleMode) {
    fill.imageScaleMode = paint.scaleMode as Fill['imageScaleMode'];
  }

  return fill;
}

function convertStroke(paint: FigmaPaint, node: FigmaNode): Stroke {
  return {
    color: paint.color ? convertColor(paint.color) : { r: 0, g: 0, b: 0, a: 1 },
    weight: node.strokeWeight ?? 1,
    opacity: paint.opacity ?? 1,
    visible: paint.visible ?? true,
    align: (node.strokeAlign as StrokeAlign) || 'CENTER',
    cap: (node.strokeCap as StrokeCap) || 'NONE',
    join: (node.strokeJoin as StrokeJoin) || 'MITER',
    dashPattern: node.strokeDashes || [],
  };
}

function convertEffect(eff: FigmaEffect): Effect {
  return {
    type: eff.type as Effect['type'],
    color: eff.color ? convertColor(eff.color) : { r: 0, g: 0, b: 0, a: 1 },
    offset: eff.offset || { x: 0, y: 0 },
    radius: eff.radius ?? 0,
    spread: eff.spread ?? 0,
    visible: eff.visible ?? true,
    blendMode: eff.blendMode,
  };
}

function mapNodeType(figmaType: string): NodeType {
  const map: Record<string, NodeType> = {
    DOCUMENT: 'CANVAS',
    CANVAS: 'CANVAS',
    FRAME: 'FRAME',
    GROUP: 'GROUP',
    SECTION: 'SECTION',
    RECTANGLE: 'RECTANGLE',
    ROUNDED_RECTANGLE: 'ROUNDED_RECTANGLE',
    ELLIPSE: 'ELLIPSE',
    TEXT: 'TEXT',
    LINE: 'LINE',
    STAR: 'STAR',
    REGULAR_POLYGON: 'POLYGON',
    VECTOR: 'VECTOR',
    BOOLEAN_OPERATION: 'VECTOR',
    COMPONENT: 'COMPONENT',
    COMPONENT_SET: 'COMPONENT_SET',
    INSTANCE: 'INSTANCE',
    CONNECTOR: 'CONNECTOR',
    SHAPE_WITH_TEXT: 'SHAPE_WITH_TEXT',
    SLICE: 'FRAME',
  };
  return map[figmaType] || 'FRAME';
}

function mapConstraint(c: string): ConstraintType {
  const map: Record<string, ConstraintType> = {
    MIN: 'MIN',
    CENTER: 'CENTER',
    MAX: 'MAX',
    STRETCH: 'STRETCH',
    SCALE: 'SCALE',
    LEFT: 'MIN',
    RIGHT: 'MAX',
    TOP: 'MIN',
    BOTTOM: 'MAX',
    LEFT_RIGHT: 'STRETCH',
    TOP_BOTTOM: 'STRETCH',
  };
  return map[c] || 'MIN';
}

function mapLayoutMode(mode?: string): LayoutMode {
  if (!mode || mode === 'NONE') return 'NONE';
  if (mode === 'HORIZONTAL') return 'HORIZONTAL';
  if (mode === 'VERTICAL') return 'VERTICAL';
  return 'NONE';
}

function mapLayoutAlign(align?: string): LayoutAlign {
  const map: Record<string, LayoutAlign> = {
    MIN: 'MIN', CENTER: 'CENTER', MAX: 'MAX', SPACE_BETWEEN: 'SPACE_BETWEEN',
  };
  return map[align || ''] || 'MIN';
}

function mapCounterAlign(align?: string): LayoutCounterAlign {
  const map: Record<string, LayoutCounterAlign> = {
    MIN: 'MIN', CENTER: 'CENTER', MAX: 'MAX', STRETCH: 'STRETCH', BASELINE: 'BASELINE',
  };
  return map[align || ''] || 'MIN';
}

function mapSizing(mode?: string): LayoutSizing {
  if (mode === 'HUG') return 'HUG';
  if (mode === 'FILL') return 'FILL';
  return 'FIXED';
}

function extractPosition(node: FigmaNode): { x: number; y: number } {
  // relativeTransform is [[a, b, tx], [c, d, ty]]
  if (node.relativeTransform) {
    return {
      x: node.relativeTransform[0][2],
      y: node.relativeTransform[1][2],
    };
  }
  return { x: 0, y: 0 };
}

function extractSize(node: FigmaNode): { width: number; height: number } {
  if (node.size) {
    return { width: node.size.x, height: node.size.y };
  }
  if (node.absoluteBoundingBox) {
    return { width: node.absoluteBoundingBox.width, height: node.absoluteBoundingBox.height };
  }
  return { width: 100, height: 100 };
}

function extractRotation(node: FigmaNode): number {
  if (typeof node.rotation === 'number') return node.rotation;
  // Extract from relativeTransform
  if (node.relativeTransform) {
    const a = node.relativeTransform[0][0];
    const b = node.relativeTransform[0][1];
    return -Math.atan2(b, a) * (180 / Math.PI);
  }
  return 0;
}

function convertStyleRuns(node: FigmaNode): StyleRun[] {
  if (!node.characterStyleOverrides?.length || !node.styleOverrideTable) return [];
  if (!node.characters) return [];

  const runs: StyleRun[] = [];
  let currentOverride = node.characterStyleOverrides[0];
  let runStart = 0;

  for (let i = 1; i <= node.characterStyleOverrides.length; i++) {
    const override = i < node.characterStyleOverrides.length ? node.characterStyleOverrides[i] : -1;
    if (override !== currentOverride) {
      if (currentOverride !== 0) {
        const styleData = node.styleOverrideTable[String(currentOverride)];
        if (styleData) {
          runs.push({
            start: runStart,
            length: i - runStart,
            style: {
              fontFamily: styleData.fontFamily,
              fontWeight: styleData.fontWeight,
              fontSize: styleData.fontSize,
              italic: styleData.italic,
              letterSpacing: styleData.letterSpacing,
              lineHeight: styleData.lineHeightPx ?? null,
              textDecoration: styleData.textDecoration,
              textCase: styleData.textCase,
              fillColor: styleData.fills?.[0]?.color
                ? convertColor(styleData.fills[0].color)
                : undefined,
            },
          });
        }
      }
      currentOverride = override;
      runStart = i;
    }
  }

  return runs;
}

let _nodeCount = 0;

function convertNode(
  figmaNode: FigmaNode,
  includeHidden: boolean,
  parentPos?: { x: number; y: number },
): Record<string, any> | null {
  if (!includeHidden && figmaNode.visible === false) return null;

  const pos = extractPosition(figmaNode);
  const size = extractSize(figmaNode);
  const type = mapNodeType(figmaNode.type);

  _nodeCount++;

  const node: Record<string, any> = {
    type,
    name: figmaNode.name,
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
  };

  // Rotation
  const rotation = extractRotation(figmaNode);
  if (rotation !== 0) node.rotation = rotation;

  // Visibility & opacity
  if (figmaNode.visible === false) node.visible = false;
  if (figmaNode.locked) node.locked = true;
  if (figmaNode.opacity !== undefined && figmaNode.opacity !== 1) node.opacity = figmaNode.opacity;
  if (figmaNode.blendMode && figmaNode.blendMode !== 'PASS_THROUGH') {
    node.blendMode = figmaNode.blendMode;
  }

  // Fills
  if (figmaNode.fills?.length) {
    node.fills = figmaNode.fills
      .filter(f => f.visible !== false)
      .map(f => convertFill(f));
  }

  // Strokes
  if (figmaNode.strokes?.length) {
    node.strokes = figmaNode.strokes
      .filter(s => s.visible !== false)
      .map(s => convertStroke(s, figmaNode));
  }

  // Effects
  if (figmaNode.effects?.length) {
    node.effects = figmaNode.effects
      .filter(e => e.visible !== false)
      .map(e => convertEffect(e));
  }

  // Corner radius
  if (figmaNode.rectangleCornerRadii) {
    node.independentCorners = true;
    node.topLeftRadius = figmaNode.rectangleCornerRadii[0];
    node.topRightRadius = figmaNode.rectangleCornerRadii[1];
    node.bottomRightRadius = figmaNode.rectangleCornerRadii[2];
    node.bottomLeftRadius = figmaNode.rectangleCornerRadii[3];
    node.cornerRadius = figmaNode.rectangleCornerRadii[0];
  } else if (figmaNode.cornerRadius) {
    node.cornerRadius = figmaNode.cornerRadius;
  }

  if (figmaNode.cornerSmoothing) {
    node.cornerSmoothing = figmaNode.cornerSmoothing;
  }

  // Clip
  if (figmaNode.clipsContent) node.clipsContent = true;

  // Constraints
  if (figmaNode.constraints) {
    node.horizontalConstraint = mapConstraint(figmaNode.constraints.horizontal);
    node.verticalConstraint = mapConstraint(figmaNode.constraints.vertical);
  }

  // Stroke details
  if (figmaNode.individualStrokeWeights) {
    node.independentStrokeWeights = true;
    node.borderTopWeight = figmaNode.individualStrokeWeights.top;
    node.borderRightWeight = figmaNode.individualStrokeWeights.right;
    node.borderBottomWeight = figmaNode.individualStrokeWeights.bottom;
    node.borderLeftWeight = figmaNode.individualStrokeWeights.left;
  }

  if (figmaNode.strokeCap && figmaNode.strokeCap !== 'NONE') node.strokeCap = figmaNode.strokeCap;
  if (figmaNode.strokeJoin && figmaNode.strokeJoin !== 'MITER') node.strokeJoin = figmaNode.strokeJoin;
  if (figmaNode.strokeDashes?.length) node.dashPattern = figmaNode.strokeDashes;

  // Text
  if (type === 'TEXT' || figmaNode.characters) {
    node.text = figmaNode.characters || '';
    if (figmaNode.style) {
      const s = figmaNode.style;
      if (s.fontFamily) node.fontFamily = s.fontFamily;
      if (s.fontWeight) node.fontWeight = s.fontWeight;
      if (s.fontSize) node.fontSize = s.fontSize;
      if (s.italic) node.italic = true;
      if (s.textAlignHorizontal) node.textAlignHorizontal = s.textAlignHorizontal;
      if (s.textAlignVertical) node.textAlignVertical = s.textAlignVertical;
      if (s.letterSpacing) node.letterSpacing = s.letterSpacing;
      if (s.textCase && s.textCase !== 'ORIGINAL') node.textCase = s.textCase;
      if (s.textDecoration && s.textDecoration !== 'NONE') node.textDecoration = s.textDecoration;
      if (s.textAutoResize && s.textAutoResize !== 'NONE') node.textAutoResize = s.textAutoResize;
      if (s.maxLines) node.maxLines = s.maxLines;
      if (s.textTruncation && s.textTruncation !== 'DISABLED') node.textTruncation = s.textTruncation;

      // Line height
      if (s.lineHeightUnit === 'PIXELS' && s.lineHeightPx) {
        node.lineHeight = s.lineHeightPx;
      } else if (s.lineHeightUnit === 'FONT_SIZE_%' && s.lineHeightPercentFontSize) {
        node.lineHeight = ((s.lineHeightPercentFontSize / 100) * (s.fontSize || 16));
      }
    }

    // Style runs
    const styleRuns = convertStyleRuns(figmaNode);
    if (styleRuns.length) node.styleRuns = styleRuns;
  }

  // Auto-layout
  if (figmaNode.layoutMode && figmaNode.layoutMode !== 'NONE') {
    node.layoutMode = mapLayoutMode(figmaNode.layoutMode);
    if (figmaNode.layoutWrap === 'WRAP') node.layoutWrap = 'WRAP';
    node.primaryAxisAlign = mapLayoutAlign(figmaNode.primaryAxisAlignItems);
    node.counterAxisAlign = mapCounterAlign(figmaNode.counterAxisAlignItems);
    node.primaryAxisSizing = mapSizing(figmaNode.primaryAxisSizingMode);
    node.counterAxisSizing = mapSizing(figmaNode.counterAxisSizingMode);
    if (figmaNode.itemSpacing) node.itemSpacing = figmaNode.itemSpacing;
    if (figmaNode.counterAxisSpacing) node.counterAxisSpacing = figmaNode.counterAxisSpacing;
    if (figmaNode.paddingTop) node.paddingTop = figmaNode.paddingTop;
    if (figmaNode.paddingRight) node.paddingRight = figmaNode.paddingRight;
    if (figmaNode.paddingBottom) node.paddingBottom = figmaNode.paddingBottom;
    if (figmaNode.paddingLeft) node.paddingLeft = figmaNode.paddingLeft;
    if (figmaNode.itemReverseZIndex) node.itemReverseZIndex = true;
    if (figmaNode.strokesIncludedInLayout) node.strokesIncludedInLayout = true;
    if (figmaNode.counterAxisAlignContent === 'SPACE_BETWEEN') {
      node.counterAxisAlignContent = 'SPACE_BETWEEN';
    }
  }

  // Layout positioning (child-specific)
  if (figmaNode.layoutPositioning === 'ABSOLUTE') node.layoutPositioning = 'ABSOLUTE';
  if (figmaNode.layoutGrow) node.layoutGrow = figmaNode.layoutGrow;
  if (figmaNode.layoutAlign && figmaNode.layoutAlign !== 'INHERIT') {
    node.layoutAlignSelf = figmaNode.layoutAlign;
  }

  // Sizing constraints
  if (figmaNode.minWidth) node.minWidth = figmaNode.minWidth;
  if (figmaNode.maxWidth) node.maxWidth = figmaNode.maxWidth;
  if (figmaNode.minHeight) node.minHeight = figmaNode.minHeight;
  if (figmaNode.maxHeight) node.maxHeight = figmaNode.maxHeight;

  // Ellipse arc
  if (figmaNode.arcData) node.arcData = figmaNode.arcData;

  // Star / Polygon
  if (figmaNode.pointCount) node.pointCount = figmaNode.pointCount;
  if (figmaNode.starInnerRadius) node.starInnerRadius = figmaNode.starInnerRadius;

  // Component
  if (figmaNode.componentId) node.componentId = figmaNode.componentId;

  // Children
  if (figmaNode.children?.length) {
    const children: Record<string, any>[] = [];
    for (const child of figmaNode.children) {
      const converted = convertNode(child, includeHidden, pos);
      if (converted) children.push(converted);
    }
    if (children.length) node.children = children;
  }

  return node;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Import a Figma file and convert it to reframe scene format.
 *
 * @param fileKey - The Figma file key (from the URL: figma.com/file/<KEY>/...)
 * @param opts - Import options including the Figma API token
 * @returns The scene tree and metadata
 *
 * @example
 * ```ts
 * const { scene, meta } = await importFromFigma('abc123XYZ', {
 *   token: 'figd_your_token_here',
 * });
 *
 * // scene is ready for adaptScene()
 * console.log(meta.name, meta.nodeCount, 'nodes');
 * ```
 */
export async function importFromFigma(
  fileKey: string,
  opts: FigmaImportOptions,
): Promise<FigmaImportResult> {
  const file = await fetchFigmaFile(fileKey, opts);

  _nodeCount = 0;

  // Find the first page or specific nodes
  const doc = file.document;
  let rootNode: Record<string, any>;

  if (opts.nodeIds?.length && doc.children) {
    // Import specific nodes — find them in the tree
    const found = findNodes(doc, new Set(opts.nodeIds));
    if (found.length === 1) {
      rootNode = convertNode(found[0], opts.includeHidden ?? false)!;
    } else if (found.length > 1) {
      // Wrap multiple nodes in a virtual CANVAS
      rootNode = {
        type: 'CANVAS',
        name: file.name,
        x: 0, y: 0, width: 0, height: 0,
        children: found
          .map(n => convertNode(n, opts.includeHidden ?? false))
          .filter(Boolean),
      };
    } else {
      throw new Error(`None of the requested node IDs were found in the file`);
    }
  } else if (doc.children?.length) {
    // Import first page
    const firstPage = doc.children[0];
    if (firstPage.children?.length === 1) {
      // Single top-level frame — use it as root
      rootNode = convertNode(firstPage.children[0], opts.includeHidden ?? false)!;
    } else {
      rootNode = convertNode(firstPage, opts.includeHidden ?? false)!;
    }
  } else {
    rootNode = convertNode(doc, opts.includeHidden ?? false)!;
  }

  return {
    scene: { version: 1, root: rootNode },
    meta: {
      name: file.name,
      lastModified: file.lastModified,
      version: file.version,
      fileKey,
      nodeCount: _nodeCount,
    },
  };
}

/**
 * Import from a raw Figma API response (already fetched).
 * Useful when you have the JSON and don't need to fetch again.
 */
export function importFromFigmaResponse(
  response: FigmaFile,
  fileKey: string,
  opts?: { includeHidden?: boolean; nodeIds?: string[] },
): FigmaImportResult {
  _nodeCount = 0;
  const doc = response.document;
  let rootNode: Record<string, any>;

  if (doc.children?.length) {
    const firstPage = doc.children[0];
    if (firstPage.children?.length === 1) {
      rootNode = convertNode(firstPage.children[0], opts?.includeHidden ?? false)!;
    } else {
      rootNode = convertNode(firstPage, opts?.includeHidden ?? false)!;
    }
  } else {
    rootNode = convertNode(doc, opts?.includeHidden ?? false)!;
  }

  return {
    scene: { version: 1, root: rootNode },
    meta: {
      name: response.name,
      lastModified: response.lastModified,
      version: response.version,
      fileKey,
      nodeCount: _nodeCount,
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────

function findNodes(node: FigmaNode, ids: Set<string>): FigmaNode[] {
  const found: FigmaNode[] = [];
  if (ids.has(node.id)) found.push(node);
  if (node.children) {
    for (const child of node.children) {
      found.push(...findNodes(child, ids));
    }
  }
  return found;
}
