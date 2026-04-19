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
// A typeface loaded once and shared across all PNG exports in the process.
// null means we failed to find a system font — text will fall back to the
// CanvasKit box-renderer (unreadable rectangles). See loadFallbackTypeface
// for the search order.
let fallbackTypeface: CKTypeface | null = null;
let typefaceProbeAttempted = false;
// The CanvasKit instance the cached typeface was created against. If a
// second (different) CanvasKit instance gets used (e.g. the module was
// loaded twice via mismatched ESM/CJS paths), passing that typeface to
// the new instance's `Font` constructor throws the famous embind
// "Expected instance of Typeface, got instance of Typeface" error. We
// tag the cache with the originating ck and invalidate when it
// diverges so Font() always gets a typeface of the right runtime class.
let fallbackTypefaceCk: CanvasKitInstance | null = null;

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
 * Try to load a system TTF and register it with CanvasKit so drawText
 * renders real glyphs instead of filled bounding boxes.
 *
 * The raster exporter previously passed `null` as the typeface, which
 * silently fell back to Skia's box-renderer — every PNG export came out
 * with layout + colors correct but text replaced by solid rectangles.
 *
 * We probe common OS font paths in order of precedence. The first file
 * that reads successfully becomes the fallback typeface for all text in
 * this process. Per-node fontFamily matching would require an FontMgr and
 * is a larger change; this guarantees readable output even when the
 * scene's fontFamily isn't resolvable.
 */
