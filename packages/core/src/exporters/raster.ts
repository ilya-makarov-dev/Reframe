/**
 * Raster Exporter — Scene Graph → PNG/JPEG
 *
 * Uses CanvasKit (Skia WASM) for headless rasterization in Node.js.
 * Renders scene nodes to a pixel buffer and encodes as PNG or JPEG.
 */

import type { SceneGraph } from '../engine/scene-graph';
import type { SceneNode, Color, Fill, Stroke, Effect } from '../engine/types';

// CanvasKit types (minimal interface)
interface CanvasKitInstance {
  MakeSurface(width: number, height: number): CKSurface | null;
  MakeCanvasSurface(canvas: any): CKSurface | null;
  Color(r: number, g: number, b: number, a: number): Float32Array;
  Color4f(r: number, g: number, b: number, a: number): Float32Array;
  TRANSPARENT: Float32Array;
  parseColorString(color: string): Float32Array;
  Paint: new () => CKPaint;
  Path: new () => CKPath;
  Font: new (typeface: CKTypeface | null, size: number) => CKFont;
  PaintStyle: { Fill: any; Stroke: any };
  BlurStyle: { Normal: any };
  StrokeCap: { Butt: any; Round: any; Square: any };
  StrokeJoin: { Miter: any; Round: any; Bevel: any };
  ClipOp: { Intersect: any };
  MaskFilter: { MakeBlur(style: any, sigma: number, respectCTM: boolean): CKMaskFilter | null };
  ImageFilter: { MakeDropShadow(dx: number, dy: number, sigmaX: number, sigmaY: number, color: Float32Array, input: any): CKImageFilter | null };
  Typeface: {};
}

interface CKSurface {
  getCanvas(): CKCanvas;
  makeImageSnapshot(): CKImage;
  delete(): void;
}

interface CKCanvas {
  clear(color: Float32Array): void;
  save(): number;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(degrees: number, px: number, py: number): void;
  scale(sx: number, sy: number): void;
  clipRect(rect: Float32Array, op: any, aa: boolean): void;
  drawRect(rect: Float32Array, paint: CKPaint): void;
  drawRRect(rrect: Float32Array, paint: CKPaint): void;
  drawOval(rect: Float32Array, paint: CKPaint): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, paint: CKPaint): void;
  drawPath(path: CKPath, paint: CKPaint): void;
  drawText(text: string, x: number, y: number, paint: CKPaint, font: CKFont): void;
}

interface CKImage {
  encodeToBytes(format?: any, quality?: number): Uint8Array | null;
  delete(): void;
}

interface CKPaint {
  setColor(color: Float32Array): void;
  setAlphaf(alpha: number): void;
  setStyle(style: any): void;
  setStrokeWidth(width: number): void;
  setStrokeCap(cap: any): void;
  setStrokeJoin(join: any): void;
  setAntiAlias(aa: boolean): void;
  setMaskFilter(filter: CKMaskFilter | null): void;
  setImageFilter(filter: CKImageFilter | null): void;
  delete(): void;
}

interface CKPath {
  addRoundRect(rect: Float32Array, rx: number, ry: number): CKPath;
  addOval(rect: Float32Array): CKPath;
  addRect(rect: Float32Array): CKPath;
  delete(): void;
}

interface CKFont {
  delete(): void;
}

interface CKTypeface {
  delete(): void;
}

interface CKMaskFilter {
  delete(): void;
}

interface CKImageFilter {
  delete(): void;
}

// ─── State ─────────────────────────────────────────────────────

let ck: CanvasKitInstance | null = null;

/**
 * Initialize CanvasKit WASM for rasterization.
 * Must be called once before exporting.
 */
export async function initCanvasKit(): Promise<void> {
  if (ck) return;

  const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<any>;
  const mod = await dynamicImport('canvaskit-wasm');
  const CanvasKitInit = mod.default ?? mod;
  ck = await CanvasKitInit();
}

/**
 * Check if CanvasKit is initialized.
 */
export function isCanvasKitReady(): boolean {
  return ck !== null;
}

// ─── Public API ────────────────────────────────────────────────

export type RasterFormat = 'png' | 'jpeg';

export interface RasterExportOptions {
  /** Output format (default: 'png') */
  format?: RasterFormat;
  /** JPEG quality 0-100 (default: 90) */
  quality?: number;
  /** Scale factor (default: 1). Use 2 for @2x retina */
  scale?: number;
  /** Background color (default: transparent for PNG, white for JPEG) */
  background?: string;
}

/**
 * Rasterize a scene graph to PNG or JPEG bytes.
 */
