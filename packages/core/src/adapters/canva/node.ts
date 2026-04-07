/**
 * Canva Node Adapter — wraps a Canva DesignEditing element into INode.
 *
 * Canva's openDesign API exposes elements with:
 *   - type: 'text' | 'rect' | 'shape' | 'group' | 'embed' | 'unsupported'
 *   - position: top, left (relative to container)
 *   - dimensions: width, height
 *   - rotation, transparency
 *
 * Key differences from Figma:
 *   - Coordinates are RELATIVE to parent group (not absolute like Figma)
 *   - Text content is accessed via RichtextRange.readPlaintext()
 *   - Fills use hex color strings, not r/g/b objects
 *   - No cornerRadius, effects, or strokes on most elements
 *   - Limited mutation API compared to Figma
 */

import {
  type INode, type IPaint, type IFontName, type IEffect,
  type IExportSettings, type ISolidPaint,
  NodeType, MIXED, type Mixed,
} from '../../host';

// ─── Canva SDK Types ────────────────────────────────────────────
// We use structural types to avoid hard dependency on @canva/design at compile time.
// The adapter works with any object matching these shapes.

export interface CanvaElementLike {
  readonly type: 'text' | 'rect' | 'shape' | 'group' | 'embed' | string;
  top: number;
  left: number;
  readonly width: number;
  readonly height: number;
  rotation: number;
  transparency: number;
  readonly locked?: boolean;
  // Text
  readonly text?: { readPlaintext(): string; readTextRegions?(): TextRegionLike[] };
  // Rect
  readonly fill?: FillLike;
  readonly stroke?: StrokeLike;
  // Shape
  readonly viewBox?: { top: number; left: number; width: number; height: number };
  readonly paths?: { toArray(): PathLike[] } | PathLike[];
  // Group
  readonly contents?: { toArray(): CanvaElementLike[]; count(): number };
}

interface TextRegionLike {
  text: string;
  formatting?: {
    fontSize?: number;
    fontWeight?: string;
    fontStyle?: string;
    color?: string;
    fontRef?: unknown;
  };
}

interface FillLike {
  readonly colorContainer?: {
    ref: { type: string; color?: string } | undefined;
    set(state: { type: 'solid'; color: string }): void;
  };
  readonly mediaContainer?: {
    ref: { type: string } | undefined;
    set(state: unknown): void;
  };
}

interface StrokeLike {
  weight: number;
  readonly colorContainer?: {
    ref: { type: string; color?: string } | undefined;
    set(state: { type: 'solid'; color: string }): void;
  };
}

interface PathLike {
  d: string;
  fill?: FillLike;
}

// ─── Type Mapping ───────────────────────────────────────────────

const CANVA_TYPE_MAP: Record<string, NodeType> = {
  text:        NodeType.Text,
  rect:        NodeType.Rectangle,
  shape:       NodeType.Vector,
  group:       NodeType.Group,
  embed:       NodeType.Other,
  unsupported: NodeType.Other,
};

// ─── Hex Color Helpers ──────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16) / 255,
    g: parseInt(clean.substring(2, 4), 16) / 255,
    b: parseInt(clean.substring(4, 6), 16) / 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ─── Font Weight Helpers ────────────────────────────────────────

function canvaWeightToStyle(weight?: string, italic?: string): string {
  const map: Record<string, string> = {
    thin: 'Thin', extralight: 'ExtraLight', light: 'Light',
    normal: 'Regular', medium: 'Medium', semibold: 'SemiBold',
    bold: 'Bold', ultrabold: 'ExtraBold', heavy: 'Black',
  };
  const base = map[weight ?? 'normal'] ?? 'Regular';
  return italic === 'italic' ? `${base} Italic` : base;
}

// ─── CanvaNodeAdapter ───────────────────────────────────────────

let nextId = 1;
const idCache = new WeakMap<object, string>();

function getElementId(el: CanvaElementLike): string {
  let id = idCache.get(el);
  if (!id) {
    id = `canva_${nextId++}`;
    idCache.set(el, id);
  }
  return id;
}

/** Global registry for getNodeById lookups. */
const globalRegistry = new Map<string, CanvaNodeAdapter>();

export class CanvaNodeAdapter implements INode {
  readonly _raw: CanvaElementLike;
  private _parent: CanvaNodeAdapter | null;
  private _name: string;

  constructor(raw: CanvaElementLike, parent: CanvaNodeAdapter | null = null, name?: string) {
    this._raw = raw;
    this._parent = parent;
    this._name = name ?? this._inferName();
    globalRegistry.set(this.id, this);
  }

  private _inferName(): string {
    if (this._raw.type === 'text' && this._raw.text) {
      const plain = this._raw.text.readPlaintext();
      return plain.length > 30 ? plain.substring(0, 30) + '…' : plain;
    }
    return this._raw.type;
  }

  // ── Identity ──
  get id(): string { return getElementId(this._raw); }
  get name(): string { return this._name; }
  set name(v: string) { this._name = v; }
  get type(): NodeType { return CANVA_TYPE_MAP[this._raw.type] ?? NodeType.Other; }
  get removed(): boolean { return false; }

