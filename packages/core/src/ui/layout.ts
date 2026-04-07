/**
 * Layout primitives — how things are arranged.
 *
 * stack()   — vertical flow (column)
 * row()     — horizontal flow (row)
 * grid()    — CSS grid (columns × rows)
 * center()  — center content in both axes
 * spacer()  — flexible space between items
 * wrap()    — horizontal flow that wraps to next line
 * page()    — full-page container with clip
 */

import { frame as rawFrame } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';

// ─── Shorthand prop types ────────────────────────────────────

export interface LayoutProps extends Partial<NodeProps> {
  /** Gap between children */
  gap?: number;
  /** Cross-axis gap (for grid/wrap) */
  crossGap?: number;
  /** Padding — single number or [vertical, horizontal] or [top, right, bottom, left] */
  pad?: number | [number, number] | [number, number, number, number];
  /** Primary axis alignment */
  justify?: 'start' | 'center' | 'end' | 'between';
  /** Cross axis alignment */
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  /** Width (shorthand) */
  w?: number;
  /** Height (shorthand) */
  h?: number;
}

function resolveLayoutProps(p: LayoutProps, mode: 'HORIZONTAL' | 'VERTICAL' | 'NONE'): NodeProps {
  const props: NodeProps = { ...p, layoutMode: mode };

  // Shorthands
  if (p.w !== undefined) { props.width = p.w; delete (props as any).w; }
  if (p.h !== undefined) { props.height = p.h; delete (props as any).h; }

  // Gap
  if (p.gap !== undefined) { props.itemSpacing = p.gap; delete (props as any).gap; }
  if (p.crossGap !== undefined) { props.counterAxisSpacing = p.crossGap; delete (props as any).crossGap; }

  // Padding
  if (p.pad !== undefined) {
    if (typeof p.pad === 'number') {
      props.paddingTop = props.paddingRight = props.paddingBottom = props.paddingLeft = p.pad;
    } else if (p.pad.length === 2) {
      props.paddingTop = props.paddingBottom = p.pad[0];
      props.paddingRight = props.paddingLeft = p.pad[1];
    } else {
      props.paddingTop = p.pad[0];
      props.paddingRight = p.pad[1];
      props.paddingBottom = p.pad[2];
      props.paddingLeft = p.pad[3];
    }
    delete (props as any).pad;
  }

  // Justify (primary axis)
  if (p.justify !== undefined) {
    const map: Record<string, NodeProps['primaryAxisAlign']> = {
      start: 'MIN', center: 'CENTER', end: 'MAX', between: 'SPACE_BETWEEN',
    };
    props.primaryAxisAlign = map[p.justify] ?? 'MIN';
    delete (props as any).justify;
  }

  // Align (counter axis)
  if (p.align !== undefined) {
    const map: Record<string, NodeProps['counterAxisAlign']> = {
      start: 'MIN', center: 'CENTER', end: 'MAX', stretch: 'STRETCH', baseline: 'BASELINE',
    };
    props.counterAxisAlign = map[p.align] ?? 'MIN';
    delete (props as any).align;
  }

  return props;
}

// ─── Layout primitives ──────────────────────────────────────

/** Apply sizing defaults for layout containers.
 *  Primary axis (direction of children): HUG = content-sized
 *  Counter axis (perpendicular): FILL = stretch to parent width/height */
function hugDefaults(p: NodeProps): NodeProps {
  if (!p.width && !p.primaryAxisSizing) p.primaryAxisSizing = 'HUG';
  if (!p.height && !p.counterAxisSizing) p.counterAxisSizing = 'FILL';
  return p;
}

/** Vertical stack (column). Children stretch to full width by default. */
export function stack(props: LayoutProps, ...children: NodeBlueprint[]): NodeBlueprint;
export function stack(...children: NodeBlueprint[]): NodeBlueprint;
export function stack(first?: LayoutProps | NodeBlueprint, ...rest: NodeBlueprint[]): NodeBlueprint {
  if (first && typeof first === 'object' && 'kind' in first) {
    return rawFrame(hugDefaults({ layoutMode: 'VERTICAL', counterAxisAlign: 'STRETCH' }), first, ...rest);
  }
  const p = resolveLayoutProps((first ?? {}) as LayoutProps, 'VERTICAL');
  if (!p.counterAxisAlign) p.counterAxisAlign = 'STRETCH';
  return rawFrame(hugDefaults(p), ...rest);
}

