/**
 * Layers panel helpers (Phase 1 UI-4). Pure functions backing the
 * left-rail tree view's structural logic — depth-first flatten with
 * indent levels, name-filter walk, range-select between two ids,
 * keyboard-nav next/prev/first-child/parent walks.
 *
 * Lives server-side as TS so contract tests can exercise the logic
 * without spinning up the platform UI in a browser. The shipping JS
 * (150-sidebar.js) is a thin renderer that calls into the same shapes
 * exposed here in spirit (the JS implements them in JS-land — the
 * helpers in this file are the canonical reference + test surface).
 */

export interface LayerTreeNode {
  id: string;
  name?: string;
  type?: string;
  text?: string;
  visible?: boolean;
  locked?: boolean;
  children?: LayerTreeNode[];
}

export interface FlatRow {
  id: string;
  depth: number;
  hasChildren: boolean;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  /** Display label after FRIENDLY-tag substitution + text-absorb. */
  displayName: string;
}

const FRIENDLY_TAG: Record<string, string> = {
  div: 'Container', span: 'Span', section: 'Section',
  header: 'Header', footer: 'Footer', main: 'Main',
  nav: 'Nav', article: 'Article', aside: 'Aside',
  ul: 'List', ol: 'List', li: 'Item',
  a: 'Link', img: 'Image', p: 'Paragraph',
  h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3',
  h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6',
  button: 'Button', input: 'Input', form: 'Form',
};

/**
 * Build the row's display label using the same rules the JS side
 * already runs in `renderLayerNode` — friendly tag substitution, text
 * absorption for single-text-child wrappers, truncation past 28 chars.
 *
 * Exposed so tests can verify "TEXT node with content" → text shows up
 * in the row, and "div with children" → "Container" not "div".
 */
export function deriveDisplayName(node: LayerTreeNode): string {
  const rawName = (node.name ?? '').toLowerCase();
  let displayName = node.name || '?';
  if (FRIENDLY_TAG[rawName]) displayName = FRIENDLY_TAG[rawName];

  // Absorb single TEXT child's content as the row label.
  let absorbedText = '';
  const children = node.children ?? [];
  if (children.length === 1 && children[0].type === 'TEXT') {
    absorbedText = children[0].text || children[0].name || '';
  } else if (node.type === 'TEXT' && children.length === 0) {
    absorbedText = node.text || node.name || '';
  }
  if (node.type === 'TEXT' && !absorbedText) displayName = 'Text';
  if (node.type === 'TEXT' && absorbedText) {
    displayName = absorbedText.length > 28
      ? absorbedText.slice(0, 28) + '…'
      : absorbedText;
  }
  return displayName;
}

/**
 * Flatten the tree into a row sequence in document-order DFS. Includes
 * all visible+invisible+locked rows — visibility / lock styling is a
 * UI concern, not a flatten concern.
 *
 * Used by:
 *   - tree-row rendering (each row = one entry)
 *   - keyboard nav (next/prev = adjacent entries)
 *   - range-select between two ids (slice between their indices)
 */
export function flattenTree(root: LayerTreeNode | null | undefined): FlatRow[] {
  if (!root) return [];
  const rows: FlatRow[] = [];
  function walk(node: LayerTreeNode, depth: number): void {
    const children = node.children ?? [];
    rows.push({
      id: node.id,
      depth,
      hasChildren: children.length > 0,
      name: node.name ?? '',
      type: node.type ?? '',
      visible: node.visible !== false,
      locked: !!node.locked,
      displayName: deriveDisplayName(node),
    });
    for (const c of children) walk(c, depth + 1);
  }
  walk(root, 0);
  return rows;
}

/**
 * Compute the inclusive range of rows between two ids in flatten
 * order. Returns the ids in flatten order so callers can pass the
 * result to setSelection without further sorting.
 *
 * Used by Shift+click in the layers panel — select primary..clicked
 * inclusive based on tree-document order, matching Figma's range
 * model for tree views.
 *
 * Returns empty array when either id is absent — caller falls back
 * to a single-add behavior.
 */
export function rangeBetween(rows: ReadonlyArray<FlatRow>, fromId: string, toId: string): string[] {
  const fromIdx = rows.findIndex((r) => r.id === fromId);
  const toIdx = rows.findIndex((r) => r.id === toId);
  if (fromIdx < 0 || toIdx < 0) return [];
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  const out: string[] = [];
  for (let i = lo; i <= hi; i++) out.push(rows[i].id);
  return out;
}

