/**
 * Reframe Standalone Engine — Layout Engine
 *
 * Yoga WASM-based flex & grid layout computation.
 * Provider pattern: Yoga instance is injected, not imported directly.
 *
 * This allows the engine to work with any Yoga build
 * (standard, grid fork, or future versions).
 */

import type { SceneGraph } from './scene-graph';
import type { SceneNode } from './types';

// ─── Yoga Provider Interface ────────────────────────────────────

/**
 * Minimal Yoga API surface used by the layout engine.
 * Consumers inject a real Yoga instance via setYoga().
 */
export interface YogaNode {
  setWidth(w: number): void;
  setHeight(h: number): void;
  setMinWidth(w: number): void;
  setMaxWidth(w: number): void;
  setMinHeight(h: number): void;
  setMaxHeight(h: number): void;
  setFlexDirection(dir: number): void;
  setFlexWrap(wrap: number): void;
  setJustifyContent(justify: number): void;
  setAlignItems(align: number): void;
  setAlignSelf(align: number): void;
  setAlignContent(align: number): void;
  setFlexGrow(grow: number): void;
  setFlexShrink(shrink: number): void;
  setFlexBasis(basis: number): void;
  setDisplay(display: number): void;
  setPositionType(type: number): void;
  setPosition(edge: number, value: number): void;
  setGap(gutter: number, gap: number): void;
  setPadding(edge: number, value: number): void;
  setOverflow(overflow: number): void;
  setMeasureFunc(fn: (width: number, widthMode: number, height: number, heightMode: number) => { width: number; height: number }): void;
  insertChild(child: YogaNode, index: number): void;
  getChildCount(): number;
  getChild(index: number): YogaNode;
  calculateLayout(width?: number, height?: number, direction?: number): void;
  getComputedLeft(): number;
  getComputedTop(): number;
  getComputedWidth(): number;
  getComputedHeight(): number;
  free?(): void;
}

export interface YogaInstance {
  Node: { create(): YogaNode };
  // Constants (numeric enums)
  DIRECTION_LTR: number;
  FLEX_DIRECTION_ROW: number;
  FLEX_DIRECTION_COLUMN: number;
  WRAP_NO_WRAP: number;
  WRAP_WRAP: number;
  JUSTIFY_FLEX_START: number;
  JUSTIFY_CENTER: number;
  JUSTIFY_FLEX_END: number;
  JUSTIFY_SPACE_BETWEEN: number;
  ALIGN_FLEX_START: number;
  ALIGN_CENTER: number;
  ALIGN_FLEX_END: number;
  ALIGN_STRETCH: number;
  ALIGN_BASELINE: number;
  ALIGN_SPACE_BETWEEN: number;
  ALIGN_AUTO: number;
  DISPLAY_FLEX: number;
  DISPLAY_NONE: number;
  POSITION_TYPE_RELATIVE: number;
  POSITION_TYPE_ABSOLUTE: number;
  OVERFLOW_HIDDEN: number;
  OVERFLOW_VISIBLE: number;
  EDGE_TOP: number;
  EDGE_RIGHT: number;
  EDGE_BOTTOM: number;
  EDGE_LEFT: number;
  GUTTER_COLUMN: number;
  GUTTER_ROW: number;
}

// ─── State ──────────────────────────────────────────────────────

let yoga: YogaInstance | null = null;

export function setYoga(instance: YogaInstance): void {
  yoga = instance;
}

export function getYoga(): YogaInstance {
  if (!yoga) throw new Error('[reframe] Yoga not initialized. Call setYoga(instance) first.');
  return yoga;
}

// ─── Text Measurer ──────────────────────────────────────────────

export type TextMeasurer = (
  node: SceneNode,
  maxWidth?: number,
) => { width: number; height: number } | null;

let globalTextMeasurer: TextMeasurer | null = null;

export function setTextMeasurer(measurer: TextMeasurer | null): void {
  globalTextMeasurer = measurer;
}

// Average glyph width ratios for proportional fonts (character width / fontSize).
// Monospace fonts are wider (~0.6), proportional fonts like Inter/Roboto ~0.45-0.5.
const BASE_GLYPH_FACTOR = 0.48;
const BOLD_GLYPH_EXTRA = 0.04; // bold text ~8% wider

