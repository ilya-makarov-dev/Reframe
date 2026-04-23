// Panel composition helpers — the kernel built from Phase 0-3 lessons.
//
// Panels pay one repeating cost: spelling out `primaryAxisSizing: 'HUG'`
// + `counterAxisSizing: 'FIXED'` on every VERTICAL container (and the
// inverse for wrap grids). Forgetting it collapses the container to
// 100px — caught live in Phase 3.1. These helpers make the sizing pair
// REQUIRED by typing + default to the common shape so panel code becomes
// about content, not sizing gymnastics.
//
// Typography / color / spacing constants also live here so all panels
// share one palette — no more hand-tuned greys drifting between
// brand-palette / inspector / brand-gallery.

import { SceneGraph } from '../engine/scene-graph';
import type { AgentGesture, NodeIntent, SceneNode } from '../engine/types';

// ─── Shared palette ─────────────────────────────────────────────

export const PANEL_COLORS = {
  SURFACE_BG: { r: 0.066, g: 0.066, b: 0.078, a: 1 },
  SURFACE: { r: 0.086, g: 0.086, b: 0.102, a: 1 },
  SURFACE_ELEV: { r: 0.109, g: 0.109, b: 0.129, a: 1 },
  BORDER: { r: 0.172, g: 0.172, b: 0.204, a: 1 },
  BORDER_SUBTLE: { r: 0.12, g: 0.12, b: 0.14, a: 1 },
  TEXT_PRIMARY: { r: 0.98, g: 0.98, b: 0.98, a: 1 },
  TEXT_SECONDARY: { r: 0.72, g: 0.72, b: 0.76, a: 1 },
  TEXT_TERTIARY: { r: 0.52, g: 0.52, b: 0.56, a: 1 },
  ACCENT: { r: 0.388, g: 0.357, b: 1.0, a: 1 },
  DANGER: { r: 0.82, g: 0.35, b: 0.35, a: 1 },
  SUCCESS: { r: 0.063, g: 0.725, b: 0.506, a: 1 },
  WARNING: { r: 0.96, g: 0.62, b: 0.04, a: 1 },
} as const;

// ─── Fills helpers ──────────────────────────────────────────────

