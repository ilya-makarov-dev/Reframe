/**
 * Reframe — Standalone Node Adapter
 *
 * Wraps engine's SceneGraph node as INode (reframe host abstraction).
 * This is the bridge between the standalone engine and the reframe scaling pipeline.
 */

import { NodeType as HostNodeType, MIXED, type INode, type IFontName, type IPaint, type ISolidPaint, type IGradientPaint, type IImagePaint, type IEffect, type IExportSettings } from '../../host/types';
import type { SceneGraph } from '../../engine/scene-graph';
import type { SceneNode, NodeType as EngineNodeType } from '../../engine/types';
import { applyStyleToRange } from '../../engine/style-runs';

// ─── Node Type Mapping ──────────────────────────────────────────

const ENGINE_TO_HOST: Record<string, HostNodeType> = {
  FRAME: HostNodeType.Frame,
  GROUP: HostNodeType.Group,
  TEXT: HostNodeType.Text,
  RECTANGLE: HostNodeType.Rectangle,
  ROUNDED_RECTANGLE: HostNodeType.Rectangle,
  ELLIPSE: HostNodeType.Ellipse,
  STAR: HostNodeType.Star,
  POLYGON: HostNodeType.Polygon,
  VECTOR: HostNodeType.Vector,
  INSTANCE: HostNodeType.Instance,
  COMPONENT: HostNodeType.Component,
  LINE: HostNodeType.Line,
  SECTION: HostNodeType.Frame,
  CANVAS: HostNodeType.Frame,
  COMPONENT_SET: HostNodeType.Component,
  CONNECTOR: HostNodeType.Other,
  SHAPE_WITH_TEXT: HostNodeType.Other,
};

// ─── Paint Conversion ───────────────────────────────────────────

function fillToIPaint(fill: import('../../engine/types').Fill): IPaint {
  if (fill.type === 'SOLID') {
    return {
      type: 'SOLID',
      color: { r: fill.color.r, g: fill.color.g, b: fill.color.b },
      opacity: fill.opacity,
      visible: fill.visible,
    } as ISolidPaint;
  }
  if (fill.type === 'IMAGE') {
    return {
      type: 'IMAGE',
      scaleMode: fill.imageScaleMode,
      imageHash: fill.imageHash ?? null,
      opacity: fill.opacity,
      visible: fill.visible,
    } as IImagePaint;
  }
  // Gradient
  return {
    type: fill.type,
    opacity: fill.opacity,
    visible: fill.visible,
    gradientStops: fill.gradientStops?.map(s => ({
      color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
      position: s.position,
    })),
    gradientTransform: fill.gradientTransform,
  } as IGradientPaint;
}

function strokeToIPaint(stroke: import('../../engine/types').Stroke): IPaint {
  return {
    type: 'SOLID',
    color: { r: stroke.color.r, g: stroke.color.g, b: stroke.color.b },
    opacity: stroke.opacity,
    visible: stroke.visible,
  } as ISolidPaint;
}

function effectToIEffect(effect: import('../../engine/types').Effect): IEffect {
  return {
    type: effect.type,
    visible: effect.visible,
    radius: effect.radius,
    offset: effect.offset,
    color: effect.color,
    spread: effect.spread,
  };
}

// ─── Node Cache ─────────────────────────────────────────────────

const nodeCache = new WeakMap<SceneGraph, Map<string, StandaloneNode>>();

function getOrCreateNode(graph: SceneGraph, id: string): StandaloneNode | null {
  let cache = nodeCache.get(graph);
  if (!cache) {
    cache = new Map();
    nodeCache.set(graph, cache);
  }

  const existing = cache.get(id);
  if (existing && !existing.removed) return existing;

  const raw = graph.getNode(id);
  if (!raw) return null;

  const node = new StandaloneNode(graph, raw);
  cache.set(id, node);
  return node;
}

// ─── StandaloneNode ─────────────────────────────────────────────

export class StandaloneNode implements INode {
  private graph: SceneGraph;
  private raw: SceneNode;

  constructor(graph: SceneGraph, raw: SceneNode) {
    this.graph = graph;
    this.raw = raw;
  }