function estimateTextSize(
  node: SceneNode,
  maxWidth?: number,
): { width: number; height: number } {
  const fontSize = node.fontSize || 16;
  const weight = node.fontWeight ?? 400;
  const glyphFactor = BASE_GLYPH_FACTOR + (weight >= 600 ? BOLD_GLYPH_EXTRA : 0);
  const charWidth = fontSize * glyphFactor;
  const textLength = (node.text || '').length;
  const naturalWidth = textLength * charWidth;

  const constrainedWidth = maxWidth && maxWidth < 1e5 ? maxWidth : naturalWidth;
  const lines = constrainedWidth > 0 ? Math.ceil(naturalWidth / constrainedWidth) : 1;
  const lineHeight = node.lineHeight ?? fontSize * 1.4;

  return {
    width: Math.min(naturalWidth, constrainedWidth),
    height: lines * lineHeight,
  };
}

// ─── Alignment Mapping ──────────────────────────────────────────

function mapJustify(y: YogaInstance, align: string): number {
  switch (align) {
    case 'CENTER': return y.JUSTIFY_CENTER;
    case 'MAX': return y.JUSTIFY_FLEX_END;
    case 'SPACE_BETWEEN': return y.JUSTIFY_SPACE_BETWEEN;
    default: return y.JUSTIFY_FLEX_START;
  }
}

function mapAlign(y: YogaInstance, align: string): number {
  switch (align) {
    case 'CENTER': return y.ALIGN_CENTER;
    case 'MAX': return y.ALIGN_FLEX_END;
    case 'STRETCH': return y.ALIGN_STRETCH;
    case 'BASELINE': return y.ALIGN_BASELINE;
    default: return y.ALIGN_FLEX_START;
  }
}

function mapAlignSelf(y: YogaInstance, alignSelf: string): number | null {
  switch (alignSelf) {
    case 'AUTO': return null;
    case 'MIN': return y.ALIGN_FLEX_START;
    case 'CENTER': return y.ALIGN_CENTER;
    case 'MAX': return y.ALIGN_FLEX_END;
    case 'STRETCH': return y.ALIGN_STRETCH;
    case 'BASELINE': return y.ALIGN_BASELINE;
    default: return null;
  }
}

// ─── Min/Max Constraints ────────────────────────────────────────

function applyMinMaxConstraints(yogaNode: YogaNode, node: SceneNode): void {
  if (node.minWidth != null) yogaNode.setMinWidth(node.minWidth);
  if (node.maxWidth != null) yogaNode.setMaxWidth(node.maxWidth);
  if (node.minHeight != null) yogaNode.setMinHeight(node.minHeight);
  if (node.maxHeight != null) yogaNode.setMaxHeight(node.maxHeight);
}

// ─── Flex Container Configuration ───────────────────────────────

function configureFlexContainer(y: YogaInstance, yogaNode: YogaNode, node: SceneNode): void {
  const isRow = node.layoutMode === 'HORIZONTAL';

  yogaNode.setFlexDirection(isRow ? y.FLEX_DIRECTION_ROW : y.FLEX_DIRECTION_COLUMN);
  yogaNode.setFlexWrap(node.layoutWrap === 'WRAP' ? y.WRAP_WRAP : y.WRAP_NO_WRAP);
  yogaNode.setJustifyContent(mapJustify(y, node.primaryAxisAlign));
  yogaNode.setAlignItems(mapAlign(y, node.counterAxisAlign));

  if (node.clipsContent) {
    yogaNode.setOverflow(y.OVERFLOW_HIDDEN);
  }

  // Padding
  yogaNode.setPadding(y.EDGE_TOP, node.paddingTop);
  yogaNode.setPadding(y.EDGE_RIGHT, node.paddingRight);
  yogaNode.setPadding(y.EDGE_BOTTOM, node.paddingBottom);
  yogaNode.setPadding(y.EDGE_LEFT, node.paddingLeft);

  // Gaps (context-sensitive)
  const colGap = isRow ? node.itemSpacing : (node.counterAxisSpacing || 0);
  const rowGap = isRow ? (node.counterAxisSpacing || 0) : node.itemSpacing;
  yogaNode.setGap(y.GUTTER_COLUMN, colGap);
  yogaNode.setGap(y.GUTTER_ROW, rowGap);

  // Align content for wrapping
  if (node.layoutWrap === 'WRAP' && node.counterAxisAlignContent === 'SPACE_BETWEEN') {
    yogaNode.setAlignContent(y.ALIGN_SPACE_BETWEEN);
  }

  applyMinMaxConstraints(yogaNode, node);
}