function loadFallbackTypeface(): CKTypeface | null {
  if (!ck) return null;
  // Invalidate the cache when the CanvasKit instance changes — a second
  // load of canvaskit-wasm produces a fresh class table, and a typeface
  // bound to the first `ck` can't be passed to the second's Font ctor.
  if (fallbackTypefaceCk !== null && fallbackTypefaceCk !== ck) {
    fallbackTypeface = null;
    typefaceProbeAttempted = false;
    fallbackTypefaceCk = null;
  }
  if (typefaceProbeAttempted) return fallbackTypeface;
  typefaceProbeAttempted = true;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');

  // Ordered list of candidate system fonts. We prefer sans-serif with good
  // Latin + common symbol coverage — Segoe UI / Arial on Windows,
  // Helvetica / system fonts on macOS, DejaVu / Noto on Linux. The first
  // existing file wins.
  const candidates = [
    // Windows
    'C:\\Windows\\Fonts\\segoeui.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    'C:\\Windows\\Fonts\\calibri.ttf',
    // macOS
    '/System/Library/Fonts/Helvetica.ttc',
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/System/Library/Fonts/SFNS.ttf',
    '/System/Library/Fonts/Supplemental/Verdana.ttf',
    // Linux (Debian/Ubuntu)
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    // Linux (Alpine / containers)
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
    '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  ];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const data = fs.readFileSync(p);
      // CanvasKit's Typeface factory name depends on the build. Try the
      // documented methods in order; the first that returns a non-null
      // typeface wins.
      const anyCk = ck as any;
      const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const tf: CKTypeface | null =
        anyCk.Typeface?.MakeFreeTypeFaceFromData?.(bytes) ??
        anyCk.Typeface?.MakeTypefaceFromData?.(bytes) ??
        anyCk.Typeface?.MakeFromData?.(bytes) ??
        null;
      if (tf) {
        // Smoke-test the typeface against this ck's Font constructor.
        // Some CanvasKit builds return a Typeface from
        // MakeFreeTypeFaceFromData that fails the embind identity check
        // when passed to `new ck.Font(typeface, size)`. Detect that
        // here and try the next API path so drawText never throws on a
        // real scene.
        try {
          const probe = new (ck as any).Font(tf, 12);
          probe.delete?.();
          fallbackTypeface = tf;
          fallbackTypefaceCk = ck;
          return tf;
        } catch {
          // Typeface class mismatch — discard and keep probing.
          try { (tf as any).delete?.(); } catch { /* */ }
          continue;
        }
      }
    } catch {
      // Path unreadable or parse failed — try the next candidate.
    }
  }
  return null;
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

  // Draw fills — but NOT for TEXT nodes. Their `fills` array stores the
  // glyph color; treating it as a rectangular fill paints a solid block
  // that then hides the glyphs drawn on top. drawText below reads the
  // same fills[0] and uses it for the real text paint.
  if (node.type !== 'TEXT') {
    for (const fill of node.fills ?? []) {
      if (!fill.visible) continue;
      drawFill(node, fill, canvas, opacity);
    }
  }

  // Draw effects (shadows, blurs)
  // Note: shadows in Skia need to be drawn before or with the shape

  // Draw strokes
  for (const stroke of node.strokes ?? []) {
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

  const typeface = loadFallbackTypeface();
  const baseSize = node.fontSize || 16;
  const baseWeight = node.fontWeight ?? 400;

  // Base color from fills[0]. Each styleRun can override with fillColor.
  const baseFillColor = node.fills?.find(f => f.visible && f.type === 'SOLID') as any;
  const baseColor = baseFillColor?.color ?? { r: 0, g: 0, b: 0, a: 1 };

  const runs = (node as any).styleRuns as Array<{ start: number; length: number; style: any }> | undefined;
  const lineHeight = node.lineHeight ?? baseSize * 1.2;

  // Word-wrap budget: Yoga computed `node.width` to accommodate wrapped
  // text, but the old renderer only respected explicit `\n` and drew
  // each source-line on one physical row. Long paragraphs got clipped
  // at the parent edge because their natural width was 2-3× the cell.
  // Now we measure each source-line and break at word boundaries when
  // it exceeds node.width, so the visual matches what Yoga allocated.
  const maxWidth = node.width > 0 ? node.width : Infinity;

  // Build physical lines by source-line + word-wrap. Each entry carries
  // the text slice plus its start offset in the full `node.text` so the
  // styleRuns path can still map runs to segments.
  type PhysicalLine = { text: string; start: number };
  const physical: PhysicalLine[] = [];
  {
    let cursor = 0;
    for (const srcLine of node.text.split('\n')) {
      const lineStart = cursor;
      if (srcLine.length === 0) {
        physical.push({ text: '', start: lineStart });
      } else {
        const wrapped = wrapLine(srcLine, maxWidth, typeface, baseSize, baseWeight);
        let offset = 0;
        for (const w of wrapped) {
          physical.push({ text: w, start: lineStart + offset });
          offset += w.length;
        }
      }
      cursor += srcLine.length + 1;  // +1 for the consumed '\n'
    }
  }

  for (let i = 0; i < physical.length; i++) {
    const { text: line, start: lineStart } = physical[i];
    const y = (i + 1) * lineHeight;

    if (!runs || runs.length === 0) {
      if (!line) continue;
      // Fast path: no styleRuns — one paint, one font, one drawText.
      const paint = new ck.Paint();
      paint.setAntiAlias(true);
      paint.setStyle(ck.PaintStyle.Fill);
      paint.setColor(ck.Color4f(baseColor.r, baseColor.g, baseColor.b, (baseColor.a ?? 1) * parentOpacity));
      const font = safeMakeFont(typeface, baseSize);
      canvas.drawText(line, 0, y, paint, font);
      font.delete();
      paint.delete();
    } else {
      if (!line) continue;
      // styleRuns path: segment the line at every run boundary and
      // draw each segment with its merged style. Runs can overlap
      // (e.g. outer color + inner bold span) — compose them in order.
      const segments = splitLineByRuns(line, lineStart, runs);
      let x = 0;
      for (const seg of segments) {
        const s = seg.style;
        const color = s.fillColor ?? baseColor;
        const size = (typeof s.fontSize === 'number' ? s.fontSize : baseSize);
        const weight = (typeof s.fontWeight === 'number' ? s.fontWeight : baseWeight);

        const paint = new ck.Paint();
        paint.setAntiAlias(true);
        paint.setStyle(ck.PaintStyle.Fill);
        paint.setColor(ck.Color4f(color.r, color.g, color.b, (color.a ?? 1) * parentOpacity));

        const font = safeMakeFont(typeface, size);
        canvas.drawText(seg.text, x, y, paint, font);
        x += measureTextWidth(seg.text, size, weight, font);

        font.delete();
        paint.delete();
      }
    }
  }
}