  // ── Tree ──
  get parent(): INode | null { return this._parent; }

  get children(): readonly INode[] | undefined {
    if (this._raw.type !== 'group' || !this._raw.contents) return undefined;
    const arr = this._raw.contents.toArray();
    return arr.map(child => wrapCanvaElement(child, this));
  }

  appendChild(_child: INode): void {
    // Canva SDK doesn't support direct appendChild on groups via openDesign
  }

  insertChild(_index: number, _child: INode): void {
    // Not supported in Canva openDesign API
  }

  clone(): INode {
    // Canva doesn't expose clone in openDesign — return a shallow copy for engine compatibility
    return new CanvaNodeAdapter(this._raw, this._parent, this._name + ' (copy)');
  }

  remove(): void {
    // Would need ElementList.delete — tracked via CanvaHost
  }

  findAll(predicate: (node: INode) => boolean): INode[] {
    const result: INode[] = [];
    const walk = (node: CanvaNodeAdapter) => {
      if (predicate(node)) result.push(node);
      if (node.children) {
        for (const child of node.children) {
          walk(child as CanvaNodeAdapter);
        }
      }
    };
    if (this.children) {
      for (const child of this.children) walk(child as CanvaNodeAdapter);
    }
    return result;
  }

  findOne(predicate: (node: INode) => boolean): INode | null {
    const walk = (node: CanvaNodeAdapter): INode | null => {
      if (predicate(node)) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = walk(child as CanvaNodeAdapter);
          if (found) return found;
        }
      }
      return null;
    };
    if (this.children) {
      for (const child of this.children) {
        const found = walk(child as CanvaNodeAdapter);
        if (found) return found;
      }
    }
    return null;
  }

  // ── Geometry ──
  // Canva uses top/left; engine uses x/y
  get x(): number { return this._raw.left; }
  set x(v: number) { this._raw.left = v; }
  get y(): number { return this._raw.top; }
  set y(v: number) { this._raw.top = v; }
  get width(): number { return this._raw.width; }
  get height(): number { return this._raw.height; }

  resize(_w: number, _h: number): void {
    // Canva elements have readonly width/height in openDesign.
    // Mutation would go through ElementList operations or element state updates.
    // For now, this is a no-op — the engine uses this primarily for the result frame.
  }

  rescale(_scale: number): void {
    // Not directly supported
  }

  // ── Absolute transform ──
  // Canva coordinates are relative to parent. We compute absolute by walking up.
  get absoluteTransform(): [[number, number, number], [number, number, number]] {
    const abs = this._getAbsolutePosition();
    return [[1, 0, abs.x], [0, 1, abs.y]];
  }

  get absoluteBoundingBox(): { x: number; y: number; width: number; height: number } {
    const abs = this._getAbsolutePosition();
    return { x: abs.x, y: abs.y, width: this.width, height: this.height };
  }

  private _getAbsolutePosition(): { x: number; y: number } {
    let absX = this._raw.left;
    let absY = this._raw.top;
    let p = this._parent;
    while (p) {
      absX += p._raw.left;
      absY += p._raw.top;
      p = p._parent;
    }
    return { x: absX, y: absY };
  }

  // ── Layout ──
  get layoutMode(): 'NONE' { return 'NONE'; }
  set layoutMode(_v: any) {}
  get layoutPositioning(): 'ABSOLUTE' { return 'ABSOLUTE'; }
  set layoutPositioning(_v: any) {}
  get constraints() { return { horizontal: 'MIN', vertical: 'MIN' }; }
  set constraints(_v: any) {}
  get clipsContent(): boolean { return this._raw.type === 'group'; }
  set clipsContent(_v: any) {}

  // ── Visual ──
  get fills(): IPaint[] | undefined {
    if (this._raw.type === 'rect' && this._raw.fill) {
      const colorRef = this._raw.fill.colorContainer?.ref;
      if (colorRef && colorRef.type === 'solid' && 'color' in colorRef && colorRef.color) {
        const rgb = hexToRgb(colorRef.color);
        return [{ type: 'SOLID', color: rgb, opacity: 1, visible: true } as ISolidPaint];
      }
    }
    return undefined;
  }

  set fills(v: IPaint[] | Mixed | undefined) {
    if (this._raw.type === 'rect' && this._raw.fill && Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (first.type === 'SOLID' && 'color' in first) {
        const c = (first as ISolidPaint).color;
        const hex = rgbToHex(c.r, c.g, c.b);
        this._raw.fill.colorContainer?.set({ type: 'solid', color: hex });
      }
    }
  }

  get strokes(): IPaint[] | undefined {
    if (this._raw.type === 'rect' && this._raw.stroke) {
      const colorRef = this._raw.stroke.colorContainer?.ref;
      if (colorRef && colorRef.type === 'solid' && 'color' in colorRef && colorRef.color) {
        const rgb = hexToRgb(colorRef.color);
        return [{ type: 'SOLID', color: rgb, opacity: 1, visible: true } as ISolidPaint];
      }
    }
    return undefined;
  }
  set strokes(_v: any) {}

  get effects(): IEffect[] | undefined { return undefined; }
  set effects(_v: any) {}

  get cornerRadius(): number { return 0; } // Canva rects don't expose cornerRadius in openDesign
  set cornerRadius(_v: any) {}

  get strokeWeight(): number {
    return this._raw.stroke?.weight ?? 0;
  }
  set strokeWeight(v: number) {
    if (this._raw.stroke) this._raw.stroke.weight = v;
  }

  get opacity(): number { return 1 - (this._raw.transparency ?? 0); }
  set opacity(v: number) { this._raw.transparency = 1 - v; }

  get visible(): boolean { return true; } // Canva doesn't have a visible flag in openDesign
  set visible(_v: any) {}

  get rotation(): number { return this._raw.rotation ?? 0; }

  // ── Text ──
  get fontSize(): number | undefined {
    if (this._raw.type !== 'text' || !this._raw.text) return undefined;
    const regions = this._raw.text.readTextRegions?.();
    if (regions && regions.length > 0) {
      return regions[0].formatting?.fontSize;
    }
    return undefined;
  }
  set fontSize(_v: any) {
    // Text mutation in Canva requires RichtextRange.formatText — complex, deferred
  }

  get fontName(): IFontName | undefined {
    if (this._raw.type !== 'text' || !this._raw.text) return undefined;
    const regions = this._raw.text.readTextRegions?.();
    if (regions && regions.length > 0) {
      const fmt = regions[0].formatting;
      return {
        family: 'Canva Default', // fontRef is opaque in Canva — no family string exposed
        style: canvaWeightToStyle(fmt?.fontWeight, fmt?.fontStyle),
      };
    }
    return undefined;
  }
  set fontName(_v: any) {}

  get characters(): string | undefined {
    if (this._raw.type !== 'text' || !this._raw.text) return undefined;
    return this._raw.text.readPlaintext();
  }

  get textAutoResize(): 'NONE' { return 'NONE'; }
  set textAutoResize(_v: any) {}

  get textAlignHorizontal(): 'LEFT' { return 'LEFT'; } // Canva text alignment is per-paragraph via RichtextRange
  set textAlignHorizontal(_v: any) {}

  get textAlignVertical(): 'TOP' { return 'TOP'; }
  set textAlignVertical(_v: any) {}

  getRangeFontSize(start: number, _end: number): number {
    const regions = this._raw.text?.readTextRegions?.();
    if (!regions) return 16;
    let offset = 0;
    for (const region of regions) {
      const regionEnd = offset + region.text.length;
      if (start >= offset && start < regionEnd) {
        return region.formatting?.fontSize ?? 16;
      }
      offset = regionEnd;
    }
    return 16;
  }

  setRangeFontSize(_start: number, _end: number, _size: number): void {
    // Requires RichtextRange.formatText — deferred
  }

  getRangeFontName(start: number, _end: number): IFontName {
    const regions = this._raw.text?.readTextRegions?.();
    if (!regions) return { family: 'Canva Default', style: 'Regular' };
    let offset = 0;
    for (const region of regions) {
      const regionEnd = offset + region.text.length;
      if (start >= offset && start < regionEnd) {
        return {
          family: 'Canva Default',
          style: canvaWeightToStyle(region.formatting?.fontWeight, region.formatting?.fontStyle),
        };
      }
      offset = regionEnd;
    }
    return { family: 'Canva Default', style: 'Regular' };
  }

  setRangeFontName(_start: number, _end: number, _font: IFontName): void {}

  getRangeAllFontNames(start: number, end: number): IFontName[] {
    const fonts = new Map<string, IFontName>();
    for (let i = start; i < end; i++) {
      const fn = this.getRangeFontName(i, i + 1);
      const key = `${fn.family}|${fn.style}`;
      if (!fonts.has(key)) fonts.set(key, fn);
    }
    return [...fonts.values()];
  }

  // ── Export ──
  get exportSettings(): IExportSettings[] { return []; }
  set exportSettings(_v: any) {}
}

// ─── Wrap Cache ─────────────────────────────────────────────────

const wrapCache = new WeakMap<object, CanvaNodeAdapter>();

export function wrapCanvaElement(
  raw: CanvaElementLike,
  parent: CanvaNodeAdapter | null = null,
  name?: string,
): CanvaNodeAdapter {
  let cached = wrapCache.get(raw);
  if (!cached) {
    cached = new CanvaNodeAdapter(raw, parent, name);
    wrapCache.set(raw, cached);
  }
  return cached;
}

/** Get a previously wrapped node by its assigned ID. */
export function getCanvaNodeById(id: string): CanvaNodeAdapter | null {
  return globalRegistry.get(id) ?? null;
}

/** Clear all caches — call between sessions. */
export function resetCanvaAdapterState(): void {
  globalRegistry.clear();
  nextId = 1;
}