// ─── Child Configuration ────────────────────────────────────────

function configureAbsoluteChild(y: YogaInstance, yogaChild: YogaNode, child: SceneNode): void {
  yogaChild.setPositionType(y.POSITION_TYPE_ABSOLUTE);
  yogaChild.setPosition(y.EDGE_LEFT, child.x);
  yogaChild.setPosition(y.EDGE_TOP, child.y);
  yogaChild.setWidth(child.width);
  yogaChild.setHeight(child.height);
}

function configureLeaf(
  y: YogaInstance,
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
): void {
  const isRow = parent.layoutMode === 'HORIZONTAL';
  const stretchCross = parent.counterAxisAlign === 'STRETCH'
    && child.layoutAlignSelf === 'AUTO';

  // Text with measurer
  if (child.type === 'TEXT' && (globalTextMeasurer || child.textAutoResize !== 'NONE')) {
    const measurer = globalTextMeasurer;
    const measureCache = new Map<number, { width: number; height: number }>();

    if (child.textAutoResize === 'WIDTH_AND_HEIGHT') {
      // No fixed dimension — measure at any width
      yogaChild.setMeasureFunc((width, widthMode) => {
        const cacheKey = widthMode === 0 /* Undefined */ ? -1 : Math.round(width);
        const cached = measureCache.get(cacheKey);
        if (cached) return cached;
        const result = measurer
          ? measurer(child, cacheKey === -1 ? undefined : width)
          : estimateTextSize(child, cacheKey === -1 ? undefined : width);
        const size = result ?? estimateTextSize(child, cacheKey === -1 ? undefined : width);
        measureCache.set(cacheKey, size);
        return size;
      });
    } else if (child.textAutoResize === 'HEIGHT') {
      // Fixed width, measure height
      if (!stretchCross && isRow) {
        yogaChild.setWidth(child.width);
      }
      yogaChild.setMeasureFunc((width) => {
        const w = Math.round(width);
        const cached = measureCache.get(w);
        if (cached) return cached;
        const result = measurer
          ? measurer(child, w)
          : estimateTextSize(child, w);
        const size = result ?? estimateTextSize(child, w);
        measureCache.set(w, size);
        return size;
      });
    } else {
      yogaChild.setWidth(child.width);
      yogaChild.setHeight(child.height);
    }

    if (child.layoutGrow > 0) {
      yogaChild.setFlexGrow(child.layoutGrow);
      yogaChild.setFlexShrink(1);
      yogaChild.setFlexBasis(0);
    }

    return;
  }

  // Non-text leaf
  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow);
    yogaChild.setFlexShrink(1);
    yogaChild.setFlexBasis(0);
    // Set non-grow dimension
    if (isRow) yogaChild.setHeight(child.height);
    else yogaChild.setWidth(child.width);
  } else {
    if (!stretchCross || isRow) yogaChild.setWidth(child.width);
    if (!stretchCross || !isRow) yogaChild.setHeight(child.height);
  }
}

// ─── Build Yoga Tree ────────────────────────────────────────────