  // Identity
  get id(): string { return this.raw.id; }
  get name(): string { return this.raw.name; }
  set name(v: string) { this.graph.updateNode(this.raw.id, { name: v }); }
  get type(): HostNodeType { return ENGINE_TO_HOST[this.raw.type] ?? HostNodeType.Other; }
  get removed(): boolean { return !this.graph.getNode(this.raw.id); }

  // Tree
  get parent(): INode | null {
    return this.raw.parentId ? getOrCreateNode(this.graph, this.raw.parentId) : null;
  }
  get children(): readonly INode[] | undefined {
    if (!this.raw.childIds.length && !this._isContainer()) return undefined;
    return this.raw.childIds
      .map(id => getOrCreateNode(this.graph, id))
      .filter((n): n is StandaloneNode => n !== null);
  }

  private _isContainer(): boolean {
    return ['CANVAS', 'FRAME', 'GROUP', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']
      .includes(this.raw.type);
  }

  appendChild(child: INode): void {
    if (child instanceof StandaloneNode) {
      this.graph.reparentNode(child.raw.id, this.raw.id);
    }
  }

  insertChild(index: number, child: INode): void {
    if (child instanceof StandaloneNode) {
      this.graph.reparentNode(child.raw.id, this.raw.id);
      this.graph.reorderChild(child.raw.id, this.raw.id, index);
    }
  }

  clone(): INode {
    const parentId = this.raw.parentId ?? this.graph.rootId;
    const cloned = this.graph.cloneTree(this.raw.id, parentId);
    if (!cloned) throw new Error(`Failed to clone node ${this.raw.id}`);
    return new StandaloneNode(this.graph, cloned);
  }

  remove(): void {
    this.graph.deleteNode(this.raw.id);
  }

  findAll(predicate: (node: INode) => boolean): INode[] {
    const result: INode[] = [];
    const walk = (id: string) => {
      const n = getOrCreateNode(this.graph, id);
      if (!n) return;
      if (predicate(n)) result.push(n);
      const raw = this.graph.getNode(id);
      if (raw) {
        for (const childId of raw.childIds) walk(childId);
      }
    };
    for (const childId of this.raw.childIds) walk(childId);
    return result;
  }

  findOne(predicate: (node: INode) => boolean): INode | null {
    const walk = (id: string): INode | null => {
      const n = getOrCreateNode(this.graph, id);
      if (!n) return null;
      if (predicate(n)) return n;
      const raw = this.graph.getNode(id);
      if (raw) {
        for (const childId of raw.childIds) {
          const found = walk(childId);
          if (found) return found;
        }
      }
      return null;
    };
    for (const childId of this.raw.childIds) {
      const found = walk(childId);
      if (found) return found;
    }
    return null;
  }

  // Geometry
  get x(): number { return this.raw.x; }
  set x(v: number) { this.graph.updateNode(this.raw.id, { x: v }); }
  get y(): number { return this.raw.y; }
  set y(v: number) { this.graph.updateNode(this.raw.id, { y: v }); }
  get width(): number { return this.raw.width; }
  get height(): number { return this.raw.height; }

  resize(w: number, h: number): void {
    this.graph.updateNode(this.raw.id, { width: w, height: h });
  }

  rescale(scale: number): void {
    this.graph.updateNode(this.raw.id, {
      width: this.raw.width * scale,
      height: this.raw.height * scale,
    });
  }

  // Absolute transform
  get absoluteTransform(): [[number, number, number], [number, number, number]] | undefined {
    const abs = this.graph.getAbsolutePosition(this.raw.id);
    return [[1, 0, abs.x], [0, 1, abs.y]];
  }

  get absoluteBoundingBox(): { x: number; y: number; width: number; height: number } | null {
    const abs = this.graph.getAbsolutePosition(this.raw.id);
    return { x: abs.x, y: abs.y, width: this.raw.width, height: this.raw.height };
  }

  // Layout
  get layoutMode(): 'NONE' | 'HORIZONTAL' | 'VERTICAL' {
    const m = this.raw.layoutMode;
    if (m === 'HORIZONTAL' || m === 'VERTICAL') return m;
    return 'NONE';
  }
  set layoutMode(v: 'NONE' | 'HORIZONTAL' | 'VERTICAL') {
    this.graph.updateNode(this.raw.id, { layoutMode: v });
  }

  get layoutPositioning(): 'ABSOLUTE' | 'AUTO' { return this.raw.layoutPositioning; }
  set layoutPositioning(v: 'ABSOLUTE' | 'AUTO') {
    this.graph.updateNode(this.raw.id, { layoutPositioning: v });
  }

  get constraints(): { horizontal: string; vertical: string } {
    return {
      horizontal: this.raw.horizontalConstraint,
      vertical: this.raw.verticalConstraint,
    };
  }
  set constraints(v: { horizontal: string; vertical: string }) {
    this.graph.updateNode(this.raw.id, {
      horizontalConstraint: v.horizontal as any,
      verticalConstraint: v.vertical as any,
    });
  }

  get clipsContent(): boolean { return this.raw.clipsContent; }
  set clipsContent(v: boolean) { this.graph.updateNode(this.raw.id, { clipsContent: v }); }

  get primaryAxisAlign(): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
    return ((this.raw as any).primaryAxisAlign ?? 'MIN') as any;
  }
  set primaryAxisAlign(v: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN') {
    this.graph.updateNode(this.raw.id, { primaryAxisAlign: v } as any);
  }

