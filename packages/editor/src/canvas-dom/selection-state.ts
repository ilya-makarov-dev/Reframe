/**
 * Selection state container for the DOM canvas (Phase 1 UI-2).
 *
 * Pure state — no DOM, no events. dom-canvas owns the lifecycle and
 * wires this into pointer / keyboard / marquee handlers.
 *
 * Three fields drive the overlay:
 *   selectedIds — the multi-select set (order-independent membership)
 *   primaryId   — last-clicked / focused, drives Inspector "primary"
 *                 highlight + keyboard navigation cursor
 *   hoveredId   — mouse-over preview; never overlaps with selection
 *                 visually (overlay drops the hover outline whenever
 *                 the hovered node is also selected)
 *
 * ─── Why a Set, not an Array ────────────────────────────────
 *
 * Multi-select operations (Shift+click add, Cmd+click toggle, marquee
 * union) all reduce to membership tests. Set.has + Set.add + Set.delete
 * keep them O(1); the previous Array shape required indexOf scans on
 * every Shift+click which became visible at ~50 selected siblings.
 *
 * ─── primaryId drift across clear ───────────────────────────
 *
 * Clearing selection nulls primaryId. Clicking a single node sets
 * primaryId to it. Cmd+click that REMOVES the primary leaves the
 * primary undefined when other items remain — by convention we
 * promote `[...selectedIds][0]` to primary in that case so the
 * Inspector + keyboard cursor never lose anchor.
 */

export type NodeId = string;

export interface SelectionState {
  selectedIds: Set<NodeId>;
  primaryId: NodeId | null;
  hoveredId: NodeId | null;
}

export function createSelectionState(): SelectionState {
  return {
    selectedIds: new Set<NodeId>(),
    primaryId: null,
    hoveredId: null,
  };
}

/** Replace the whole selection — used by plain click + marquee no-mod. */
export function setSelection(state: SelectionState, ids: ReadonlyArray<NodeId>): void {
  state.selectedIds = new Set(ids);
  state.primaryId = ids.length > 0 ? ids[ids.length - 1] : null;
}

/** Add an id (Shift+click). Idempotent — re-adding is a no-op. */
export function addToSelection(state: SelectionState, id: NodeId): void {
  state.selectedIds.add(id);
  state.primaryId = id;
}

/**
 * Toggle membership (Cmd/Ctrl+click). When toggling out the current
 * primary, fall back to any remaining member as the new primary so
 * the Inspector + keyboard cursor never end up pointing at a node
 * that's no longer selected.
 */
export function toggleInSelection(state: SelectionState, id: NodeId): void {
  if (state.selectedIds.has(id)) {
    state.selectedIds.delete(id);
    if (state.primaryId === id) {
      const next = state.selectedIds.size > 0 ? state.selectedIds.values().next().value as NodeId : null;
      state.primaryId = next;
    }
  } else {
    state.selectedIds.add(id);
    state.primaryId = id;
  }
}

/** Empty selection — primary follows. */
export function clearSelection(state: SelectionState): void {
  state.selectedIds.clear();
  state.primaryId = null;
}

export function setHovered(state: SelectionState, id: NodeId | null): void {
  state.hoveredId = id;
}

/**
 * Apply a marquee result with modifier semantics. `intersected` is the
 * set of node ids whose computed bbox intersects the marquee rect.
 *
 *   no modifier: replace selection with intersected
 *   shift:       union (additive)
 *   cmd/ctrl:    symmetric difference (toggle each)
 */
export function applyMarqueeResult(
  state: SelectionState,
  intersected: ReadonlyArray<NodeId>,
  mod: 'replace' | 'union' | 'toggle',
): void {
  if (mod === 'replace') {
    setSelection(state, intersected);
    return;
  }
  if (mod === 'union') {
    for (const id of intersected) state.selectedIds.add(id);
    if (intersected.length > 0) state.primaryId = intersected[intersected.length - 1];
    return;
  }
  // toggle
  for (const id of intersected) {
    if (state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
  }
  // Re-anchor primary to a remaining selected node if the previous
  // primary was just toggled out.
  if (state.primaryId === null || !state.selectedIds.has(state.primaryId)) {
    state.primaryId = state.selectedIds.size > 0
      ? state.selectedIds.values().next().value as NodeId
      : null;
  }
}

/** Snapshot in a stable order — order is insertion order in the underlying Set. */
export function selectionAsArray(state: SelectionState): NodeId[] {
  return Array.from(state.selectedIds);
}

export function isSelected(state: SelectionState, id: NodeId): boolean {
  return state.selectedIds.has(id);
}