function buildYogaTree(
  y: YogaInstance,
  graph: SceneGraph,
  frame: SceneNode,
): YogaNode {
  const root = y.Node.create();
  const isRow = frame.layoutMode === 'HORIZONTAL';

  // Root sizing
  if (frame.primaryAxisSizing === 'FIXED') {
    if (isRow) root.setWidth(frame.width);
    else root.setHeight(frame.height);
  }
  if (frame.counterAxisSizing === 'FIXED') {
    if (isRow) root.setHeight(frame.height);
    else root.setWidth(frame.width);
  }

  configureFlexContainer(y, root, frame);

  // Process children
  const children = graph.getChildren(frame.id);
  let yogaIndex = 0;

  for (const child of children) {
    const yogaChild = y.Node.create();

    if (child.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(y, yogaChild, child);
    } else if (!child.visible) {
      yogaChild.setDisplay(y.DISPLAY_NONE);
    } else if (child.layoutMode !== 'NONE') {
      // Nested auto-layout
      configureNestedAutoLayout(y, graph, yogaChild, child, frame);
    } else {
      configureLeaf(y, yogaChild, child, frame);
    }

    // Align self override
    const selfAlign = mapAlignSelf(y, child.layoutAlignSelf);
    if (selfAlign != null) {
      yogaChild.setAlignSelf(selfAlign);
    }

    root.insertChild(yogaChild, yogaIndex++);
  }

  return root;
}

function configureNestedAutoLayout(
  y: YogaInstance,
  graph: SceneGraph,
  yogaChild: YogaNode,
  child: SceneNode,
  parent: SceneNode,
): void {
  const isParentRow = parent.layoutMode === 'HORIZONTAL';
  const isChildRow = child.layoutMode === 'HORIZONTAL';

  // Determine sizing axes relative to parent
  const mainSizing = isParentRow === isChildRow
    ? child.primaryAxisSizing
    : child.counterAxisSizing;
  const crossSizing = isParentRow === isChildRow
    ? child.counterAxisSizing
    : child.primaryAxisSizing;

  // Main axis
  if (child.layoutGrow > 0) {
    yogaChild.setFlexGrow(child.layoutGrow);
    yogaChild.setFlexShrink(1);
    yogaChild.setFlexBasis(0);
  } else if (mainSizing === 'FIXED') {
    if (isParentRow) yogaChild.setWidth(child.width);
    else yogaChild.setHeight(child.height);
  } else if (mainSizing === 'FILL') {
    yogaChild.setFlexGrow(1);
    yogaChild.setFlexShrink(1);
    yogaChild.setFlexBasis(0);
  }
  // HUG: no constraints (auto)

  // Cross axis
  if (crossSizing === 'FIXED') {
    if (isParentRow) yogaChild.setHeight(child.height);
    else yogaChild.setWidth(child.width);
  } else if (crossSizing === 'FILL') {
    yogaChild.setAlignSelf(y.ALIGN_STRETCH);
  }

  // Configure as flex container itself
  configureFlexContainer(y, yogaChild, child);

  // Recursively add grandchildren
  const grandchildren = graph.getChildren(child.id);
  let idx = 0;

  for (const grandchild of grandchildren) {
    const yogaGrandchild = y.Node.create();

    if (grandchild.layoutPositioning === 'ABSOLUTE') {
      configureAbsoluteChild(y, yogaGrandchild, grandchild);
    } else if (!grandchild.visible) {
      yogaGrandchild.setDisplay(y.DISPLAY_NONE);
    } else if (grandchild.layoutMode !== 'NONE') {
      configureNestedAutoLayout(y, graph, yogaGrandchild, grandchild, child);
    } else {
      configureLeaf(y, yogaGrandchild, grandchild, child);
    }

    const selfAlign = mapAlignSelf(y, grandchild.layoutAlignSelf);
    if (selfAlign != null) {
      yogaGrandchild.setAlignSelf(selfAlign);
    }

    yogaChild.insertChild(yogaGrandchild, idx++);
  }

  applyMinMaxConstraints(yogaChild, child);
}

// ─── Apply Layout Results ───────────────────────────────────────

function applyYogaLayout(
  graph: SceneGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
): void {
  // Apply frame sizing for HUG
  applyFrameSize(graph, frame, yogaNode);

  const children = graph.getChildren(frame.id);
  const count = yogaNode.getChildCount();

  for (let i = 0; i < count && i < children.length; i++) {
    const child = children[i];
    const yogaChild = yogaNode.getChild(i);

    if (child.layoutPositioning === 'ABSOLUTE' || !child.visible) continue;

    const x = yogaChild.getComputedLeft();
    const y = yogaChild.getComputedTop();
    const w = yogaChild.getComputedWidth();
    const h = yogaChild.getComputedHeight();

    graph.updateNode(child.id, { x, y, width: w, height: h });

    // Recursively apply to nested auto-layout children
    if (child.layoutMode !== 'NONE') {
      applyYogaLayout(graph, child, yogaChild);
    }
  }
}