/** Horizontal row. Children auto-size by default. */
export function row(props: LayoutProps, ...children: NodeBlueprint[]): NodeBlueprint;
export function row(...children: NodeBlueprint[]): NodeBlueprint;
export function row(first?: LayoutProps | NodeBlueprint, ...rest: NodeBlueprint[]): NodeBlueprint {
  if (first && typeof first === 'object' && 'kind' in first) {
    return rawFrame(hugDefaults({ layoutMode: 'HORIZONTAL' }), first, ...rest);
  }
  return rawFrame(hugDefaults(resolveLayoutProps((first ?? {}) as LayoutProps, 'HORIZONTAL')), ...rest);
}

/** Horizontal row that wraps to next line. */
export function wrap(props: LayoutProps, ...children: NodeBlueprint[]): NodeBlueprint;
export function wrap(...children: NodeBlueprint[]): NodeBlueprint;
export function wrap(first?: LayoutProps | NodeBlueprint, ...rest: NodeBlueprint[]): NodeBlueprint {
  if (first && typeof first === 'object' && 'kind' in first) {
    return rawFrame(hugDefaults({ layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' }), first, ...rest);
  }
  const p = hugDefaults(resolveLayoutProps((first ?? {}) as LayoutProps, 'HORIZONTAL'));
  p.layoutWrap = 'WRAP';
  return rawFrame(p, ...rest);
}

/** Center content in both axes. */
export function center(props: LayoutProps, ...children: NodeBlueprint[]): NodeBlueprint;
export function center(...children: NodeBlueprint[]): NodeBlueprint;
export function center(first?: LayoutProps | NodeBlueprint, ...rest: NodeBlueprint[]): NodeBlueprint {
  if (first && typeof first === 'object' && 'kind' in first) {
    return rawFrame(hugDefaults({ layoutMode: 'VERTICAL', primaryAxisAlign: 'CENTER', counterAxisAlign: 'CENTER' }), first, ...rest);
  }
  const p = hugDefaults(resolveLayoutProps((first ?? {}) as LayoutProps, 'VERTICAL'));
  p.primaryAxisAlign = p.primaryAxisAlign ?? 'CENTER';
  p.counterAxisAlign = p.counterAxisAlign ?? 'CENTER';
  return rawFrame(p, ...rest);
}

/** CSS-like grid layout. */
export function grid(props: LayoutProps & {
  columns?: number | number[];
  rows?: number | number[];
}, ...children: NodeBlueprint[]): NodeBlueprint {
  const p = resolveLayoutProps(props, 'HORIZONTAL');
  p.layoutWrap = 'WRAP';

  // If columns is a number, divide width equally via flex grow
  // Children should use grow() or fixed widths
  if (typeof props.columns === 'number' && props.columns > 0 && p.width) {
    const colGap = p.itemSpacing ?? 0;
    const totalGap = colGap * (props.columns - 1);
    const colWidth = Math.floor((p.width - (p.paddingLeft ?? 0) - (p.paddingRight ?? 0) - totalGap) / props.columns);
    // Set width on children
    return rawFrame(p, ...children.map(c => {
      return rawFrame({ width: colWidth, layoutMode: 'VERTICAL' }, c);
    }));
  }

  return rawFrame(p, ...children);
}

/** Flexible spacer — expands to fill available space. */
export function spacer(minSize?: number): NodeBlueprint {
  return rawFrame({
    name: 'Spacer',
    layoutGrow: 1,
    width: minSize ?? 1,
    height: minSize ?? 1,
  });
}

/** Full-page container. Children stretch to full width by default. */
export function page(props: LayoutProps & { w: number; h: number }, ...children: NodeBlueprint[]): NodeBlueprint {
  const p = resolveLayoutProps(props, 'VERTICAL');
  p.clipsContent = true;
  p.primaryAxisSizing = 'FIXED';
  p.counterAxisSizing = 'FIXED';
  if (!p.counterAxisAlign) p.counterAxisAlign = 'STRETCH';
  return rawFrame(p, ...children);
}

/** Container — generic frame with layout shorthands. */
export function container(props: LayoutProps, ...children: NodeBlueprint[]): NodeBlueprint {
  const mode = props.layoutMode ?? 'VERTICAL';
  return rawFrame(resolveLayoutProps(props, mode as any), ...children);
}

/** Overlay — absolutely positioned child on top of parent. */
export function overlay(props: LayoutProps & { x?: number; y?: number }, ...children: NodeBlueprint[]): NodeBlueprint {
  const p = resolveLayoutProps(props, 'VERTICAL');
  p.layoutPositioning = 'ABSOLUTE';
  return rawFrame(p, ...children);
}
