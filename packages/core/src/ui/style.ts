/**
 * Style helpers — shortcuts for common visual properties.
 *
 * These return partial NodeProps that merge into any component.
 * Use with spread: heading('Title', { ...pad(24), ...fill('#fff') })
 * Or pass directly to layout: stack({ ...pad(24, 32), ...fill('#000') }, ...)
 */

import type { NodeProps } from '../builder.js';
import { solid as solidPaint, linearGradient as lgPaint, radialGradient as rgPaint, dropShadow as dsPaint, innerShadow as isPaint, blur as blurPaint, image as imgPaint } from '../builder.js';
import type { ISolidPaint, IGradientPaint, IImagePaint, IEffect } from '../host/types.js';

// ─── Colors ──────────────────────────────────────────────────

type ColorInput = string | { r: number; g: number; b: number };

/** Solid fill shortcut. */
export function fill(color: ColorInput, opacity?: number): Partial<NodeProps> {
  return { fills: [solidPaint(color, opacity)] };
}

/** Multiple fills. */
export function fills(...colors: Array<ColorInput | [ColorInput, number]>): Partial<NodeProps> {
  return {
    fills: colors.map(c => {
      if (Array.isArray(c)) return solidPaint(c[0], c[1]);
      return solidPaint(c);
    }),
  };
}

/** Linear gradient fill. */
export function gradient(from: ColorInput, to: ColorInput, opacity?: number): Partial<NodeProps> {
  return {
    fills: [lgPaint([
      { color: from, position: 0 },
      { color: to, position: 1 },
    ], opacity)],
  };
}

/** Image fill. */
export function imageFill(url: string, mode: string = 'FILL', opacity?: number): Partial<NodeProps> {
  return { fills: [imgPaint(url, mode, opacity)] };
}

// ─── Spacing ─────────────────────────────────────────────────

/** Uniform or per-side padding. pad(16) or pad(16, 24) or pad(16, 24, 16, 24) */
export function pad(...args: number[]): Partial<NodeProps> {
  if (args.length === 1) {
    return { paddingTop: args[0], paddingRight: args[0], paddingBottom: args[0], paddingLeft: args[0] };
  }
  if (args.length === 2) {
    return { paddingTop: args[0], paddingRight: args[1], paddingBottom: args[0], paddingLeft: args[1] };
  }
  return { paddingTop: args[0], paddingRight: args[1], paddingBottom: args[2], paddingLeft: args[3] ?? args[1] };
}

/** Gap between children. */
export function gap(spacing: number, crossSpacing?: number): Partial<NodeProps> {
  const r: Partial<NodeProps> = { itemSpacing: spacing };
  if (crossSpacing !== undefined) r.counterAxisSpacing = crossSpacing;
  return r;
}

// ─── Size ────────────────────────────────────────────────────

/** Fixed size. size(100) = square, size(200, 100) = rect */
export function size(w: number, h?: number): Partial<NodeProps> {
  return { width: w, height: h ?? w };
}

/** Min/max constraints. */
export function minSize(w?: number, h?: number): Partial<NodeProps> {
  const r: Partial<NodeProps> = {};
  if (w !== undefined) r.minWidth = w;
  if (h !== undefined) r.minHeight = h;
  return r as any;
}

export function maxSize(w?: number, h?: number): Partial<NodeProps> {
  const r: Partial<NodeProps> = {};
  if (w !== undefined) r.maxWidth = w;
  if (h !== undefined) r.maxHeight = h;
  return r as any;
}

/** Stretch to fill parent axis. */
export function stretch(): Partial<NodeProps> {
  return { layoutAlignSelf: 'STRETCH' };
}

/** Grow to fill available space. */
export function grow(factor: number = 1): Partial<NodeProps> {
  return { layoutGrow: factor };
}

/** Fixed sizing on both axes. */
export function fixed(): Partial<NodeProps> {
  return { primaryAxisSizing: 'FIXED', counterAxisSizing: 'FIXED' };
}

/** Hug content on primary axis. */
export function hug(): Partial<NodeProps> {
  return { primaryAxisSizing: 'HUG' };
}

// ─── Shape ───────────────────────────────────────────────────

