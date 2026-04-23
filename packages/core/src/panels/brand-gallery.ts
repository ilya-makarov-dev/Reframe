// Brand-gallery panel — first FULL self-host candidate. The
// `/platform/design-system` page is rendered entirely by this composer
// (no hand-written HTML, no legacy crutches). Visualizes the currently
// active brand's palette, typography hierarchy, and radius scale —
// with a working export-to-DTCG button wired through a client-side
// browser.download pseudo-gesture.
//
// This is the flag that proves "reframe делает сам себя": an actual
// Platform UI page, shipping to production, composed through the same
// INode pipeline that renders user designs. Every pixel you see on
// /platform/design-system goes through exportToHtml. No shortcuts.
//
// Scope note: panel is READ-mostly by intent — the single interactive
// affordance (export button) uses a browser.* pseudo-tool handled in
// the client runtime dispatcher, not an MCP-routed mutation. Token
// edits happen elsewhere (brand-palette panel) and propagate here via
// the meta.tokenBindings → CSS var path, so this gallery live-repaints
// whenever a token:changed SSE event fires.

import { SceneGraph } from '../engine/scene-graph';
import type { AgentGesture, NodeIntent } from '../engine/types';

export interface GalleryColorEntry {
  role: string;
  hex: string;
}

export interface GalleryTypographyEntry {
  role: string;
  fontSize: number;
  fontWeight: number;
  fontFamily?: string;
}

export interface BrandGalleryOptions {
  /** Active brand label — shown in the lead paragraph. Optional; when
   *  absent the panel shows a no-brand CTA prompting reframe_design extract. */
  brand?: string;
  /** Brand slug used in the export gesture URL (`/api/tokens/<slug>?format=dtcg`). */
  brandSlug?: string;
  /** Color tokens. When empty the colors section renders a "no tokens" line. */
  colors?: GalleryColorEntry[];
  /** Typography hierarchy. Each row renders as a baseline-aligned sample. */
  typography?: GalleryTypographyEntry[];
  primaryFont?: string;
  secondaryFont?: string;
  /** Radius scale in px. Each value renders as a chip preview. */
  radiusScale?: number[];
  /** Page content width. Default 1100px — matches typical Platform UI
   *  .page max-width. */
  width?: number;
}

const DARK = { r: 0.066, g: 0.066, b: 0.078, a: 1 };
const SURFACE = { r: 0.086, g: 0.086, b: 0.102, a: 1 };
const SURFACE_ELEV = { r: 0.109, g: 0.109, b: 0.129, a: 1 };
const BORDER = { r: 0.172, g: 0.172, b: 0.204, a: 1 };
const TEXT_PRIMARY = { r: 0.98, g: 0.98, b: 0.98, a: 1 };
const TEXT_SECONDARY = { r: 0.72, g: 0.72, b: 0.76, a: 1 };
const TEXT_TERTIARY = { r: 0.52, g: 0.52, b: 0.56, a: 1 };
const ACCENT = { r: 0.388, g: 0.357, b: 1.0, a: 1 };

/**
 * Compose the full design-system page as a SceneGraph. Ready for
 * ensureSceneLayout + exportToHtml. With a DesignSystem passed to the
 * exporter (panels.ts does this), every color swatch emits
 * `background: var(--color-<role>)` — so a token:changed SSE patches
 * the gallery live without recompile.
 */