/**
 * Break a single source-line into physical lines that each fit within
 * `maxWidth` when rendered with the base font. Uses greedy word-
 * boundary break — the same rule CSS uses for `word-wrap: normal`.
 * When a single word exceeds maxWidth on its own, we emit it on its
 * own line (it still overflows — no character-break fallback yet,
 * matching CSS default `overflow-wrap: normal`).
 *
 * Returns an array where concat(all items) === original line. A single
 * trailing space within the input is preserved at the break boundary
 * so downstream styleRun offsets stay aligned character-for-character.
 */
function wrapLine(
  line: string,
  maxWidth: number,
  typeface: CKTypeface | null,
  fontSize: number,
  weight: number,
): string[] {
  if (!isFinite(maxWidth) || maxWidth <= 0 || !line) return [line];
  if (!ck) return [line];
  const font = safeMakeFont(typeface, fontSize);
  try {
    // Slack absorbs the mismatch between the importer's natural-width
    // estimate (avgChar heuristic) and the raster's per-glyph measure.
    // Tabular-numeral fonts (`font-feature-settings: 'tnum'`) use
    // wider fixed-width digits than the 0.55 average would suggest,
    // so the raster routinely measures 15-20% wider than what the
    // importer stored on the node. A flat 4 px slack caught short
    // labels but left "−8ms wow" style tnum strings splitting mid-run.
    // The 10 %-of-width-or-6 px rule covers both cases: small nodes
    // get enough absolute slack, large nodes grow proportionally.
    const slack = Math.max(6, maxWidth * 0.1);
    // Fast path: the whole line fits. Avoids splitting work.
    const full = measureTextWidth(line, fontSize, weight, font);
    if (full <= maxWidth + slack) return [line];

    // Tokenize: alternating words + whitespace runs. Keeping whitespace
    // as its own token preserves the original char count so styleRun
    // offsets match the source string exactly.
    const tokens: string[] = [];
    {
      const re = /(\s+|\S+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) tokens.push(m[0]);
    }

    const out: string[] = [];
    let current = '';
    let currentW = 0;
    for (const tok of tokens) {
      const tokW = measureTextWidth(tok, fontSize, weight, font);
      if (!current) {
        current = tok;
        currentW = tokW;
        continue;
      }
      if (currentW + tokW <= maxWidth) {
        current += tok;
        currentW += tokW;
      } else {
        out.push(current);
        // Whitespace at the start of the next line still counts in char
        // indices — keep it so the concat invariant holds.
        current = tok;
        currentW = tokW;
      }
    }
    if (current) out.push(current);
    return out;
  } finally {
    font.delete?.();
  }
}

/**
 * Slice a rendered line at the boundaries of every overlapping styleRun
 * and compose the active CharacterStyleOverride for each segment.
 *
 * `lineStart` is the char offset of `line[0]` in the full node text, so
 * a run's global `start/length` maps to `localStart/localEnd` inside
 * the line by subtracting lineStart.
 */