/**
 * Filter rows whose displayName matches the query (case-insensitive
 * substring). When `preserveAncestors` is true we ALSO keep every
 * matched row's ancestors so the tree retains parent context — the
 * brief's "Parent context preserved — если matched node is deep,
 * ancestors shown" requirement.
 *
 * Returns a Set of ids the renderer should keep visible. Empty
 * query (after trim) returns null — caller renders the full tree.
 */
export function filterTreeByName(
  rows: ReadonlyArray<FlatRow>,
  parentByChild: ReadonlyMap<string, string | null>,
  query: string,
  options: { preserveAncestors?: boolean } = {},
): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const preserveAncestors = options.preserveAncestors !== false;
  const visible = new Set<string>();
  for (const row of rows) {
    if (row.displayName.toLowerCase().includes(q)) {
      visible.add(row.id);
      if (preserveAncestors) {
        let p = parentByChild.get(row.id) ?? null;
        while (p) {
          if (visible.has(p)) break;
          visible.add(p);
          p = parentByChild.get(p) ?? null;
        }
      }
    }
  }
  return visible;
}

/**
 * Build the parent-by-child lookup the filter needs for ancestor
 * preservation. Tree → Map<childId, parentId | null> (root maps to
 * null).
 */
export function buildParentMap(root: LayerTreeNode | null | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!root) return out;
  function walk(node: LayerTreeNode, parentId: string | null): void {
    out.set(node.id, parentId);
    for (const c of node.children ?? []) walk(c, node.id);
  }
  walk(root, null);
  return out;
}

/**
 * Compute keyboard-nav next/prev across visible rows. Wraps cyclically
 * at the ends — matches Figma's tree-view convention. `visibleIds`
 * scopes the walk to currently-displayed rows (post-filter +
 * post-collapse).
 *
 * Returns null when the source id isn't visible (caller treats as
 * "no movement").
 */
export function nextRowId(
  rows: ReadonlyArray<FlatRow>,
  visibleIds: ReadonlySet<string>,
  fromId: string,
  direction: 1 | -1,
): string | null {
  const visibleRows = rows.filter((r) => visibleIds.has(r.id));
  if (visibleRows.length === 0) return null;
  const idx = visibleRows.findIndex((r) => r.id === fromId);
  if (idx < 0) return null;
  const nextIdx = (idx + direction + visibleRows.length) % visibleRows.length;
  return visibleRows[nextIdx].id;
}

/**
 * Validate a drag-reorder before issuing the API call. Mirrors the
 * server-side checks in /platform/api/node/reorder so the JS UI can
 * paint a "rejected" indicator without a network round-trip.
 *
 * Returns null on valid; an error code string on invalid.
 */
export type ReorderError =
  | 'edit.reorder.invalid_self'
  | 'edit.reorder.invalid_descendant'
  | 'edit.reorder.target_locked'
  | 'edit.reorder.is_root'
  | 'edit.reorder.target_is_root';

export function validateReorder(args: {
  rows: ReadonlyArray<FlatRow>;
  parentByChild: ReadonlyMap<string, string | null>;
  nodeId: string;
  targetId: string;
  position: 'before' | 'after' | 'inside';
  rootId: string;
}): ReorderError | null {
  const { rows, parentByChild, nodeId, targetId, position, rootId } = args;
  if (nodeId === targetId) return 'edit.reorder.invalid_self';
  if (nodeId === rootId) return 'edit.reorder.is_root';
  // Walk target's ancestors looking for nodeId — reject when target
  // is descendant of node (same as the server-side cycle check).
  let p: string | null | undefined = targetId;
  while (p) {
    if (p === nodeId) return 'edit.reorder.invalid_descendant';
    p = parentByChild.get(p) ?? null;
  }
  // Sibling drop relative to root has no parent to insert into.
  if (position !== 'inside' && targetId === rootId) {
    return 'edit.reorder.target_is_root';
  }
  // Locked target rejects drops.
  const targetRow = rows.find((r) => r.id === targetId);
  if (targetRow?.locked) return 'edit.reorder.target_locked';
  return null;
}