export function composeBrandGalleryPanel(opts: BrandGalleryOptions): SceneGraph {
  const width = opts.width ?? 1100;
  const graph = new SceneGraph();
  const root = graph.getNode(graph.rootId);
  if (!root) throw new Error('SceneGraph root missing');

  graph.updateNode(root.id, {
    name: 'brand-gallery',
    type: 'FRAME' as any,
    width,
    fills: [{ type: 'SOLID', color: DARK, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    paddingTop: 40,
    paddingBottom: 40,
    paddingLeft: 40,
    paddingRight: 40,
    itemSpacing: 32,
    intent: intentOf('brand-gallery/root', 'Active brand visualization + export', 'both'),
  } as any);

  composeHeader(graph, root.id, width - 80, opts);
  composeColors(graph, root.id, width - 80, opts.colors ?? []);
  composeTypography(graph, root.id, width - 80, opts);
  composeRadius(graph, root.id, width - 80, opts.radiusScale ?? []);

  return graph;
}

// ─── Header (title + lead + export) ──────────────────────────────

function composeHeader(graph: SceneGraph, parentId: string, width: number, opts: BrandGalleryOptions): void {
  const header = graph.createNode('FRAME' as any, parentId, {
    name: 'header',
    width,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 12,
    intent: intentOf('brand-gallery/header', 'Page title + brand lead + export button', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, header.id, {
    name: 'title',
    text: 'Design system',
    fontSize: 32,
    fontFamily: opts.primaryFont ?? 'Inter',
    fontWeight: 600,
    width,
    height: 40,
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/title', 'Page title', 'locked'),
  } as any);

  const leadText = opts.brand
    ? `Active brand: ${opts.brand}. Token edits propagate to every scene via SSE.`
    : 'No brand loaded. Run reframe_design action=extract to load one.';
  graph.createNode('TEXT' as any, header.id, {
    name: 'lead',
    text: leadText,
    fontSize: 14,
    fontFamily: opts.primaryFont ?? 'Inter',
    fontWeight: 400,
    width,
    height: 22,
    fills: [{ type: 'SOLID', color: TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/lead', 'Brand lead / no-brand CTA', 'locked'),
  } as any);

  if (opts.brandSlug) {
    const actions = graph.createNode('FRAME' as any, header.id, {
      name: 'actions',
      width,
      height: 56,
      fills: [],
      layoutMode: 'HORIZONTAL',
      itemSpacing: 12,
      paddingTop: 12,
      intent: intentOf('brand-gallery/actions', 'Page-level actions row', 'locked'),
    } as any);

    // Export DTCG — client-side browser.download pseudo-gesture. Dispatcher
    // in 055-agent-runtime.js catches browser.* tools and handles locally
    // (no MCP roundtrip, no server state mutation — just trigger
    // `<a href="/api/tokens/<slug>?format=dtcg" download>` click).
    const exportBtn = graph.createNode('FRAME' as any, actions.id, {
      name: 'export-dtcg',
      width: 220,
      height: 44,
      cornerRadius: 8,
      fills: [{ type: 'SOLID', color: SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      strokes: [{ type: 'SOLID', color: BORDER, visible: true, opacity: 1 } as any],
      borderTopWeight: 1,
      borderRightWeight: 1,
      borderBottomWeight: 1,
      borderLeftWeight: 1,
      layoutMode: 'HORIZONTAL',
      primaryAxisAlign: 'CENTER' as any,
      counterAxisAlign: 'CENTER' as any,
      paddingLeft: 16,
      paddingRight: 16,
      semanticRole: 'button',
      focusable: true,
      onClick: gesture('browser.download', {
        url: `/api/tokens/${opts.brandSlug}?format=dtcg`,
        filename: `${opts.brandSlug}.tokens.json`,
      }, 'local-state'),
      intent: intentOf('brand-gallery/export-dtcg', 'Download brand as DTCG tokens.json', 'both'),
    } as any);
    graph.createNode('TEXT' as any, exportBtn.id, {
      name: 'export-label',
      text: 'Export DTCG .tokens.json',
      fontSize: 13,
      fontFamily: opts.primaryFont ?? 'Inter',
      fontWeight: 500,
      width: 188,
      height: 20,
      fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('brand-gallery/export-label', 'Export button label', 'locked'),
    } as any);
  }
}

// ─── Colors section ───────────────────────────────────────────────

function composeColors(graph: SceneGraph, parentId: string, width: number, colors: GalleryColorEntry[]): void {
  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'colors',
    width,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 16,
    intent: intentOf('brand-gallery/colors-section', 'Color tokens', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, section.id, {
    name: 'colors-title',
    text: colors.length > 0 ? `Colors · ${colors.length}` : 'Colors',
    fontSize: 18,
    fontFamily: 'Inter',
    fontWeight: 600,
    width,
    height: 26,
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/section-title', 'Colors section title', 'locked'),
  } as any);

  if (colors.length === 0) {
    graph.createNode('TEXT' as any, section.id, {
      name: 'colors-empty',
      text: 'No color tokens.',
      fontSize: 13,
      fontFamily: 'Inter',
      fontWeight: 400,
      width,
      height: 20,
      fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('brand-gallery/empty-state', 'Colors empty state', 'locked'),
    } as any);
    return;
  }

  const grid = graph.createNode('FRAME' as any, section.id, {
    name: 'swatch-grid',
    width,
    fills: [],
    layoutMode: 'HORIZONTAL',
    layoutWrap: 'WRAP' as any,
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    itemSpacing: 16,
    counterAxisSpacing: 16,
    intent: intentOf('brand-gallery/swatch-grid', 'Color swatch grid', 'locked'),
  } as any);

  for (const color of colors) {
    composeSwatch(graph, grid.id, color);
  }
}

function composeSwatch(graph: SceneGraph, parentId: string, entry: GalleryColorEntry): void {
  const swatch = graph.createNode('FRAME' as any, parentId, {
    name: entry.role || 'swatch',
    width: 160,
    height: 140,
    cornerRadius: 10,
    fills: [{ type: 'SOLID', color: SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    strokes: [{ type: 'SOLID', color: BORDER, visible: true, opacity: 1 } as any],
    borderTopWeight: 1,
    borderRightWeight: 1,
    borderBottomWeight: 1,
    borderLeftWeight: 1,
    layoutMode: 'VERTICAL',
    paddingTop: 12,
    paddingBottom: 12,
    paddingLeft: 12,
    paddingRight: 12,
    itemSpacing: 8,
    clipsContent: true,
    intent: intentOf('brand-gallery/swatch', `Swatch for ${entry.role}`, 'locked'),
  } as any);

  // Chip — tokenBindings.fill role makes it `background: var(--color-<role>)`.
  // Token:changed SSE → CSS var patch → chip repaints live.
  graph.createNode('FRAME' as any, swatch.id, {
    name: 'chip',
    width: 136,
    height: 64,
    cornerRadius: 6,
    fills: [{ type: 'SOLID', color: hexToRgba(entry.hex), visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/swatch-chip', `Color chip for ${entry.role}`, 'locked'),
    meta: { tokenBindings: { fill: entry.role } },
  } as any);

  graph.createNode('TEXT' as any, swatch.id, {
    name: 'swatch-label',
    text: entry.role,
    fontSize: 13,
    fontFamily: 'Inter',
    fontWeight: 500,
    width: 136,
    height: 18,
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/swatch-label', entry.role, 'locked'),
  } as any);

  graph.createNode('TEXT' as any, swatch.id, {
    name: 'swatch-hex',
    text: entry.hex,
    fontSize: 11,
    fontFamily: 'JetBrains Mono',
    fontWeight: 400,
    width: 136,
    height: 14,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/swatch-hex', `Hex value ${entry.hex}`, 'locked'),
  } as any);
}

// ─── Typography section ───────────────────────────────────────────

function composeTypography(graph: SceneGraph, parentId: string, width: number, opts: BrandGalleryOptions): void {
  const hier = opts.typography ?? [];
  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'typography',
    width,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 16,
    intent: intentOf('brand-gallery/typography-section', 'Typography hierarchy', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, section.id, {
    name: 'typography-title',
    text: 'Typography',
    fontSize: 18,
    fontFamily: 'Inter',
    fontWeight: 600,
    width,
    height: 26,
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/section-title', 'Typography section title', 'locked'),
  } as any);

  if (opts.primaryFont || opts.secondaryFont) {
    const meta = graph.createNode('FRAME' as any, section.id, {
      name: 'typography-meta',
      width,
      fills: [],
      layoutMode: 'VERTICAL',
      itemSpacing: 4,
      intent: intentOf('brand-gallery/typography-meta', 'Font-family summary', 'locked'),
    } as any);
    if (opts.primaryFont) {
      graph.createNode('TEXT' as any, meta.id, {
        name: 'primary-font',
        text: `Primary: ${opts.primaryFont}`,
        fontSize: 13,
        fontFamily: 'Inter',
        fontWeight: 400,
        width,
        height: 18,
        fills: [{ type: 'SOLID', color: TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
        intent: intentOf('brand-gallery/primary-font', opts.primaryFont, 'locked'),
      } as any);
    }
    if (opts.secondaryFont) {
      graph.createNode('TEXT' as any, meta.id, {
        name: 'secondary-font',
        text: `Secondary: ${opts.secondaryFont}`,
        fontSize: 13,
        fontFamily: 'Inter',
        fontWeight: 400,
        width,
        height: 18,
        fills: [{ type: 'SOLID', color: TEXT_SECONDARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
        intent: intentOf('brand-gallery/secondary-font', opts.secondaryFont, 'locked'),
      } as any);
    }
  }

  if (hier.length === 0) {
    graph.createNode('TEXT' as any, section.id, {
      name: 'typography-empty',
      text: 'No typography tokens.',
      fontSize: 13,
      fontFamily: 'Inter',
      fontWeight: 400,
      width,
      height: 20,
      fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
      intent: intentOf('brand-gallery/empty-state', 'Typography empty state', 'locked'),
    } as any);
    return;
  }

  const list = graph.createNode('FRAME' as any, section.id, {
    name: 'hierarchy-list',
    width,
    cornerRadius: 8,
    fills: [{ type: 'SOLID', color: SURFACE, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    strokes: [{ type: 'SOLID', color: BORDER, visible: true, opacity: 1 } as any],
    borderTopWeight: 1,
    borderRightWeight: 1,
    borderBottomWeight: 1,
    borderLeftWeight: 1,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 0,
    clipsContent: true,
    intent: intentOf('brand-gallery/hierarchy-list', 'Typography hierarchy list', 'locked'),
  } as any);

  for (let i = 0; i < hier.length; i++) {
    composeTypographyRow(graph, list.id, hier[i], width, opts.primaryFont, i < hier.length - 1);
  }
}

function composeTypographyRow(
  graph: SceneGraph,
  parentId: string,
  row: GalleryTypographyEntry,
  width: number,
  primaryFont: string | undefined,
  withSeparator: boolean,
): void {
  const rowNode = graph.createNode('FRAME' as any, parentId, {
    name: row.role,
    width,
    fills: [{ type: 'SOLID', color: SURFACE_ELEV, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    layoutMode: 'HORIZONTAL',
    counterAxisAlign: 'CENTER' as any,
    paddingTop: 18,
    paddingBottom: 18,
    paddingLeft: 20,
    paddingRight: 20,
    itemSpacing: 16,
    strokes: withSeparator ? [{ type: 'SOLID', color: BORDER, visible: true, opacity: 1 } as any] : [],
    borderBottomWeight: withSeparator ? 1 : 0,
    intent: intentOf('brand-gallery/type-row', `${row.role} — ${row.fontSize}/${row.fontWeight}`, 'locked'),
  } as any);

  const sampleText = row.role.charAt(0).toUpperCase() + row.role.slice(1);
  graph.createNode('TEXT' as any, rowNode.id, {
    name: 'sample',
    text: sampleText,
    fontSize: Math.min(row.fontSize, 72),
    fontFamily: row.fontFamily || primaryFont || 'Inter',
    fontWeight: row.fontWeight,
    width: Math.max(200, width * 0.6),
    height: Math.ceil(row.fontSize * 1.3),
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/type-sample', `${row.role} sample`, 'locked'),
  } as any);

  graph.createNode('TEXT' as any, rowNode.id, {
    name: 'type-spec',
    text: `${row.fontSize}px · ${row.fontWeight}`,
    fontSize: 11,
    fontFamily: 'JetBrains Mono',
    fontWeight: 400,
    width: 120,
    height: 16,
    textAlignHorizontal: 'RIGHT' as any,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/type-spec', `Size/weight caption`, 'locked'),
  } as any);
}

// ─── Radius section ───────────────────────────────────────────────

function composeRadius(graph: SceneGraph, parentId: string, width: number, scale: number[]): void {
  if (scale.length === 0) return;

  const section = graph.createNode('FRAME' as any, parentId, {
    name: 'radius',
    width,
    fills: [],
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    itemSpacing: 16,
    intent: intentOf('brand-gallery/radius-section', 'Border radius scale', 'locked'),
  } as any);

  graph.createNode('TEXT' as any, section.id, {
    name: 'radius-title',
    text: 'Border radius scale',
    fontSize: 18,
    fontFamily: 'Inter',
    fontWeight: 600,
    width,
    height: 26,
    fills: [{ type: 'SOLID', color: TEXT_PRIMARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/section-title', 'Radius section title', 'locked'),
  } as any);

  const row = graph.createNode('FRAME' as any, section.id, {
    name: 'radius-row',
    width,
    fills: [],
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    itemSpacing: 20,
    layoutWrap: 'WRAP' as any,
    counterAxisSpacing: 20,
    intent: intentOf('brand-gallery/radius-row', 'Radius scale preview row', 'locked'),
  } as any);

  for (let i = 0; i < scale.length; i++) {
    composeRadiusChip(graph, row.id, i, scale[i]);
  }
}

function composeRadiusChip(graph: SceneGraph, parentId: string, index: number, r: number): void {
  const cell = graph.createNode('FRAME' as any, parentId, {
    name: `radius-${index}`,
    width: 72,
    height: 92,
    fills: [],
    layoutMode: 'VERTICAL',
    counterAxisAlign: 'CENTER' as any,
    itemSpacing: 8,
    intent: intentOf('brand-gallery/radius-cell', `Radius ${index} · ${r}px`, 'locked'),
  } as any);

  graph.createNode('FRAME' as any, cell.id, {
    name: 'radius-chip',
    width: 56,
    height: 56,
    cornerRadius: r,
    fills: [{ type: 'SOLID', color: ACCENT, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/radius-chip', `${r}px corner radius preview`, 'locked'),
  } as any);

  graph.createNode('TEXT' as any, cell.id, {
    name: 'radius-caption',
    text: `${index}: ${r}px`,
    fontSize: 11,
    fontFamily: 'JetBrains Mono',
    fontWeight: 400,
    width: 72,
    height: 14,
    textAlignHorizontal: 'CENTER' as any,
    fills: [{ type: 'SOLID', color: TEXT_TERTIARY, visible: true, opacity: 1, blendMode: 'NORMAL' } as any],
    intent: intentOf('brand-gallery/radius-caption', `index ${index}`, 'locked'),
  } as any);
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