function applyFrameSize(
  graph: SceneGraph,
  frame: SceneNode,
  yogaNode: YogaNode,
): void {
  const isRow = frame.layoutMode === 'HORIZONTAL';
  const changes: Partial<SceneNode> = {};

  if (isRow) {
    if (frame.primaryAxisSizing === 'HUG') changes.width = yogaNode.getComputedWidth();
    if (frame.counterAxisSizing === 'HUG') changes.height = yogaNode.getComputedHeight();
  } else {
    if (frame.primaryAxisSizing === 'HUG') changes.height = yogaNode.getComputedHeight();
    if (frame.counterAxisSizing === 'HUG') changes.width = yogaNode.getComputedWidth();
  }

  if (Object.keys(changes).length > 0) {
    graph.updateNode(frame.id, changes);
  }
}

// ─── Free Yoga Tree ─────────────────────────────────────────────

function freeYogaTree(node: YogaNode): void {
  if (!node) return;
  const count = node.getChildCount();
  for (let i = 0; i < count; i++) {
    const child = node.getChild(i);
    if (child) freeYogaTree(child);
  }
  node.free?.();
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Compute layout for a single frame with layoutMode.
 */
export function computeLayout(graph: SceneGraph, frameId: string): void {
  const frame = graph.getNode(frameId);
  if (!frame || frame.layoutMode === 'NONE') return;

  // Grid layout — compute directly (Yoga doesn't support CSS Grid)
  if (frame.layoutMode === 'GRID') {
    computeGridLayout(graph, frame);
    return;
  }

  if (!yoga) return;

  const y = yoga;
  const yogaRoot = buildYogaTree(y, graph, frame);

  yogaRoot.calculateLayout(undefined, undefined, y.DIRECTION_LTR);
  applyYogaLayout(graph, frame, yogaRoot);
  freeYogaTree(yogaRoot);
}

// ─── Grid Layout ─────────────────────────────────────���─────────

/**
 * Compute CSS Grid layout for a GRID container.
 * Resolves gridTemplateColumns/Rows tracks, positions children by gridPosition
 * or auto-placement, and updates child x/y/width/height.
 */
function computeGridLayout(graph: SceneGraph, frame: SceneNode): void {
  const children = graph.getChildren(frame.id).filter(c => c.visible && c.layoutPositioning !== 'ABSOLUTE');
  if (children.length === 0) return;

  const padT = frame.paddingTop;
  const padR = frame.paddingRight;
  const padB = frame.paddingBottom;
  const padL = frame.paddingLeft;
  const contentW = frame.width - padL - padR;
  const contentH = frame.height - padT - padB;
  const colGap = frame.gridColumnGap || 0;
  const rowGap = frame.gridRowGap || 0;

  // Resolve column tracks
  const colSizes = resolveGridTracks(frame.gridTemplateColumns, contentW, colGap, children.length);
  // Resolve row tracks — if not defined, auto-create rows based on column count
  const numCols = colSizes.length || 1;
  const numRows = Math.max(
    frame.gridTemplateRows.length,
    Math.ceil(children.length / numCols),
  );
  const defaultRowTracks: typeof frame.gridTemplateRows = frame.gridTemplateRows.length > 0
    ? frame.gridTemplateRows
    : Array.from({ length: numRows }, () => ({ type: 'FR' as const, value: 1 }));
  const rowSizes = resolveGridTracks(defaultRowTracks, contentH, rowGap, children.length);

  // Compute x offsets for each column
  const colOffsets: number[] = [0];
  for (let i = 0; i < colSizes.length - 1; i++) {
    colOffsets.push(colOffsets[i] + colSizes[i] + colGap);
  }
  // Compute y offsets for each row
  const rowOffsets: number[] = [0];
  for (let i = 0; i < rowSizes.length - 1; i++) {
    rowOffsets.push(rowOffsets[i] + rowSizes[i] + rowGap);
  }

  // Place children
  let autoCol = 0;
  let autoRow = 0;

  for (const child of children) {
    let col: number, row: number, colSpan: number, rowSpan: number;

    if (child.gridPosition) {
      col = Math.max(0, child.gridPosition.column - 1);
      row = Math.max(0, child.gridPosition.row - 1);
      colSpan = child.gridPosition.columnSpan || 1;
      rowSpan = child.gridPosition.rowSpan || 1;
    } else {
      // Auto-placement
      col = autoCol;
      row = autoRow;
      colSpan = 1;
      rowSpan = 1;
      autoCol++;
      if (autoCol >= numCols) {
        autoCol = 0;
        autoRow++;
      }
    }

    // Clamp to grid bounds
    col = Math.min(col, colSizes.length - 1);
    row = Math.min(row, rowSizes.length - 1);
    const endCol = Math.min(col + colSpan - 1, colSizes.length - 1);
    const endRow = Math.min(row + rowSpan - 1, rowSizes.length - 1);

    // Calculate position and size
    const x = padL + (colOffsets[col] ?? 0);
    const y = padT + (rowOffsets[row] ?? 0);
    const w = (colOffsets[endCol] ?? 0) + (colSizes[endCol] ?? 0) - (colOffsets[col] ?? 0);
    const h = (rowOffsets[endRow] ?? 0) + (rowSizes[endRow] ?? 0) - (rowOffsets[row] ?? 0);

    graph.updateNode(child.id, { x, y, width: w, height: h });
  }
}

/**
 * Resolve grid track sizes from FIXED/FR/AUTO definitions.
 */
function resolveGridTracks(
  tracks: ReadonlyArray<{ type: string; value: number }>,
  available: number,
  gap: number,
  childCount: number,
): number[] {
  if (tracks.length === 0) {
    // Default: single column filling available space
    return [available];
  }

  const totalGap = gap * Math.max(tracks.length - 1, 0);
  let remaining = available - totalGap;
  let totalFr = 0;
  const sizes: number[] = new Array(tracks.length);

  // First pass: resolve FIXED and AUTO, sum FR
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    if (t.type === 'FIXED') {
      sizes[i] = t.value;
      remaining -= t.value;
    } else if (t.type === 'AUTO') {
      // AUTO: use a reasonable minimum (will be expanded if space allows)
      const autoSize = Math.max(50, remaining / tracks.length);
      sizes[i] = autoSize;
      remaining -= autoSize;
    } else {
      // FR
      totalFr += t.value;
      sizes[i] = 0; // placeholder
    }
  }

  // Second pass: distribute remaining space to FR tracks
  if (totalFr > 0 && remaining > 0) {
    const perFr = remaining / totalFr;
    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].type === 'FR') {
        sizes[i] = Math.max(0, perFr * tracks[i].value);
      }
    }
  }

  return sizes;
}

