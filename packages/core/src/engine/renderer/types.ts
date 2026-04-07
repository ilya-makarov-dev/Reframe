/**
 * Reframe Standalone Engine — Renderer Types
 *
 * Minimal CanvasKit interface surface used by the renderer.
 * Consumers inject a real CanvasKit instance via setCanvasKit().
 */

// ─── CanvasKit Abstraction ──────────────────────────────────────

/**
 * Paint object abstraction.
 */
export interface IRPaint {
  setStyle(style: number): void;
  setAntiAlias(aa: boolean): void;
  setColor(color: Float32Array | number[]): void;
  setAlphaf(alpha: number): void;
  setStrokeWidth(width: number): void;
  setStrokeCap(cap: number): void;
  setStrokeJoin(join: number): void;
  setStrokeMiter(limit: number): void;
  setShader(shader: IRShader | null): void;
  setImageFilter(filter: IRImageFilter | null): void;
  setMaskFilter(filter: IRMaskFilter | null): void;
  setPathEffect(effect: IRPathEffect | null): void;
  setBlendMode(mode: number): void;
  getColor(): Float32Array;
  copy(): IRPaint;
  delete(): void;
}

/**
 * Canvas abstraction.
 */
export interface IRCanvas {
  save(): number;
  restore(): void;
  saveLayer(paint?: IRPaint, bounds?: Float32Array | null, backdrop?: IRImageFilter | null, flags?: number): number;
  translate(dx: number, dy: number): void;
  scale(sx: number, sy: number): void;
  rotate(degrees: number, cx: number, cy: number): void;
  clipRect(rect: Float32Array, op: number, antialias: boolean): void;
  clipRRect(rrect: Float32Array, op: number, antialias: boolean): void;
  clipPath(path: IRPath, op: number, antialias: boolean): void;
  drawRect(rect: Float32Array, paint: IRPaint): void;
  drawRRect(rrect: Float32Array, paint: IRPaint): void;
  drawOval(rect: Float32Array, paint: IRPaint): void;
  drawCircle(cx: number, cy: number, radius: number, paint: IRPaint): void;
  drawLine(x0: number, y0: number, x1: number, y1: number, paint: IRPaint): void;
  drawPath(path: IRPath, paint: IRPaint): void;
  drawParagraph(paragraph: IRParagraph, x: number, y: number): void;
  drawPicture(picture: IRPicture): void;
  drawText(text: string, x: number, y: number, paint: IRPaint, font: IRFont): void;
  clear(color: Float32Array | number[]): void;
}

export interface IRSurface {
  getCanvas(): IRCanvas;
  flush(): void;
  width(): number;
  height(): number;
  delete(): void;
}

export interface IRPath {
  addRect(rect: Float32Array): IRPath;
  addRRect(rrect: Float32Array): IRPath;
  addOval(rect: Float32Array): IRPath;
  addArc(oval: Float32Array, startAngle: number, sweepAngle: number): IRPath;
  addCircle(cx: number, cy: number, r: number): IRPath;
  addPath(path: IRPath): IRPath;
  moveTo(x: number, y: number): IRPath;
  lineTo(x: number, y: number): IRPath;
  cubicTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): IRPath;
  close(): IRPath;
  op(other: IRPath, op: number): boolean;
  copy(): IRPath;
  delete(): void;
}

export interface IRShader {
  delete(): void;
}

export interface IRImageFilter {
  delete(): void;
}

export interface IRMaskFilter {
  delete(): void;
}

export interface IRPathEffect {
  delete(): void;
}

export interface IRImage {
  width(): number;
  height(): number;
  makeShaderCubic(
    tileX: number, tileY: number,
    B: number, C: number,
    matrix?: Float32Array,
  ): IRShader;
  delete(): void;
}

export interface IRParagraph {
  layout(width: number): void;
  getHeight(): number;
  getLongestLine(): number;
  getLineMetrics(): any[];
  delete(): void;
}

export interface IRPicture {
  delete(): void;
}

export interface IRFont {
  delete(): void;
}

export interface IRPictureRecorder {
  beginRecording(bounds: Float32Array): IRCanvas;
  finishRecordingAsPicture(): IRPicture;
  delete(): void;
}

export interface IRTypefaceFontProvider {
  registerFont(data: ArrayBuffer, familyName: string): void;
  delete(): void;
}

