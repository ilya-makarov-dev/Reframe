/// <reference types="@figma/plugin-typings" />
/**
 * Figma Node Adapter — wraps a native Figma SceneNode into INode.
 *
 * This is a thin proxy: reads/writes go directly to the underlying Figma node.
 * The wrapper is lazy — children are wrapped on access, not eagerly.
 */

import { type INode, type IPaint, type IFontName, type IEffect, type IExportSettings, NodeType, MIXED, type Mixed } from '../../host';

const TYPE_MAP: Record<string, NodeType> = {
  FRAME: NodeType.Frame,
  GROUP: NodeType.Group,
  TEXT: NodeType.Text,
  RECTANGLE: NodeType.Rectangle,
  ELLIPSE: NodeType.Ellipse,
  STAR: NodeType.Star,
  POLYGON: NodeType.Polygon,
  VECTOR: NodeType.Vector,
  INSTANCE: NodeType.Instance,
  COMPONENT: NodeType.Component,
  BOOLEAN_OPERATION: NodeType.BooleanOp,
  LINE: NodeType.Line,
  SLICE: NodeType.Slice,
};

/** Cache of wrapped nodes keyed by Figma node id. */
const wrapCache = new WeakMap<object, FigmaNodeAdapter>();

export function wrapFigmaNode(raw: SceneNode): INode {
  let cached = wrapCache.get(raw);
  if (!cached) {
    cached = new FigmaNodeAdapter(raw);
    wrapCache.set(raw, cached);
  }
  return cached;
}

function mixedToEngine(val: any): any {
  return val === figma.mixed ? MIXED : val;
}

function engineToMixed(val: any): any {
  return val === MIXED ? figma.mixed : val;
}

class FigmaNodeAdapter implements INode {
  constructor(public readonly _raw: SceneNode) {}

  // ── Identity ──
  get id() { return this._raw.id; }
  get name() { return this._raw.name; }
  set name(v: string) { this._raw.name = v; }
  get type(): NodeType { return TYPE_MAP[this._raw.type] ?? NodeType.Other; }
  get removed() { return this._raw.removed; }

  // ── Tree ──
  get parent(): INode | null {
    const p = this._raw.parent;
    return p && 'type' in p && (p as any).type !== 'PAGE' && (p as any).type !== 'DOCUMENT'
      ? wrapFigmaNode(p as SceneNode)
      : null;
  }

  get children(): readonly INode[] | undefined {
    if (!('children' in this._raw)) return undefined;
    return (this._raw as any).children.map((c: SceneNode) => wrapFigmaNode(c));
  }

  appendChild(child: INode): void {
    const raw = (child as FigmaNodeAdapter)._raw;
    if ('appendChild' in this._raw) {
      (this._raw as any).appendChild(raw);
    }
  }

  clone(): INode {
    return wrapFigmaNode((this._raw as any).clone());
  }

  remove(): void {
    if ('remove' in this._raw) (this._raw as any).remove();
  }

  insertChild(index: number, child: INode): void {
    const raw = (child as FigmaNodeAdapter)._raw;
    if ('insertChild' in this._raw) (this._raw as any).insertChild(index, raw);
  }

  findAll(predicate: (node: INode) => boolean): INode[] {
    if (!('findAll' in this._raw)) return [];
    const results = (this._raw as any).findAll((n: SceneNode) => predicate(wrapFigmaNode(n)));
    return results.map((n: SceneNode) => wrapFigmaNode(n));
  }

  findOne(predicate: (node: INode) => boolean): INode | null {
    if (!('findOne' in this._raw)) return null;
    const result = (this._raw as any).findOne((n: SceneNode) => predicate(wrapFigmaNode(n)));
    return result ? wrapFigmaNode(result) : null;
  }

  // ── Geometry ──
  get x() { return (this._raw as any).x ?? 0; }
  set x(v: number) { if ('x' in this._raw) (this._raw as any).x = v; }
  get y() { return (this._raw as any).y ?? 0; }
  set y(v: number) { if ('y' in this._raw) (this._raw as any).y = v; }
  get width() { return (this._raw as any).width ?? 0; }
  get height() { return (this._raw as any).height ?? 0; }

  resize(w: number, h: number): void {
    if ('resize' in this._raw) (this._raw as any).resize(w, h);
  }

  rescale(scale: number): void {
    if ('rescale' in this._raw) (this._raw as any).rescale(scale);
  }

