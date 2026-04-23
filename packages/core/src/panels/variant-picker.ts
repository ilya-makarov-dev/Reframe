// Variant-picker panel — second skill-panel, proves the INode+gesture
// pattern generalizes beyond table-shaped UI (brand-palette).
//
// Shows N variants of a target section as clickable cards. Clicking a
// card dispatches a configurable MCP-tool gesture (typically
// reframe_edit vary/apply) that mutates the live scene through the
// agent-runtime HTTP bridge. No imperative UI code — the panel is pure
// INode with Block A gestures.
//
// Unlike brand-palette (every row same shape), variant-picker has
// heterogeneous cards: each variant carries its own label, color-strip
// preview, and gesture payload. This shape stresses (a) semantic-path
// disambiguation across many same-named cards, (b) gesture arg
// substitution with complex payloads, (c) per-card onClick with unique
// args — all things that in a naive architecture would require custom
// per-card JS. Here they're just declarative INode props.

import { SceneGraph } from '../engine/scene-graph';
import type { AgentGesture, NodeIntent, SceneNode } from '../engine/types';

export interface VariantEntry {
  /** Stable id across compositions (used in gesture args). */
  id: string;
  /** Human label shown on the card. */
  label: string;
  /** Up to 5 hex colors for the preview strip — derived from the variant's palette/section fills. */
  colorStrip: string[];
  /** Optional one-line description under the label. */
  description?: string;
  /** Tool + args dispatched when the card is clicked.
   *  Example: { tool: 'reframe_edit', args: { op: 'applyVariant', sceneId, variantId: id } } */
  apply: AgentGesture;
}

export interface VariantPickerOptions {
  /** Scene id the picker targets — surfaced in the header for context. */
  sceneId?: string;
  /** Path of the node inside the scene this picker varies (e.g. "home/hero"). */
  targetPath?: string;
  /** Variants to offer. Order preserved. */
  variants: VariantEntry[];
  /** Panel width in px. Default 320. */
  width?: number;
}

/**
 * Compose a variant-picker panel. Returns a SceneGraph ready for
 * ensureSceneLayout + exportToHtml.
 *
 * Structure:
 *   panel (root, mountSlot: right-panel)
 *     ├─ header (title + optional target path)
 *     ├─ target-info (sceneId + targetPath, read-only)
 *     └─ variants-list
 *         ├─ variant-card:0 (onClick → apply gesture)
 *         │   ├─ color-strip (5 mini color rects)
 *         │   ├─ label
 *         │   └─ description (optional)
 *         └─ ... per variant
 */
