/**
 * Atoms — visual primitives. Text, shapes, media.
 *
 * Every atom returns NodeBlueprint. Compose them inside layouts.
 * All accept optional style overrides as last argument.
 */

import { text as rawText, rect as rawRect, ellipse as rawEllipse, frame as rawFrame, solid } from '../builder.js';
import type { NodeBlueprint, NodeProps } from '../builder.js';

type StyleOverrides = Partial<NodeProps>;
import { DEFAULTS } from './defaults.js';

// ─── Text atoms ──────────────────────────────────────────────

/** Heading — large, bold text. */
export function heading(content: string, props?: StyleOverrides & { level?: 1 | 2 | 3 | 4 | 5 | 6 }): NodeBlueprint {
  const sizes: Record<number, number> = { 1: 48, 2: 36, 3: 28, 4: 24, 5: 20, 6: 16 };
  const weights: Record<number, number> = { 1: 800, 2: 700, 3: 700, 4: 600, 5: 600, 6: 600 };
  const level = props?.level ?? 1;
  return rawText(content, {
    name: `H${level}`,
    fontSize: sizes[level],
    fontWeight: weights[level],
    lineHeight: Math.round(sizes[level] * 1.1),
    textAutoResize: 'WIDTH_AND_HEIGHT',
    ...props,
  });
}

/** Body text — regular reading text. */
export function body(content: string, props?: StyleOverrides & { bold?: boolean; muted?: boolean }): NodeBlueprint {
  return rawText(content, {
    name: 'Body',
    fontSize: 16,
    fontWeight: props?.bold ? 600 : 400,
    lineHeight: 24,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    opacity: props?.muted ? 0.6 : 1,
    ...props,
  });
}

/** Label — small, secondary text. */
export function label(content: string, props?: StyleOverrides): NodeBlueprint {
  return rawText(content, {
    name: 'Label',
    fontSize: 12,
    fontWeight: 500,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    opacity: 0.6,
    ...props,
  });
}

/** Caption — tiny text under elements. */
export function caption(content: string, props?: StyleOverrides): NodeBlueprint {
  return rawText(content, {
    name: 'Caption',
    fontSize: 11,
    fontWeight: 400,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    opacity: 0.5,
    ...props,
  });
}

/** Display text — hero-sized, extra large. */
export function display(content: string, props?: StyleOverrides): NodeBlueprint {
  return rawText(content, {
    name: 'Display',
    fontSize: 64,
    fontWeight: 800,
    lineHeight: Math.round(64 * 1.05),
    letterSpacing: -1,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    ...props,
  });
}

/** Mono text — code/monospaced. */
export function mono(content: string, props?: StyleOverrides): NodeBlueprint {
  return rawText(content, {
    name: 'Mono',
    fontSize: 14,
    fontFamily: 'monospace',
    fontWeight: 400,
    lineHeight: 20,
    textAutoResize: 'HEIGHT',
    layoutAlignSelf: 'STRETCH',
    ...props,
  });
}

/** Raw text — no default styling, you control everything. */
export function txt(content: string, props?: StyleOverrides): NodeBlueprint {
  return rawText(content, { textAutoResize: 'WIDTH_AND_HEIGHT', ...props });
}

// ─── Shape atoms ─────────────────────────────────────────────

/** Rectangle — colored box. */
export function box(props?: StyleOverrides): NodeBlueprint {
  return rawRect({ width: 100, height: 100, ...props });
}

/** Circle — round shape. */
export function circle(diameter: number, props?: StyleOverrides): NodeBlueprint {
  return rawEllipse({ width: diameter, height: diameter, ...props });
}

/** Horizontal line divider. */
export function divider(props?: StyleOverrides & { color?: string; thickness?: number }): NodeBlueprint {
  const color = props?.color ?? DEFAULTS.text;
  const thickness = props?.thickness ?? 1;
  return rawRect({
    name: 'Divider',
    height: thickness,
    layoutAlignSelf: 'STRETCH',
    fills: [solid(color, 0.1)],
    ...props,
  });
}

/** Vertical divider. */
export function vdivider(props?: StyleOverrides & { color?: string; thickness?: number }): NodeBlueprint {
  const color = props?.color ?? DEFAULTS.text;
  const thickness = props?.thickness ?? 1;
  return rawRect({
    name: 'VDivider',
    width: thickness,
    layoutAlignSelf: 'STRETCH',
    fills: [solid(color, 0.1)],
    ...props,
  });
}

// ─── Media atoms ─────────────────────────────────────────────

/** Image placeholder — rectangle with image fill. */
export function image(url: string, props?: StyleOverrides & { fit?: string }): NodeBlueprint {
  const { fit, ...rest } = props ?? {};
  return rawRect({
    name: 'Image',
    width: 100,
    height: 100,
    fills: [{ type: 'IMAGE', imageHash: url, scaleMode: fit ?? 'FILL', opacity: 1, visible: true } as any],
    clipsContent: true,
    cornerRadius: 0,
    ...rest,
  });
}

/** Color swatch — small colored square. */
export function swatch(color: string, diameter: number = 24, props?: StyleOverrides): NodeBlueprint {
  return rawRect({
    name: 'Swatch',
    width: diameter,
    height: diameter,
    cornerRadius: diameter / 4,
    fills: [solid(color)],
    ...props,
  });
}