function splitLineByRuns(
  line: string,
  lineStart: number,
  runs: Array<{ start: number; length: number; style: any }>,
): Array<{ text: string; style: Record<string, any> }> {
  if (!line) return [];
  const lineEnd = line.length;

  // Collect every unique boundary position within this line.
  const cuts = new Set<number>([0, lineEnd]);
  for (const r of runs) {
    const localStart = r.start - lineStart;
    const localEnd = localStart + r.length;
    if (localEnd <= 0 || localStart >= lineEnd) continue;
    cuts.add(Math.max(0, localStart));
    cuts.add(Math.min(lineEnd, localEnd));
  }
  const sorted = [...cuts].sort((a, b) => a - b);

  const out: Array<{ text: string; style: Record<string, any> }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b <= a) continue;
    const text = line.slice(a, b);
    if (!text) continue;

    // Compose style from every run that contains this segment. Runs
    // later in the array override earlier ones for the same property
    // — matching how nested inline formatting layers (outer <span
    // color=…> wraps <strong> which then wraps the text).
    const style: Record<string, any> = {};
    for (const r of runs) {
      const localStart = r.start - lineStart;
      const localEnd = localStart + r.length;
      if (localStart <= a && localEnd >= b) {
        Object.assign(style, r.style);
      }
    }
    out.push({ text, style });
  }
  return out;
}

/**
 * Glyph-run width. Prefers CanvasKit's real measurement via
 * `font.getGlyphIDs` + `font.getGlyphWidths` (the documented API),
 * which returns pixel-scaled advances. Falls back to a fontSize-
 * scaled heuristic when either method is absent or returns invalid
 * data — the heuristic is tuned for sans-serif fallback fonts (Segoe
 * UI, Helvetica, DejaVu) around 0.58× fontSize per char.
 *
 * The earlier 0.54× heuristic ran short for sans-serif at 13 px,
 * causing adjacent run segments to overlap visibly (every span in a
 * line of syntax-highlighted code got drawn on top of the previous
 * one because our estimate of the previous run's width was smaller
 * than what drawText actually painted).
 */
/**
 * Create a Font without crashing the export when the cached typeface
 * was minted by a different CanvasKit instance. The embind class check
 * inside `new ck.Font(typeface, size)` throws on mismatch with the
 * classic "Expected instance of Typeface, got instance of Typeface"
 * message — degrade to a null typeface (CanvasKit will render glyph
 * boxes) so the rest of the scene still exports.
 */
function safeMakeFont(typeface: CKTypeface | null, size: number): CKFont {
  if (!ck) throw new Error('CanvasKit not initialized');
  try {
    return new ck.Font(typeface, size);
  } catch {
    // Invalidate the cache so future calls don't re-hit the bad typeface
    // and retry with null — at least the layout + colors still render.
    fallbackTypeface = null;
    fallbackTypefaceCk = null;
    return new ck.Font(null, size);
  }
}

function measureTextWidth(text: string, fontSize: number, weight: number, font: any): number {
  if (!text) return 0;
  try {
    // CanvasKit Font API: encode text to glyph IDs, then measure per-
    // glyph advance widths. Outputs are already scaled to the font's
    // current size in pixels.
    if (typeof font.getGlyphIDs === 'function' && typeof font.getGlyphWidths === 'function') {
      const ids = font.getGlyphIDs(text);
      if (ids && ids.length > 0) {
        const widths: number[] | Float32Array = font.getGlyphWidths(ids);
        let total = 0;
        for (let i = 0; i < (widths as any).length; i++) total += (widths as any)[i];
        // Sanity check — if the result looks off by a factor of 100+
        // (FUnits instead of pixels in some old builds), discard and
        // fall through to the heuristic.
        const expected = text.length * fontSize;
        if (total > 0 && total < expected * 3) return total;
      }
    }
  } catch { /* fall through to heuristic */ }
  // Keep this ratio in sync with the importer's avg-char heuristic in
  // html.ts (cssToOverrides → text size estimate). When the two diverge,
  // short labels like "PRODUCTION · READY" get wrapped in the raster
  // output because the raster thinks the text is wider than the node
  // box the importer sized — even though the source text fits fine.
  const avgChar = fontSize * (0.55 + (weight >= 600 ? 0.04 : 0));
  return text.length * avgChar;
}