export function composeVariantPickerPanel(opts: VariantPickerOptions): SceneGraph {
  const width = opts.width ?? 320;
  const graph = new SceneGraph();
  const root = graph.getNode(graph.rootId);
  if (!root) throw new Error('SceneGraph root missing');

  const cardHeight = 76;
  const headerHeight = 28;
  const targetInfoHeight = opts.targetPath || opts.sceneId ? 40 : 0;

  graph.updateNode(root.id, {
    name: 'variant-picker-panel',
    type: 'FRAME' as any,
    width,
    height: 16 + headerHeight + 12 + targetInfoHeight + (targetInfoHeight ? 12 : 0) + opts.variants.length * (cardHeight + 8) - 8 + 16,
    fills: [{ type: 'SOLID', color: { r: 0.066, g: 0.066, b: 0.078, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    layoutMode: 'VERTICAL',
    paddingTop: 16,
    paddingBottom: 16,
    paddingLeft: 16,
    paddingRight: 16,
    itemSpacing: 12,
    mountSlot: { name: 'right-panel', accepts: ['variant-picker'] },
    intent: intentOf('variant-picker/panel', 'Choose a variant for the selected section', 'both'),
  } as any);

  // ── Header (title + close) ──────────────────────
  const header = graph.createNode('FRAME' as any, root.id, {
    name: 'header',
    width: width - 32,
    height: headerHeight,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisAlign: 'SPACE_BETWEEN' as any,
    counterAxisAlign: 'CENTER' as any,
    intent: intentOf('variant-picker/header', 'Panel header', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, header.id, {
    name: 'title',
    text: 'Pick a variant',
    fontSize: 14,
    fontFamily: 'Inter',
    fontWeight: 600,
    width: 200,
    height: 20,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('variant-picker/title', 'Panel title', 'locked'),
  } as any);

  graph.createNode('FRAME' as any, header.id, {
    name: 'close-button',
    width: 24,
    height: 24,
    cornerRadius: 6,
    fills: [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.14, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    semanticRole: 'button',
    focusable: true,
    onClick: gesture('reframe_ui', { action: 'unmount', panel: 'variant-picker' }, 'local-state'),
    keybinding: { combo: 'escape', tool: 'reframe_ui', args: { action: 'unmount', panel: 'variant-picker' } },
    intent: intentOf('variant-picker/close', 'Dismiss the panel', 'both'),
  } as any);

  // ── Target info (context panel — no interaction) ─
  if (opts.sceneId || opts.targetPath) {
    const info = graph.createNode('FRAME' as any, root.id, {
      name: 'target-info',
      width: width - 32,
      height: targetInfoHeight,
      cornerRadius: 8,
      fills: [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.1, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      paddingTop: 8,
      paddingBottom: 8,
      paddingLeft: 12,
      paddingRight: 12,
      layoutMode: 'VERTICAL',
      itemSpacing: 2,
      intent: intentOf('variant-picker/target-info', 'Which section this picker varies', 'locked'),
    } as any);
    graph.createNode('TEXT' as any, info.id, {
      name: 'target-label',
      text: opts.targetPath ?? 'scene root',
      fontSize: 12,
      fontFamily: 'JetBrains Mono',
      fontWeight: 400,
      width: width - 56,
      height: 14,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('variant-picker/target-path', 'Semantic path of the target', 'locked'),
    } as any);
    if (opts.sceneId) {
      graph.createNode('TEXT' as any, info.id, {
        name: 'target-scene',
        text: `in ${opts.sceneId}`,
        fontSize: 10,
        fontFamily: 'Inter',
        fontWeight: 400,
        width: width - 56,
        height: 12,
        fills: [{ type: 'SOLID', color: { r: 0.52, g: 0.52, b: 0.56, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
        intent: intentOf('variant-picker/target-scene', 'Scene the target belongs to', 'locked'),
      } as any);
    }
  }

  // ── Variant cards ───────────────────────────────
  for (let i = 0; i < opts.variants.length; i++) {
    composeVariantCard(graph, root.id, opts.variants[i], width - 32, cardHeight);
  }

  return graph;
}

function composeVariantCard(
  graph: SceneGraph,
  parentId: string,
  variant: VariantEntry,
  width: number,
  height: number,
): SceneNode {
  // Card — focusable, clickable, whole-card gesture.
  const card = graph.createNode('FRAME' as any, parentId, {
    name: variant.id,
    width,
    height,
    cornerRadius: 10,
    fills: [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.1, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    strokes: [{ type: 'SOLID', color: { r: 0.17, g: 0.17, b: 0.21, a: 1 }, visible: true, opacity: 1 } as any],
    borderTopWeight: 1,
    borderRightWeight: 1,
    borderBottomWeight: 1,
    borderLeftWeight: 1,
    layoutMode: 'VERTICAL',
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 12,
    itemSpacing: 8,
    semanticRole: 'button',
    focusable: true,
    onClick: { ...variant.apply, fastPath: variant.apply.fastPath ?? 'optimistic-ui' },
    intent: intentOf('variant-picker/card', `Apply variant ${variant.id}`, 'both'),
  } as any);

  // Color strip — row of thin colored segments representing the variant's palette.
  if (variant.colorStrip.length > 0) {
    const strip = graph.createNode('FRAME' as any, card.id, {
      name: 'color-strip',
      width: width - 24,
      height: 14,
      cornerRadius: 4,
      fills: [],
      layoutMode: 'HORIZONTAL',
      itemSpacing: 0,
      clipsContent: true,
      intent: intentOf('variant-picker/color-strip', 'Palette preview', 'locked'),
    } as any);
    const segW = Math.max(1, Math.floor((width - 24) / variant.colorStrip.length));
    for (let j = 0; j < variant.colorStrip.length; j++) {
      graph.createNode('FRAME' as any, strip.id, {
        name: `color-${j}`,
        width: segW,
        height: 14,
        fills: [{ type: 'SOLID', color: hexToRgba(variant.colorStrip[j]), visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
        intent: intentOf('variant-picker/color-segment', variant.colorStrip[j], 'locked'),
      } as any);
    }
  }

  // Label.
  graph.createNode('TEXT' as any, card.id, {
    name: 'label',
    text: variant.label,
    fontSize: 13,
    fontFamily: 'Inter',
    fontWeight: 500,
    width: width - 24,
    height: 18,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('variant-picker/card-label', variant.label, 'locked'),
  } as any);

  // Optional description.
  if (variant.description) {
    graph.createNode('TEXT' as any, card.id, {
      name: 'description',
      text: variant.description,
      fontSize: 11,
      fontFamily: 'Inter',
      fontWeight: 400,
      width: width - 24,
      height: 14,
      fills: [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.64, a: 1 }, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('variant-picker/card-description', variant.description, 'locked'),
    } as any);
  }

  return card;
}

// ─── Helpers ─────────────────────────────────────────────────────

function intentOf(
  role: string,
  purpose: string,
  editableBy: NodeIntent['editableBy'],
): NodeIntent {
  return { role, purpose, editableBy };
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
