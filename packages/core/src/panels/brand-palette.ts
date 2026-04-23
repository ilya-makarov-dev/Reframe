// Brand-palette panel — reference implementation of a skill-composed
// agent-operable UI. Same INode primitives that render user designs
// render this panel. Every mutation (click on swatch, edit hex, drag
// slider) is a declarative gesture binding, not imperative JS. The
// Platform shell's gesture delegator reads data-gesture-* attrs and
// dispatches to MCP tools.
//
// This file is the test case for the whole "UI = agent + INode =
// universal substrate" thesis. If we can build a useful palette editor
// with ZERO imperative code, the thesis holds at the primitive level.
// If not, we learn which primitive is missing.

import { SceneGraph } from '../engine/scene-graph';
import type { SceneNode, AgentGesture, NodeIntent } from '../engine/types';

export interface PaletteEntry {
  /** Token name — `color.primary`, `color.background`, etc. */
  tokenName: string;
  /** Current hex value. */
  hex: string;
  /** Human label shown above the swatch. */
  label: string;
}

export interface BrandPaletteOptions {
  /** Brand slug this panel edits. Used in gesture args. */
  brandSlug: string;
  /** Entries to render. Order preserved. */
  entries: PaletteEntry[];
  /** Panel width in px. Default 320 (right-panel size). */
  width?: number;
}

/**
 * Compose a brand-palette panel as a SceneGraph. The returned graph is
 * ready for `ensureSceneLayout` + `exportHtml`. Every interactive
 * element carries an `onClick` or `onInput` gesture binding.
 *
 * Structure:
 *   panel (root, mountSlot: right-panel)
 *     ├─ header
 *     │   ├─ title "Brand palette"
 *     │   └─ close-button  (onClick → unmount)
 *     └─ swatches-grid
 *         ├─ swatch:0 (intent: token-swatch)
 *         │   ├─ color-preview (onClick → pick color; fill = hex)
 *         │   ├─ label (token name)
 *         │   └─ hex-input (onInput → setToken)
 *         └─ ... (repeat per entry)
 */
export function composeBrandPalettePanel(opts: BrandPaletteOptions): SceneGraph {
  const width = opts.width ?? 320;
  const graph = new SceneGraph();
  const root = graph.getNode(graph.rootId);
  if (!root) throw new Error('SceneGraph root missing');

  // Root panel frame.
  graph.updateNode(root.id, {
    name: 'brand-palette-panel',
    type: 'FRAME' as any,
    width,
    height: 24 + opts.entries.length * 72 + 32, // header + rows + padding
    fills: [{ type: 'SOLID', color: { r: 0.066, g: 0.066, b: 0.078, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    layoutMode: 'VERTICAL',
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    itemSpacing: 12,
    mountSlot: { name: 'right-panel', accepts: ['inspector', 'brand-calibration'] },
    intent: intentOf('brand-palette/panel', 'Full palette editor for active brand', 'both'),
  } as any);

  // ── Header (title + close) ──────────────────────
  const header = graph.createNode('FRAME' as any, root.id, {
    name: 'header',
    width: width - 32,
    height: 28,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'SPACE_BETWEEN' as any,
    counterAxisAlign: 'CENTER' as any,
    intent: intentOf('brand-palette/header', 'Panel header', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, header.id, {
    name: 'title',
    text: 'Brand palette',
    fontSize: 14,
    fontFamily: 'Inter',
    fontWeight: 600,
    width: 160,
    height: 20,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-palette/title', 'Panel title', 'locked'),
  } as any);

  graph.createNode('FRAME' as any, header.id, {
    name: 'close-button',
    width: 24,
    height: 24,
    cornerRadius: 6,
    fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.14, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('reframe_ui', { action: 'unmount', panel: 'brand-palette' }, 'local-state'),
    keybinding: { combo: 'escape', tool: 'reframe_ui', args: { action: 'unmount', panel: 'brand-palette' } },
    intent: intentOf('brand-palette/close', 'Dismiss the panel', 'both'),
  } as any);

  // ── Swatches ───────────────────────────────────
  for (let i = 0; i < opts.entries.length; i++) {
    const entry = opts.entries[i];
    composeSwatch(graph, root.id, entry, i, width - 32, opts.brandSlug);
  }

  return graph;
}

function composeSwatch(
  graph: SceneGraph,
  parentId: string,
  entry: PaletteEntry,
  index: number,
  width: number,
  brandSlug: string,
): SceneNode {
  const row = graph.createNode('FRAME' as any, parentId, {
    name: entry.label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || `swatch-${index}`,
    width,
    height: 60,
    fills: [],
    layoutMode: 'HORIZONTAL',
    counterAxisAlign: 'CENTER' as any,
    itemSpacing: 12,
    intent: intentOf('brand-palette/swatch', `Edit ${entry.tokenName}`, 'both', 'ready'),
  } as any);

  // Color preview — click picks color, visualizes current hex.
  graph.createNode('FRAME' as any, row.id, {
    name: 'color-preview',
    width: 60,
    height: 60,
    cornerRadius: 10,
    fills: [{ type: 'SOLID', color: hexToRgba(entry.hex), visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('reframe_ui', {
      action: 'pickColor',
      target: '{path}',
      current: entry.hex,
    }, 'optimistic-ui'),
    intent: intentOf('brand-palette/color-preview', `Open color picker for ${entry.tokenName}`, 'both'),
  } as any);

  // Labels + hex input column.
  const labels = graph.createNode('FRAME' as any, row.id, {
    name: 'labels',
    width: width - 72 - 12,
    height: 60,
    fills: [],
    layoutMode: 'VERTICAL',
    itemSpacing: 4,
    intent: intentOf('brand-palette/labels', 'Label + editable hex', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, labels.id, {
    name: 'label',
    text: entry.label,
    fontSize: 13,
    fontFamily: 'Inter',
    fontWeight: 500,
    width: width - 72 - 12,
    height: 18,
    fills: [{ type: 'SOLID', color: { r: 0.76, g: 0.76, b: 0.78, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-palette/swatch-label', entry.tokenName, 'locked'),
  } as any);

  graph.createNode('TEXT' as any, labels.id, {
    name: 'hex-input',
    text: entry.hex,
    fontSize: 12,
    fontFamily: 'JetBrains Mono',
    fontWeight: 400,
    width: width - 72 - 12,
    height: 18,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    semanticRole: 'input',
    focusable: true,
    onInput: gesture('reframe_edit', {
      op: 'setToken',
      brand: brandSlug,
      name: entry.tokenName,
      value: '{value}',
    }, 'local-state'),
    intent: intentOf('brand-palette/hex-input', `Type hex for ${entry.tokenName}`, 'both'),
  } as any);

  return row;
}

// ─── Helpers ─────────────────────────────────────────────────────

function intentOf(
  role: string,
  purpose: string,
  editableBy: NodeIntent['editableBy'],
  agentState?: NodeIntent['agentState'],
): NodeIntent {
  return { role, purpose, editableBy, ...(agentState ? { agentState } : {}) };
}

function gesture(
  tool: string,
  args: Record<string, unknown>,
  fastPath?: AgentGesture['fastPath'],
): AgentGesture {
  return fastPath ? { tool, args, fastPath } : { tool, args };
}

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return { r, g, b, a: 1 };
}