// ─── CanvasKit Factory Interface ────────────────────────────────

/**
 * Subset of CanvasKit API used by the renderer.
 * Injected via setCanvasKit().
 */
export interface ICanvasKit {
  // Surface
  MakeCanvasSurface(canvas: HTMLCanvasElement | string): IRSurface | null;
  MakeSWCanvasSurface(canvas: HTMLCanvasElement | string): IRSurface | null;
  MakeWebGLCanvasSurface(canvas: HTMLCanvasElement | string): IRSurface | null;

  // Constructors
  Paint: new () => IRPaint;
  Path: new () => IRPath;
  PictureRecorder: new () => IRPictureRecorder;
  TypefaceFontProvider: { Make(): IRTypefaceFontProvider };
  Font: new (typeface: any, size: number) => IRFont;
  Typeface: { MakeFreeTypeFaceFromData(data: ArrayBuffer): any | null };

  // Factories
  MakeImageFromEncoded(data: ArrayBuffer | Uint8Array): IRImage | null;
  MakePicture(data: Uint8Array): IRPicture | null;

  // Rects
  LTRBRect(l: number, t: number, r: number, b: number): Float32Array;
  XYWHRect(x: number, y: number, w: number, h: number): Float32Array;
  RRectXY(rect: Float32Array, rx: number, ry: number): Float32Array;

  // Shaders
  Shader: {
    MakeLinearGradient(
      start: number[], end: number[],
      colors: Float32Array[], positions: number[],
      tileMode: number,
      matrix?: Float32Array,
    ): IRShader;
    MakeRadialGradient(
      center: number[], radius: number,
      colors: Float32Array[], positions: number[],
      tileMode: number,
      matrix?: Float32Array,
    ): IRShader;
    MakeSweepGradient(
      cx: number, cy: number,
      colors: Float32Array[], positions: number[],
      tileMode: number,
      matrix?: Float32Array,
    ): IRShader;
  };

  // Filters
  ImageFilter: {
    MakeBlur(sx: number, sy: number, tileMode: number, input: IRImageFilter | null): IRImageFilter;
    MakeDropShadowOnly(
      dx: number, dy: number,
      sx: number, sy: number,
      color: Float32Array,
      input: IRImageFilter | null,
    ): IRImageFilter;
  };
  MaskFilter: {
    MakeBlur(style: number, sigma: number, respectCTM: boolean): IRMaskFilter;
  };
  PathEffect: {
    MakeDash(intervals: number[], phase: number): IRPathEffect;
  };

  // Matrix
  Matrix: {
    identity(): Float32Array;
    multiply(a: Float32Array, b: Float32Array): Float32Array;
    scaled(sx: number, sy: number): Float32Array;
    translated(tx: number, ty: number): Float32Array;
    rotated(radians: number, cx?: number, cy?: number): Float32Array;
  };

  // Color
  Color4f(r: number, g: number, b: number, a: number): Float32Array;
  BLACK: Float32Array;
  WHITE: Float32Array;
  TRANSPARENT: Float32Array;

  // Constants
  PaintStyle: { Fill: number; Stroke: number };
  TileMode: { Clamp: number; Repeat: number; Mirror: number; Decal: number };
  BlurStyle: { Normal: number; Solid: number; Outer: number; Inner: number };
  ClipOp: { Intersect: number; Difference: number };
  PathOp: { Difference: number; Intersect: number; Union: number; XOR: number; ReverseDifference: number };
  StrokeCap: { Butt: number; Round: number; Square: number };
  StrokeJoin: { Miter: number; Round: number; Bevel: number };
  BlendMode: { SrcOver: number; Multiply: number; Screen: number; Overlay: number; [k: string]: number };
  FontSlant: { Upright: number; Italic: number };

  // Paragraph
  ParagraphStyle: new (style: any) => any;
  TextStyle: new (style: any) => any;
  ParagraphBuilder: {
    MakeFromFontProvider(style: any, fontProvider: IRTypefaceFontProvider): {
      pushStyle(style: any): void;
      pop(): void;
      addText(text: string): void;
      build(): IRParagraph;
      delete(): void;
    };
  };
  RectHeightStyle: { Max: number; Tight: number };
  RectWidthStyle: { Tight: number; Max: number };
}

// ─── Render Viewport ────────────────────────────────────────────

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}