export async function exportToRaster(
  graph: SceneGraph,
  rootId: string,
  options: RasterExportOptions = {},
): Promise<Uint8Array> {
  if (!ck) await initCanvasKit();
  if (!ck) throw new Error('CanvasKit not available');

  const root = graph.getNode(rootId);
  if (!root) throw new Error(`Node ${rootId} not found`);

  const format = options.format ?? 'png';
  const quality = options.quality ?? 90;
  const scale = options.scale ?? 1;

  const width = Math.ceil(root.width * scale);
  const height = Math.ceil(root.height * scale);

  const surface = ck.MakeSurface(width, height);
  if (!surface) throw new Error('Failed to create CanvasKit surface');

  try {
    const canvas = surface.getCanvas();

    // Background
    if (options.background) {
      canvas.clear(ck.parseColorString(options.background));
    } else if (format === 'jpeg') {
      canvas.clear(ck.Color4f(1, 1, 1, 1));
    } else {
      canvas.clear(ck.TRANSPARENT);
    }

    if (scale !== 1) {
      canvas.scale(scale, scale);
    }

    // Render scene tree
    renderNode(graph, rootId, canvas, true);

    // Encode
    const image = surface.makeImageSnapshot();
    try {
      // Try requested format, fall back to PNG if not available
      const formatEnum = format === 'jpeg'
        ? (ck as any).ImageFormat.JPEG
        : (ck as any).ImageFormat.PNG;
      let encoded = image.encodeToBytes(formatEnum, quality);
      let actualFormat = format;

      // JPEG/WEBP may not be compiled into the CanvasKit WASM build
      if (!encoded && format !== 'png') {
        encoded = image.encodeToBytes((ck as any).ImageFormat.PNG, 100);
        actualFormat = 'png';
      }
      if (!encoded) throw new Error('Failed to encode image');
      return encoded;
    } finally {
      image.delete();
    }
  } finally {
    surface.delete();
  }
}

// ─── Rendering ─────────────────────────────────────────────────

function renderNode(
  graph: SceneGraph,
  nodeId: string,
  canvas: CKCanvas,
  isRoot: boolean,
): void {
  if (!ck) return;
  const node = graph.getNode(nodeId);
  if (!node || !node.visible) return;

  canvas.save();

  // Position (skip root — it defines the canvas)
  if (!isRoot) {
    canvas.translate(node.x, node.y);
  }

  // Rotation
  if (node.rotation !== 0) {
    canvas.rotate(node.rotation, node.width / 2, node.height / 2);
  }

  // Opacity
  const opacity = node.opacity;

  // Clip content
  if (node.clipsContent) {
    const rect = Float32Array.from([0, 0, node.width, node.height]);
    canvas.clipRect(rect, ck.ClipOp.Intersect, true);
  }

  // Draw fills
  for (const fill of node.fills) {
    if (!fill.visible) continue;
    drawFill(node, fill, canvas, opacity);
  }

  // Draw effects (shadows, blurs)
  // Note: shadows in Skia need to be drawn before or with the shape

  // Draw strokes
  for (const stroke of node.strokes) {
    if (!stroke.visible) continue;
    drawStroke(node, stroke, canvas, opacity);
  }

  // Draw text
  if (node.type === 'TEXT' && node.text) {
    drawText(node, canvas, opacity);
  }

  // Draw children
  for (const childId of node.childIds) {
    renderNode(graph, childId, canvas, false);
  }

  canvas.restore();
}

function drawFill(node: SceneNode, fill: Fill, canvas: CKCanvas, parentOpacity: number): void {
  if (!ck) return;

  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Fill);

  const color = fill.color;
  paint.setColor(ck.Color4f(color.r, color.g, color.b, color.a * fill.opacity * parentOpacity));

  drawShape(node, canvas, paint);
  paint.delete();
}

function drawStroke(node: SceneNode, stroke: Stroke, canvas: CKCanvas, parentOpacity: number): void {
  if (!ck) return;

  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Stroke);
  paint.setStrokeWidth(stroke.weight);

  const color = stroke.color;
  paint.setColor(ck.Color4f(color.r, color.g, color.b, color.a * stroke.opacity * parentOpacity));

  drawShape(node, canvas, paint);
  paint.delete();
}

function drawShape(node: SceneNode, canvas: CKCanvas, paint: CKPaint): void {
  if (!ck) return;

  const rect = Float32Array.from([0, 0, node.width, node.height]);

  switch (node.type) {
    case 'ELLIPSE':
      canvas.drawOval(rect, paint);
      break;

    case 'LINE':
      canvas.drawLine(0, 0, node.width, node.height, paint);
      break;

    default: {
      const r = node.cornerRadius || 0;
      if (r > 0) {
        // RRect: [left, top, right, bottom, radii...]
        const rrect = Float32Array.from([
          0, 0, node.width, node.height,
          node.topLeftRadius || r, node.topLeftRadius || r,
          node.topRightRadius || r, node.topRightRadius || r,
          node.bottomRightRadius || r, node.bottomRightRadius || r,
          node.bottomLeftRadius || r, node.bottomLeftRadius || r,
        ]);
        canvas.drawRRect(rrect, paint);
      } else {
        canvas.drawRect(rect, paint);
      }
      break;
    }
  }
}

function drawText(node: SceneNode, canvas: CKCanvas, parentOpacity: number): void {
  if (!ck || !node.text) return;

  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  paint.setStyle(ck.PaintStyle.Fill);

  // Use first fill color or default black
  const fillColor = node.fills?.find(f => f.visible && f.type === 'SOLID');
  if (fillColor) {
    const c = fillColor.color;
    paint.setColor(ck.Color4f(c.r, c.g, c.b, c.a * fillColor.opacity * parentOpacity));
  } else {
    paint.setColor(ck.Color4f(0, 0, 0, parentOpacity));
  }

  const font = new ck.Font(null, node.fontSize || 16);

  const lineHeight = node.lineHeight ?? (node.fontSize || 16) * 1.2;
  const lines = node.text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    canvas.drawText(lines[i], 0, (i + 1) * lineHeight, paint, font);
  }

  font.delete();
  paint.delete();
}