  get counterAxisAlign(): 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE' {
    return ((this.raw as any).counterAxisAlign ?? 'MIN') as any;
  }
  set counterAxisAlign(v: 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' | 'BASELINE') {
    this.graph.updateNode(this.raw.id, { counterAxisAlign: v } as any);
  }

  get itemSpacing(): number { return (this.raw as any).itemSpacing ?? 0; }
  set itemSpacing(v: number) { this.graph.updateNode(this.raw.id, { itemSpacing: v } as any); }

  get counterAxisSpacing(): number { return (this.raw as any).counterAxisSpacing ?? 0; }

  get layoutWrap(): 'NO_WRAP' | 'WRAP' { return ((this.raw as any).layoutWrap ?? 'NO_WRAP') as any; }

  get layoutGrow(): number { return (this.raw as any).layoutGrow ?? 0; }
  set layoutGrow(v: number) { this.graph.updateNode(this.raw.id, { layoutGrow: v } as any); }

  get layoutAlignSelf(): 'AUTO' | 'MIN' | 'CENTER' | 'MAX' | 'STRETCH' {
    return ((this.raw as any).layoutAlignSelf ?? 'AUTO') as any;
  }
  set layoutAlignSelf(v: 'AUTO' | 'MIN' | 'CENTER' | 'MAX' | 'STRETCH') {
    this.graph.updateNode(this.raw.id, { layoutAlignSelf: v } as any);
  }

  get paddingTop(): number { return (this.raw as any).paddingTop ?? 0; }
  get paddingRight(): number { return (this.raw as any).paddingRight ?? 0; }
  get paddingBottom(): number { return (this.raw as any).paddingBottom ?? 0; }
  get paddingLeft(): number { return (this.raw as any).paddingLeft ?? 0; }

  // Visual
  get fills(): IPaint[] {
    return this.raw.fills.map(fillToIPaint);
  }
  set fills(v: IPaint[]) {
    // Simplified: only handle solid fills for now
    this.graph.updateNode(this.raw.id, {
      fills: (v as any[]).map(f => ({
        type: f.type ?? 'SOLID',
        color: 'color' in f ? { ...f.color, a: 1 } : { r: 0, g: 0, b: 0, a: 1 },
        opacity: f.opacity ?? 1,
        visible: f.visible ?? true,
      })),
    });
  }

  get strokes(): IPaint[] {
    return this.raw.strokes.map(strokeToIPaint);
  }
  set strokes(v: IPaint[]) {
    // Simplified
  }

  get effects(): IEffect[] {
    return this.raw.effects.map(effectToIEffect);
  }
  set effects(v: IEffect[]) {
    // Simplified
  }

  get cornerRadius(): number { return this.raw.cornerRadius; }
  set cornerRadius(v: number) { this.graph.updateNode(this.raw.id, { cornerRadius: v }); }

  get topLeftRadius(): number { return (this.raw as any).topLeftRadius ?? this.raw.cornerRadius; }
  get topRightRadius(): number { return (this.raw as any).topRightRadius ?? this.raw.cornerRadius; }
  get bottomLeftRadius(): number { return (this.raw as any).bottomLeftRadius ?? this.raw.cornerRadius; }
  get bottomRightRadius(): number { return (this.raw as any).bottomRightRadius ?? this.raw.cornerRadius; }

  get blendMode(): string { return (this.raw as any).blendMode ?? 'NORMAL'; }

  get strokeWeight(): number { return this.raw.strokes[0]?.weight ?? 0; }
  set strokeWeight(v: number) {
    // Simplified
  }

  get independentStrokeWeights(): boolean { return (this.raw as any).independentStrokeWeights ?? false; }
  get borderTopWeight(): number { return (this.raw as any).borderTopWeight ?? 0; }
  get borderRightWeight(): number { return (this.raw as any).borderRightWeight ?? 0; }
  get borderBottomWeight(): number { return (this.raw as any).borderBottomWeight ?? 0; }
  get borderLeftWeight(): number { return (this.raw as any).borderLeftWeight ?? 0; }

  get opacity(): number { return this.raw.opacity; }
  set opacity(v: number) { this.graph.updateNode(this.raw.id, { opacity: v }); }

  get visible(): boolean { return this.raw.visible; }
  set visible(v: boolean) { this.graph.updateNode(this.raw.id, { visible: v }); }

  get rotation(): number { return this.raw.rotation; }
  set rotation(v: number) { this.graph.updateNode(this.raw.id, { rotation: v }); }

  // Text
  get fontSize(): number { return this.raw.fontSize; }
  set fontSize(v: number) { this.graph.updateNode(this.raw.id, { fontSize: v }); }

  get fontName(): IFontName {
    return {
      family: this.raw.fontFamily,
      style: weightToStyleName(this.raw.fontWeight, this.raw.italic),
    };
  }
  set fontName(v: IFontName) {
    this.graph.updateNode(this.raw.id, {
      fontFamily: v.family,
      fontWeight: styleNameToWeight(v.style),
      italic: /italic/i.test(v.style),
    });
  }

  get italic(): boolean { return this.raw.italic; }
  set italic(v: boolean) { this.graph.updateNode(this.raw.id, { italic: v }); }

  get fontWeight(): number { return this.raw.fontWeight; }
  set fontWeight(v: number) { this.graph.updateNode(this.raw.id, { fontWeight: v }); }

  get fontFamily(): string { return this.raw.fontFamily; }
  set fontFamily(v: string) { this.graph.updateNode(this.raw.id, { fontFamily: v }); }

  get characters(): string { return this.raw.text; }

  get lineHeight(): number { return (this.raw as any).lineHeight ?? 0; }
  set lineHeight(v: number) { this.graph.updateNode(this.raw.id, { lineHeight: v } as any); }

  get letterSpacing(): number { return (this.raw as any).letterSpacing ?? 0; }
  set letterSpacing(v: number) { this.graph.updateNode(this.raw.id, { letterSpacing: v } as any); }

  get textCase(): 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' {
    return ((this.raw as any).textCase ?? 'ORIGINAL') as any;
  }
  get textDecoration(): 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH' {
    return ((this.raw as any).textDecoration ?? 'NONE') as any;
  }

  get textTruncation(): 'DISABLED' | 'ENDING' {
    return ((this.raw as any).textTruncation ?? 'DISABLED') as any;
  }
  set textTruncation(v: 'DISABLED' | 'ENDING') {
    this.graph.updateNode(this.raw.id, { textTruncation: v } as any);
  }

  get maxLines(): number | null {
    return (this.raw as any).maxLines ?? null;
  }
  set maxLines(v: number | null) {
    this.graph.updateNode(this.raw.id, { maxLines: v } as any);
  }

  get textAutoResize(): 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE' {
    return this.raw.textAutoResize;
  }
  set textAutoResize(v: 'NONE' | 'WIDTH_AND_HEIGHT' | 'HEIGHT' | 'TRUNCATE') {
    this.graph.updateNode(this.raw.id, { textAutoResize: v });
  }

  get textAlignHorizontal(): 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED' {
    return this.raw.textAlignHorizontal;
  }
  set textAlignHorizontal(v: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED') {
    this.graph.updateNode(this.raw.id, { textAlignHorizontal: v });
  }

  get textAlignVertical(): 'TOP' | 'CENTER' | 'BOTTOM' {
    return this.raw.textAlignVertical;
  }
  set textAlignVertical(v: 'TOP' | 'CENTER' | 'BOTTOM') {
    this.graph.updateNode(this.raw.id, { textAlignVertical: v });
  }

  getRangeFontSize(start: number, end: number): number {
    for (const run of this.raw.styleRuns) {
      if (start >= run.start && start < run.start + run.length) {
        return run.style.fontSize ?? this.raw.fontSize;
      }
    }
    return this.raw.fontSize;
  }

  setRangeFontSize(start: number, end: number, size: number): void {
    const newRuns = applyStyleToRange(
      this.raw.styleRuns, start, end,
      { fontSize: size },
      this.raw.text.length,
    );
    this.graph.updateNode(this.raw.id, { styleRuns: newRuns });
  }

  getRangeFontName(start: number, end: number): IFontName {
    for (const run of this.raw.styleRuns) {
      if (start >= run.start && start < run.start + run.length) {
        return {
          family: run.style.fontFamily ?? this.raw.fontFamily,
          style: weightToStyleName(
            run.style.fontWeight ?? this.raw.fontWeight,
            run.style.italic ?? this.raw.italic,
          ),
        };
      }
    }
    return this.fontName;
  }

  setRangeFontName(start: number, end: number, font: IFontName): void {
    const newRuns = applyStyleToRange(
      this.raw.styleRuns, start, end,
      {
        fontFamily: font.family,
        fontWeight: styleNameToWeight(font.style),
        italic: /italic/i.test(font.style),
      },
      this.raw.text.length,
    );
    this.graph.updateNode(this.raw.id, { styleRuns: newRuns });
  }

  getRangeAllFontNames(start: number, end: number): IFontName[] {
    const fonts = new Map<string, IFontName>();
    for (let i = start; i < end; i++) {
      const fn = this.getRangeFontName(i, i + 1);
      const key = `${fn.family}|${fn.style}`;
      if (!fonts.has(key)) fonts.set(key, fn);
    }
    return [...fonts.values()];
  }

  // Export
  get exportSettings(): IExportSettings[] { return []; }
  set exportSettings(_v: IExportSettings[]) {}
}

// ─── Weight / Style Helpers ─────────────────────────────────────

function weightToStyleName(weight: number, italic = false): string {
  const map: Record<number, string> = {
    100: 'Thin', 200: 'ExtraLight', 300: 'Light',
    400: 'Regular', 500: 'Medium', 600: 'SemiBold',
    700: 'Bold', 800: 'ExtraBold', 900: 'Black',
  };
  const snapped = Math.round(weight / 100) * 100;
  const base = map[snapped] ?? 'Regular';
  return italic ? `${base} Italic` : base;
}

function styleNameToWeight(style: string): number {
  const lower = style.toLowerCase().replace(/\s+/g, '').replace('italic', '');
  const map: Record<string, number> = {
    thin: 100, hairline: 100,
    extralight: 200, ultralight: 200,
    light: 300,
    regular: 400, normal: 400, '': 400,
    medium: 500,
    semibold: 600, demibold: 600,
    bold: 700,
    extrabold: 800, ultrabold: 800,
    black: 900, heavy: 900,
  };
  for (const [key, weight] of Object.entries(map)) {
    if (lower.includes(key) && key !== '') return weight;
  }
  return 400;
}