/**
 * Compute layout for all auto-layout frames, bottom-up.
 */
export function computeAllLayouts(graph: SceneGraph, scopeId?: string): void {
  const startId = scopeId ?? graph.rootId;

  // Find top-level layout roots: frames with layoutMode that are NOT children of
  // another layout frame. Nested layout containers are handled by their parent's
  // Yoga tree (via configureNestedAutoLayout), so they should NOT be computed independently.
  const layoutRoots: string[] = [];

  function findLayoutRoots(nodeId: string, parentIsLayout: boolean): void {
    const node = graph.getNode(nodeId);
    if (!node) return;

    const isLayout = node.layoutMode !== 'NONE';

    if (isLayout && !parentIsLayout) {
      // Top-level layout container — compute it (will recursively handle nested)
      layoutRoots.push(nodeId);
    }

    // Recurse into children to find more top-level roots
    for (const childId of node.childIds) {
      findLayoutRoots(childId, isLayout || parentIsLayout);
    }
  }

  findLayoutRoots(startId, false);

  // Compute each top-level layout root (handles nested containers internally via Yoga)
  for (const rootId of layoutRoots) {
    computeLayout(graph, rootId);
  }
}

/**
 * Run {@link computeAllLayouts} and ignore failures — used before audit/export/preview
 * so exotic or partial trees still produce output.
 */
export function ensureSceneLayout(graph: SceneGraph, scopeId?: string): void {
  try {
    computeAllLayouts(graph, scopeId);
  } catch {
    /* best-effort */
  }
}