/** Corner radius. radius(8) or radius(8, 8, 0, 0) */
export function radius(...args: number[]): Partial<NodeProps> {
  if (args.length === 1) return { cornerRadius: args[0] };
  return {
    topLeftRadius: args[0],
    topRightRadius: args[1],
    bottomRightRadius: args[2] ?? args[0],
    bottomLeftRadius: args[3] ?? args[1],
    independentCorners: true,
  };
}

/** Fully rounded (pill shape). */
export function pill(): Partial<NodeProps> {
  return { cornerRadius: 9999 };
}

/** Clip content to frame bounds. */
export function clip(): Partial<NodeProps> {
  return { clipsContent: true };
}

// ─── Effects ─────────────────────────────────────────────────

/** Drop shadow. shadow() or shadow(16) or shadow(16, '#000', 0.25) */
export function shadow(blurRadius?: number, color?: ColorInput, offsetY?: number): Partial<NodeProps> {
  return {
    effects: [dsPaint({
      radius: blurRadius ?? 8,
      color: color ?? '#000000',
      offset: { x: 0, y: offsetY ?? 4 },
    })],
  };
}

/** Inner shadow. */
export function innerShadow(blurRadius?: number, color?: ColorInput): Partial<NodeProps> {
  return { effects: [isPaint({ radius: blurRadius ?? 4, color: color ?? '#000000' })] };
}

/** Blur. */
export function blurEffect(blurRadius: number = 4): Partial<NodeProps> {
  return { effects: [blurPaint(blurRadius)] };
}

// ─── Border ──────────────────────────────────────────────────

/** Stroke border. border('#ccc') or border('#ccc', 2) */
export function border(color: ColorInput, weight?: number): Partial<NodeProps> {
  return {
    strokes: [solidPaint(color) as any],
    dashPattern: [],
  };
}

/** Dashed border. */
export function dashed(color: ColorInput, dash: number = 4, gapSize: number = 4): Partial<NodeProps> {
  return {
    strokes: [solidPaint(color) as any],
    dashPattern: [dash, gapSize],
  };
}

// ─── Position ────────────────────────────────────────────────

/** Absolute positioning within parent. */
export function absolute(x: number, y: number): Partial<NodeProps> {
  return { layoutPositioning: 'ABSOLUTE', x, y };
}

/** Inset from edges (absolute positioning). */
export function inset(top: number, right?: number, bottom?: number, left?: number): Partial<NodeProps> {
  return { layoutPositioning: 'ABSOLUTE', x: left ?? top, y: top };
}

// ─── Visibility ──────────────────────────────────────────────

/** Opacity. */
export function opacity(value: number): Partial<NodeProps> {
  return { opacity: value };
}

/** Hidden node. */
export function hidden(): Partial<NodeProps> {
  return { visible: false };
}

// ─── Text style shortcuts ────────────────────────────────────

/** Bold weight. */
export function bold(): Partial<NodeProps> {
  return { fontWeight: 700 };
}

/** Semibold weight. */
export function semibold(): Partial<NodeProps> {
  return { fontWeight: 600 };
}

/** Light weight. */
export function light(): Partial<NodeProps> {
  return { fontWeight: 300 };
}

/** Italic. */
export function italic(): Partial<NodeProps> {
  return { italic: true };
}

/** Underline. */
export function underline(): Partial<NodeProps> {
  return { textDecoration: 'UNDERLINE' };
}

/** Uppercase. */
export function uppercase(): Partial<NodeProps> {
  return { textCase: 'UPPER' };
}

/** Text alignment. */
export function textAlign(h: 'LEFT' | 'CENTER' | 'RIGHT'): Partial<NodeProps> {
  return { textAlignHorizontal: h };
}

/** Truncate text with ellipsis. */
export function truncate(maxLines: number = 1): Partial<NodeProps> {
  return { textTruncation: 'ENDING', maxLines };
}

// ─── Semantic ────────────────────────────────────────────────

/** Semantic role. */
export function role(r: string): Record<string, string> {
  return { semanticRole: r } as any;
}

// ─── Merge helper ────────────────────────────────────────────

/** Merge multiple style objects into one props object. */
export function styles(...parts: Partial<NodeProps>[]): Partial<NodeProps> {
  const result: any = {};
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      if (key === 'fills' || key === 'strokes' || key === 'effects') {
        result[key] = [...(result[key] ?? []), ...(value as any[])];
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}