  // ── Absolute transform ──
  get absoluteTransform() { return (this._raw as any).absoluteTransform ?? undefined; }
  get absoluteBoundingBox() { return (this._raw as any).absoluteBoundingBox ?? null; }

  // ── Layout ──
  get layoutMode() { return (this._raw as any).layoutMode; }
  set layoutMode(v: any) { if ('layoutMode' in this._raw) (this._raw as any).layoutMode = v; }
  get layoutPositioning() { return (this._raw as any).layoutPositioning; }
  set layoutPositioning(v: any) { if ('layoutPositioning' in this._raw) (this._raw as any).layoutPositioning = v; }
  get constraints() { return (this._raw as any).constraints; }
  set constraints(v: any) { if ('constraints' in this._raw) (this._raw as any).constraints = v; }
  get clipsContent() { return (this._raw as any).clipsContent; }
  set clipsContent(v: any) { if ('clipsContent' in this._raw) (this._raw as any).clipsContent = v; }

  // ── Visual ──
  get fills(): IPaint[] | Mixed | undefined {
    if (!('fills' in this._raw)) return undefined;
    const f = (this._raw as any).fills;
    return f === figma.mixed ? MIXED : f;
  }
  set fills(v: any) {
    if ('fills' in this._raw) (this._raw as any).fills = engineToMixed(v);
  }
  get strokes() { return ('strokes' in this._raw) ? (this._raw as any).strokes : undefined; }
  set strokes(v: any) { if ('strokes' in this._raw) (this._raw as any).strokes = v; }
  get effects() { return ('effects' in this._raw) ? (this._raw as any).effects : undefined; }
  set effects(v: any) { if ('effects' in this._raw) (this._raw as any).effects = v; }
  get cornerRadius() { return mixedToEngine((this._raw as any).cornerRadius); }
  set cornerRadius(v: any) { if ('cornerRadius' in this._raw) (this._raw as any).cornerRadius = engineToMixed(v); }
  get strokeWeight() { return mixedToEngine((this._raw as any).strokeWeight); }
  set strokeWeight(v: any) { if ('strokeWeight' in this._raw) (this._raw as any).strokeWeight = engineToMixed(v); }
  get opacity() { return (this._raw as any).opacity; }
  set opacity(v: any) { if ('opacity' in this._raw) (this._raw as any).opacity = v; }
  get visible() { return (this._raw as any).visible; }
  set visible(v: any) { if ('visible' in this._raw) (this._raw as any).visible = v; }
  get rotation() { return (this._raw as any).rotation; }

  // ── Text ──
  get fontSize() { return mixedToEngine((this._raw as any).fontSize); }
  set fontSize(v: any) { if ('fontSize' in this._raw) (this._raw as any).fontSize = engineToMixed(v); }
  get fontName() { return mixedToEngine((this._raw as any).fontName); }
  set fontName(v: any) { if ('fontName' in this._raw) (this._raw as any).fontName = engineToMixed(v); }
  get characters() { return (this._raw as any).characters; }
  get textAutoResize() { return (this._raw as any).textAutoResize; }
  set textAutoResize(v: any) { if ('textAutoResize' in this._raw) (this._raw as any).textAutoResize = v; }
  get textAlignHorizontal() { return (this._raw as any).textAlignHorizontal; }
  set textAlignHorizontal(v: any) { if ('textAlignHorizontal' in this._raw) (this._raw as any).textAlignHorizontal = v; }
  get textAlignVertical() { return (this._raw as any).textAlignVertical; }
  set textAlignVertical(v: any) { if ('textAlignVertical' in this._raw) (this._raw as any).textAlignVertical = v; }

  getRangeFontSize(start: number, end: number): number {
    return (this._raw as any).getRangeFontSize(start, end);
  }
  setRangeFontSize(start: number, end: number, size: number): void {
    (this._raw as any).setRangeFontSize(start, end, size);
  }
  getRangeFontName(start: number, end: number): IFontName {
    return (this._raw as any).getRangeFontName(start, end);
  }
  setRangeFontName(start: number, end: number, font: IFontName): void {
    (this._raw as any).setRangeFontName(start, end, font);
  }

  // ── Export ──
  get exportSettings() { return (this._raw as any).exportSettings; }
  set exportSettings(v: any) { if ('exportSettings' in this._raw) (this._raw as any).exportSettings = v; }
}
