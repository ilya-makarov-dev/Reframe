/**
 * Caret preservation through render boundaries (T3 #14).
 *
 * Inline text editing in the canvas iframe loses caret position whenever
 * the host document re-renders or replaces a contenteditable element —
 * format toggles, SSE-driven scene reloads, mid-edit property changes
 * from the inspector. The browser's native execCommand sometimes
 * preserves caret across simple transforms but the behavior is
 * inconsistent (Chromium ≠ Firefox ≠ Safari) and any hard reload
 * (iframe.srcdoc swap) drops the selection unconditionally.
 *
 * ─── Defense-in-depth pattern ───────────────────────────────
 *
 * Wrap operations that may invalidate selection with capture/restore:
 *
 *   const state = captureCaret(doc, sceneId);
 *   // ... do something that may re-render or restyle ...
 *   if (state) restoreCaret(doc, state);
 *
 * Zero-cost when the browser preserves caret natively (we just observe
 * + re-set the same range). Saves us when the browser doesn't, or when
 * the operation tears down + rebuilds the DOM nodes the original range
 * pointed at.
 *
 * ─── Why not store the DOM node reference ───────────────────
 *
 * The original range's `startContainer` is a Text node. After a re-
 * render, that exact Text node is gone — replaced by a new one inside a
 * new element. Persisting a node reference would leak detached nodes +
 * fail restore. Instead we record the enclosing INode's `data-reframe-
 * inode` id, look it up at restore time, find the first text descendant,
 * apply the offset (clamped to current text length).
 *
 * ─── Offset clamping ────────────────────────────────────────
 *
 * Re-render may produce shorter text (formatting collapsed, autocorrect,
 * brand vocabulary wrap, etc.). If we captured offset 12 and the new
 * text is 8 chars, restore caps offset at 8 instead of throwing.
 * Visible position may shift slightly but the alternative is a thrown
 * `IndexSizeError` from setStart which would crash the editor surface.
 */

/**
 * Captured caret state — entirely value-based; no DOM references that
 * could become stale across re-render cycles.
 */
export interface CaretState {
  /** Scene the caret was inside; lets multi-iframe contexts route restore correctly. */
  sceneId: string;
  /** INode id (data-reframe-inode) of the enclosing element. */
  nodeId: string;
  /** Character offset within the first text descendant — clamped to length on restore. */
  startOffset: number;
  /** End offset for selection ranges; equals startOffset for caret-only state. */
  endOffset: number;
}

/**
 * Walk up from `el` to the nearest ancestor carrying a
 * `data-reframe-inode` attribute. Returns null when no anchor is
 * found — either the selection is outside the rendered scene tree or
 * the iframe document hasn't loaded yet.
 */
function findEnclosingINode(node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as HTMLElement;
      if (el.getAttribute && el.getAttribute('data-reframe-inode')) return el;
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * Find the first descendant text node (nodeType === 3) of `el`.
 * Returns null when no text node exists — typically means the element
 * was just re-rendered and is currently empty.
 */
function findFirstTextNode(el: Element): Text | null {
  // Single-pass DFS using an explicit stack — recursion would risk
  // stack overflow on deeply nested DOM (rare but possible in long
  // styled-text trees).
  const stack: Node[] = [el];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.nodeType === 3) return cur as Text;
    // Push children in reverse so DFS visits in document order.
    if (cur.childNodes && cur.childNodes.length > 0) {
      for (let i = cur.childNodes.length - 1; i >= 0; i--) {
        stack.push(cur.childNodes[i]);
      }
    }
  }
  return null;
}

/**
 * Snapshot the current caret/selection state in `doc`. Returns null
 * when no selection exists, the selection isn't inside a node carrying
 * an inode anchor, or the document doesn't expose Selection API.
 *
 * `doc` is the iframe's contentDocument — operating on the parent
 * window's document would observe the EDITOR'S selection, not the
 * scene's. Multi-iframe contexts call this once per iframe at capture
 * time; states are independent.
 */
export function captureCaret(doc: Document | null, sceneId: string): CaretState | null {
  if (!doc) return null;
  const selection = doc.getSelection ? doc.getSelection() : null;
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const anchor = findEnclosingINode(range.startContainer);
  if (!anchor) return null;
  const nodeId = anchor.getAttribute('data-reframe-inode');
  if (!nodeId) return null;
  return {
    sceneId,
    nodeId,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
  };
}

/**
 * Restore caret/selection from a captured state.
 *
 * Returns true on success, false on graceful no-op:
 *   - state is null/undefined
 *   - target node (data-reframe-inode=<state.nodeId>) is not in `doc`
 *     — typically means it was deleted between capture and restore;
 *     don't throw, the editor stays usable with default selection
 *   - target has no text descendant — element was re-rendered empty
 *
 * Offsets are clamped to the current text length so restoring after
 * content shrinkage doesn't throw IndexSizeError.
 */
export function restoreCaret(doc: Document | null, state: CaretState | null | undefined): boolean {
  if (!doc || !state) return false;
  const target = doc.querySelector(`[data-reframe-inode="${cssEscape(state.nodeId)}"]`);
  if (!target) return false;
  const textNode = findFirstTextNode(target);
  if (!textNode) return false;
  const maxOffset = textNode.textContent ? textNode.textContent.length : 0;
  const start = Math.min(state.startOffset, maxOffset);
  const end = Math.min(state.endOffset, maxOffset);
  try {
    const range = doc.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const selection = doc.getSelection ? doc.getSelection() : null;
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    // Defensive — even with clamped offsets, some browsers throw on
    // edge cases (detached nodes, mid-mutation observers). Caret-loss
    // on rare cases is acceptable; editor crash isn't.
    return false;
  }
}

/**
 * Minimal CSS.escape polyfill for nodeId values. The Web platform
 * CSS.escape isn't present in jsdom + older browsers; data-reframe-
 * inode ids are 8-char fnv1a hex (0-9, a-f) so the escape is
 * usually a no-op, but defensive escape handles the unlikely case
 * of non-hex ids in synthetic test fixtures.
 */
function cssEscape(s: string): string {
  // Only escape characters that aren't safe in CSS attribute selector
  // values — quotes, backslashes, angle brackets. Hex ids never trigger
  // this branch.
  return s.replace(/(["\\<>])/g, '\\$1');
}