export function solidFill(color: { r: number; g: number; b: number; a?: number }) {
  return [{ type: 'SOLID', color: { ...color, a: color.a ?? 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' }] as any;
}

export function solidStroke(color: { r: number; g: number; b: number; a?: number }, weight = 1) {
  return {
    strokes: [{ type: 'SOLID', color: { ...color, a: color.a ?? 1 }, visible: true, opacity: 1 } as any],
    borderTopWeight: weight,
    borderRightWeight: weight,
    borderBottomWeight: weight,
    borderLeftWeight: weight,
  };
}

export function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return { r, g, b, a: 1 };
}

// ─── Intent + gesture helpers ──────────────────────────────────

export function intent(role: string, purpose: string, editableBy: NodeIntent['editableBy'] = 'locked'): NodeIntent {
  return { role, purpose, editableBy };
}

export function gesture(tool: string, args: Record<string, unknown>, fastPath?: AgentGesture['fastPath']): AgentGesture {
  return fastPath ? { tool, args, fastPath } : { tool, args };
}

// ─── Panel shell ────────────────────────────────────────────────

export interface BuildPanelOpts {
  name: string;
  width: number;
  /** Panel's intent role — e.g. 'brand-palette/panel'. */
  role: string;
  purpose?: string;
  editableBy?: NodeIntent['editableBy'];
  /** Slot accepts — empty = any panel kind. */
  mountSlot?: { name: string; accepts?: string[] };
  /** Default 16 (right-panel) or 40 (page.main) depending on width. */
  padding?: number;
  itemSpacing?: number;
  /** Background fill. Default SURFACE_BG. */
  background?: { r: number; g: number; b: number; a?: number };
}

/**
 * Build the panel root FRAME with enforced axisSizing (HUG vertical /
 * FIXED counter). Use this for every new panel — the enforced sizing
 * is the single most common Phase-3-regression source.
 */
export function buildPanel(graph: SceneGraph, opts: BuildPanelOpts): SceneNode {
  const root = graph.getNode(graph.rootId);
  if (!root) throw new Error('SceneGraph root missing');

  const padding = opts.padding ?? (opts.width > 600 ? 40 : 16);
  const bg = opts.background ?? PANEL_COLORS.SURFACE_BG;

  graph.updateNode(root.id, {
    name: opts.name,
    type: 'FRAME' as any,
    width: opts.width,
    fills: solidFill(bg),
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    paddingTop: padding,
    paddingBottom: padding,
    paddingLeft: padding,
    paddingRight: padding,
    itemSpacing: opts.itemSpacing ?? (opts.width > 600 ? 32 : 16),
    mountSlot: opts.mountSlot ? { name: opts.mountSlot.name, accepts: opts.mountSlot.accepts ?? [] } : null,
    intent: intent(opts.role, opts.purpose ?? '', opts.editableBy ?? 'both'),
  } as any);
  return root;
}

// ─── Section (vertical container with title) ────────────────────

export interface BuildSectionOpts {
  parent: SceneNode;
  name: string;
  width: number;
  role: string;
  title?: string;
  /** Small-caps caption above content. */
  label?: string;
  itemSpacing?: number;
  background?: { r: number; g: number; b: number; a?: number };
  bordered?: boolean;
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  cornerRadius?: number;
}

export function buildSection(graph: SceneGraph, opts: BuildSectionOpts): SceneNode {
  const pad = opts.padding ?? {};
  const frameProps: any = {
    name: opts.name,
    width: opts.width,
    fills: opts.background ? solidFill(opts.background) : [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: opts.itemSpacing ?? 12,
    paddingTop: pad.top ?? 0,
    paddingBottom: pad.bottom ?? 0,
    paddingLeft: pad.left ?? 0,
    paddingRight: pad.right ?? 0,
    cornerRadius: opts.cornerRadius ?? 0,
    intent: intent(opts.role, '', 'locked'),
  };
  if (opts.bordered) {
    Object.assign(frameProps, solidStroke(PANEL_COLORS.BORDER_SUBTLE, 1));
  }
  const section = graph.createNode('FRAME' as any, opts.parent.id, frameProps);

  if (opts.label) {
    graph.createNode('TEXT' as any, section.id, {
      name: 'section-label',
      text: opts.label.toUpperCase(),
      fontSize: 10,
      fontFamily: 'JetBrains Mono',
      fontWeight: 600,
      width: opts.width,
      height: 14,
      letterSpacing: 0.5,
      fills: solidFill(PANEL_COLORS.TEXT_TERTIARY),
      intent: intent(`${opts.role}/label`, opts.label, 'locked'),
    } as any);
  }
  if (opts.title) {
    graph.createNode('TEXT' as any, section.id, {
      name: 'section-title',
      text: opts.title,
      fontSize: 18,
      fontFamily: 'Inter',
      fontWeight: 600,
      width: opts.width,
      height: 26,
      fills: solidFill(PANEL_COLORS.TEXT_PRIMARY),
      intent: intent(`${opts.role}/title`, opts.title, 'locked'),
    } as any);
  }
  return section;
}

// ─── Card (small bordered container) ────────────────────────────

export interface BuildCardOpts {
  parent: SceneNode;
  name: string;
  width: number;
  height?: number;
  role: string;
  purpose?: string;
  onClick?: AgentGesture;
  cornerRadius?: number;
  padding?: number;
  itemSpacing?: number;
  bordered?: boolean;
  focusable?: boolean;
  danger?: boolean;
}

export function buildCard(graph: SceneGraph, opts: BuildCardOpts): SceneNode {
  const props: any = {
    name: opts.name,
    width: opts.width,
    cornerRadius: opts.cornerRadius ?? 10,
    fills: solidFill(PANEL_COLORS.SURFACE),
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    paddingTop: opts.padding ?? 12,
    paddingBottom: opts.padding ?? 12,
    paddingLeft: opts.padding ?? 12,
    paddingRight: opts.padding ?? 12,
    itemSpacing: opts.itemSpacing ?? 8,
    intent: intent(opts.role, opts.purpose ?? '', opts.onClick ? 'both' : 'locked'),
  };
  if (opts.height !== undefined) {
    props.height = opts.height;
    props.primaryAxisSizing = 'FIXED';
  }
  if (opts.bordered ?? true) {
    Object.assign(props, solidStroke(opts.danger ? PANEL_COLORS.DANGER : PANEL_COLORS.BORDER_SUBTLE, 1));
  }
  if (opts.onClick) {
    props.semanticRole = 'button';
    props.focusable = opts.focusable ?? true;
    props.onClick = opts.onClick;
  }
  return graph.createNode('FRAME' as any, opts.parent.id, props);
}

// ─── Button (common interactive primitive) ──────────────────────

export interface BuildButtonOpts {
  parent: SceneNode;
  name: string;
  label: string;
  width?: number;
  height?: number;
  onClick?: AgentGesture;
  keybinding?: { combo: string; tool: string; args: Record<string, unknown> };
  role: string;
  purpose?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

export function buildButton(graph: SceneGraph, opts: BuildButtonOpts): SceneNode {
  const variant = opts.variant ?? 'secondary';
  const bg = variant === 'primary' ? PANEL_COLORS.ACCENT
    : variant === 'danger' ? PANEL_COLORS.SURFACE
    : PANEL_COLORS.SURFACE;
  const borderColor = variant === 'primary' ? PANEL_COLORS.ACCENT
    : variant === 'danger' ? PANEL_COLORS.DANGER
    : variant === 'ghost' ? null
    : PANEL_COLORS.BORDER;
  const textColor = variant === 'primary' ? { r: 1, g: 1, b: 1, a: 1 }
    : variant === 'danger' ? PANEL_COLORS.DANGER
    : PANEL_COLORS.TEXT_PRIMARY;

  const height = opts.height ?? 44; // WCAG touch target
  const width = opts.width ?? 120;

  const btnProps: any = {
    name: opts.name,
    width,
    height,
    cornerRadius: 8,
    fills: solidFill(bg),
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    primaryAxisAlign: 'CENTER',
    counterAxisAlign: 'CENTER',
    paddingLeft: 16,
    paddingRight: 16,
    semanticRole: 'button',
    focusable: true,
    intent: intent(opts.role, opts.purpose ?? opts.label, 'both'),
  };
  if (opts.onClick) btnProps.onClick = opts.onClick;
  if (opts.keybinding) btnProps.keybinding = opts.keybinding;
  if (borderColor) Object.assign(btnProps, solidStroke(borderColor, 1));

  const btn = graph.createNode('FRAME' as any, opts.parent.id, btnProps);

  graph.createNode('TEXT' as any, btn.id, {
    name: 'label',
    text: opts.label,
    fontSize: 13,
    fontFamily: 'Inter',
    fontWeight: 500,
    width: width - 32,
    height: 18,
    textAlignHorizontal: 'CENTER',
    fills: solidFill(textColor),
    intent: intent(`${opts.role}/label`, opts.label, 'locked'),
  } as any);

  return btn;
}

// ─── Horizontal wrap grid (for swatch grids, card grids) ────────

export interface BuildGridOpts {
  parent: SceneNode;
  name: string;
  width: number;
  role: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
}

/**
 * Build a flex-wrap horizontal container. Uses `primaryAxisSizing: FIXED`
 * (inherits `width`) + `counterAxisSizing: HUG` (grows as rows wrap).
 * Getting this pair wrong is the #2 Phase-3-regression source after HUG
 * on verticals — hence a dedicated helper that hard-codes it.
 */
export function buildGrid(graph: SceneGraph, opts: BuildGridOpts): SceneNode {
  return graph.createNode('FRAME' as any, opts.parent.id, {
    name: opts.name,
    width: opts.width,
    fills: [],
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    itemSpacing: opts.itemSpacing ?? 16,
    counterAxisSpacing: opts.counterAxisSpacing ?? 16,
    intent: intent(opts.role, '', 'locked'),
  } as any);
}

// ─── Text (typography-consistent leaf) ──────────────────────────

export type TextStyle =
  | 'title'        // 32/600
  | 'section'      // 18/600
  | 'body'         // 14/400
  | 'body-strong'  // 14/500
  | 'caption'      // 12/400 secondary text
  | 'mono-small'   // 11/400 JetBrains Mono
  | 'label-small'  // 10/600 UPPERCASE JetBrains Mono TEXT_TERTIARY
;

const TEXT_STYLES: Record<TextStyle, { size: number; weight: number; family: string; color: keyof typeof PANEL_COLORS; lineHeight: number }> = {
  'title':        { size: 32, weight: 600, family: 'Inter', color: 'TEXT_PRIMARY', lineHeight: 40 },
  'section':      { size: 18, weight: 600, family: 'Inter', color: 'TEXT_PRIMARY', lineHeight: 26 },
  'body':         { size: 14, weight: 400, family: 'Inter', color: 'TEXT_SECONDARY', lineHeight: 22 },
  'body-strong':  { size: 14, weight: 500, family: 'Inter', color: 'TEXT_PRIMARY', lineHeight: 22 },
  'caption':      { size: 12, weight: 400, family: 'Inter', color: 'TEXT_TERTIARY', lineHeight: 18 },
  'mono-small':   { size: 11, weight: 400, family: 'JetBrains Mono', color: 'TEXT_TERTIARY', lineHeight: 16 },
  'label-small':  { size: 10, weight: 600, family: 'JetBrains Mono', color: 'TEXT_TERTIARY', lineHeight: 14 },
};

export interface BuildTextOpts {
  parent: SceneNode;
  name: string;
  text: string;
  style: TextStyle;
  width: number;
  role: string;
  purpose?: string;
  /** Override color (defaults to style-specific). */
  color?: keyof typeof PANEL_COLORS;
  align?: 'LEFT' | 'CENTER' | 'RIGHT';
}

export function buildText(graph: SceneGraph, opts: BuildTextOpts): SceneNode {
  const s = TEXT_STYLES[opts.style];
  const colorKey = opts.color ?? s.color;
  return graph.createNode('TEXT' as any, opts.parent.id, {
    name: opts.name,
    text: opts.text,
    fontSize: s.size,
    fontFamily: s.family,
    fontWeight: s.weight,
    width: opts.width,
    height: s.lineHeight,
    textAlignHorizontal: opts.align ?? 'LEFT',
    textCase: opts.style === 'label-small' ? 'UPPER' : 'ORIGINAL',
    letterSpacing: opts.style === 'label-small' ? 0.5 : 0,
    fills: solidFill(PANEL_COLORS[colorKey]),
    intent: intent(opts.role, opts.purpose ?? opts.text, 'locked'),
  } as any);
}
