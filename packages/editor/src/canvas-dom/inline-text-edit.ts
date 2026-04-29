/**
 * Inline text editing — extracted from dom-canvas.ts (Phase 1 UI-5a).
 *
 * Core in-place editing surface for the DOM canvas. Owns:
 *   - The expanded editable tag set (was P|H1-H6|SPAN|BUTTON, now any
 *     leaf-text element — DIV|A|LI|LABEL|STRONG|EM|BLOCKQUOTE|CODE|PRE|
 *     FIGCAPTION|SUMMARY|TD|TH on top of the originals)
 *   - The `isLeafTextElement` heuristic — tag-allowlisted AND children
 *     are text-only or inline formatting tags (B/I/U/STRONG/EM/SPAN/...)
 *     ⇒ a DIV with block children is NOT editable (would split text
 *     across an unrelated container's flow).
 *   - Edit-state visual polish — 1px ring + soft shadow matching Figma
 *     edit-mode look (replaces the prior 2px solid blue).
 *   - Multi-modal entry — dblclick (legacy), Enter when a single text
 *     node is selected, F2 (accessibility / muscle-memory parity).
 *   - Commit/revert formalization — Enter commits, Shift+Enter inserts
 *     newline, Escape reverts, Blur commits (Figma default — not
 *     revert; clicking outside a text edit "should" save).
 *   - Hug-on-edit — debounced live POST on `input` so a HUG-sized
 *     parent reflows as text grows. Yoga runs server-side on every
 *     mutation, SSE broadcasts back, renderer incremental-patches.
 *
 * Does NOT own:
 *   - Caret preservation across SSE-driven srcdoc swaps (handled by
 *     `caret-preservation.ts` + wired in `renderer.ts`).
 *   - The mini-toolbar — separate module (`mini-toolbar.ts`) consumed
 *     here only at the controller-creation site.
 *   - Postback transport — caller injects `postEdit`. Same single POST
 *     sink as the rest of dom-canvas.
 *
 * Bind lifecycle:
 *   The iframe document re-mounts on every srcdoc swap (SSE reload).
 *   `attachToDocument(doc)` re-installs doc-level listeners (dblclick).
 *   Window-level listeners (Enter/F2 multi-modal entry) are owned by
 *   the caller — exposed here as `tryEnterFromKey(e, primaryEl)` so
 *   the caller can route from one global key listener.
 */

const EDITABLE_TAGS_LIST = [
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SPAN', 'BUTTON',
  'DIV', 'A', 'LI', 'LABEL', 'STRONG', 'EM', 'BLOCKQUOTE', 'CODE',
  'PRE', 'FIGCAPTION', 'SUMMARY', 'TD', 'TH',
] as const;

export const EDITABLE_TAGS: ReadonlySet<string> = new Set(EDITABLE_TAGS_LIST);

const INLINE_FORMATTING_TAGS_LIST = [
  'B', 'I', 'U', 'STRONG', 'EM', 'SPAN', 'CODE', 'A',
  'MARK', 'SMALL', 'SUB', 'SUP', 'BR', 'WBR',
] as const;

const INLINE_FORMATTING_TAGS: ReadonlySet<string> = new Set(INLINE_FORMATTING_TAGS_LIST);

/**
 * Heuristic: a "leaf-text element" is a tag in EDITABLE_TAGS whose
 * children are all either text nodes or inline formatting tags (which
 * can themselves recurse — `<p><strong><em>`x</em></strong></p>` is
 * leaf-text). DIV-with-DIV-child is NOT leaf-text — editing it would
 * scope to one of the divs ambiguously.
 *
 * Empty editable elements are leaf-text — typing into an empty <p> or
 * <div> is a normal designer operation.
 */
export function isLeafTextElement(el: Element | null): boolean {
  if (!el || el.nodeType !== 1) return false;
  const tag = (el as HTMLElement).tagName;
  if (!EDITABLE_TAGS.has(tag)) return false;
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === 3) continue;
    if (child.nodeType === 8) continue;
    if (child.nodeType === 1) {
      if (!INLINE_FORMATTING_TAGS.has((child as HTMLElement).tagName)) return false;
      continue;
    }
    return false;
  }
  return true;
}

export interface InlineTextEditorOptions {
  sceneId: string;
  postEdit: (nodeId: string, props: Record<string, unknown>) => Promise<void> | void;
  /** Hot-edit live POST debounce — drives Yoga/SSE reflow for HUG parents. */
  hugReflowDebounceMs?: number;
  /** Hooks into mini-toolbar lifecycle. Caller wires the actual toolbar. */
  onEditStart?: (host: HTMLElement) => void;
  onEditEnd?: () => void;
  onSelectionChange?: (host: HTMLElement, range: Range | null) => void;
}

export interface InlineTextEditorController {
  isEditing(): boolean;
  getEditingNodeId(): string | null;
  getEditingHost(): HTMLElement | null;
  /** Walk up from `target` until a leaf-text-elementbearing data-reframe-inode is found. */
  resolveEditableAnchor(target: Node | null): HTMLElement | null;
  start(host: HTMLElement): void;
  finish(commit: boolean): Promise<void>;
  /** Bind doc-level dblclick + selectionchange. Idempotent per doc. */
  attachToDocument(doc: Document): void;
  /**
   * Try to enter edit mode from a window-level key event. Returns true
   * iff the key was Enter (no modifiers) or F2 AND a leaf-text host
   * resolved from `getPrimaryHost()`. Caller installs window listener.
   */
  tryEnterFromKey(e: KeyboardEvent, getPrimaryHost: () => HTMLElement | null): boolean;
  destroy(): void;
}

const EDIT_RING_SHADOW =
  '0 0 0 3px rgba(43,116,255,0.15), 0 4px 12px rgba(0,0,0,0.08)';

const findInodeAnchor = (n: Node | null): HTMLElement | null => {
  let cur: Node | null = n;
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as HTMLElement;
      if (el.getAttribute && el.getAttribute('data-reframe-inode')) return el;
    }
    cur = cur.parentNode;
  }
  return null;
};

export function createInlineTextEditor(
  opts: InlineTextEditorOptions,
): InlineTextEditorController {
  let editingEl: HTMLElement | null = null;
  let editingNodeId: string | null = null;
  let savedOutline: string | null = null;
  let savedBoxShadow: string | null = null;
  let attachedDoc: Document | null = null;
  let hugTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingHugText: string | null = null;
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  let onBlur: (() => void) | null = null;
  let onInput: (() => void) | null = null;
  let onSelChange: (() => void) | null = null;

  const hugDebounceMs = opts.hugReflowDebounceMs ?? 100;

  const flushHug = () => {
    if (hugTimer) { clearTimeout(hugTimer); hugTimer = null; }
    const id = editingNodeId;
    const txt = pendingHugText;
    pendingHugText = null;
    if (id && txt !== null) {
      // Fire-and-forget — server SSE will incremental-patch; caret
      // preservation in renderer.ts keeps cursor alive.
      void Promise.resolve(opts.postEdit(id, { 'text-content': txt }));
    }
  };

  const scheduleHug = (text: string) => {
    pendingHugText = text;
    if (hugTimer) clearTimeout(hugTimer);
    hugTimer = setTimeout(flushHug, hugDebounceMs);
  };

  const applyEditVisual = (el: HTMLElement) => {
    savedOutline = el.style.outline;
    savedBoxShadow = el.style.boxShadow;
    el.dataset.rfdEditing = '1';
    el.style.outline = '1px solid #2b74ff';
    el.style.boxShadow = EDIT_RING_SHADOW;
    el.style.borderRadius = el.style.borderRadius || '2px';
  };

  const clearEditVisual = (el: HTMLElement) => {
    delete el.dataset.rfdEditing;
    el.style.outline = savedOutline ?? '';
    el.style.boxShadow = savedBoxShadow ?? '';
    savedOutline = null;
    savedBoxShadow = null;
  };

  const start = (host: HTMLElement) => {
    if (editingEl === host) return;
    if (editingEl) {
      // Switch hosts — commit current edit, then start new.
      void finish(true).then(() => start(host));
      return;
    }
    if (!isLeafTextElement(host)) return;
    const nodeId = host.getAttribute('data-reframe-inode');
    if (!nodeId) return;
    editingEl = host;
    editingNodeId = nodeId;
    host.setAttribute('contenteditable', 'true');
    applyEditVisual(host);
    host.focus();

    // Select-all on enter (Figma parity).
    const doc = host.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(host);
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    onBlur = () => { void finish(true); };
    onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void finish(true);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        void finish(false);
        return;
      }
      // Shift+Enter falls through — browser inserts <br> natively
      // inside contenteditable. We don't intercept.
    };
    onInput = () => {
      // Live HUG reflow — debounced text-content POST so server Yoga
      // re-runs and SSE broadcasts a parent width update if HUG.
      if (!editingEl) return;
      const cur = editingEl.textContent ?? '';
      scheduleHug(cur);
    };
    onSelChange = () => {
      if (!editingEl) return;
      const s = doc.getSelection();
      const r = s && s.rangeCount > 0 ? s.getRangeAt(0) : null;
      // Only forward selections that live inside the active edit host.
      if (r && editingEl.contains(r.startContainer)) {
        opts.onSelectionChange?.(editingEl, r);
      } else {
        opts.onSelectionChange?.(editingEl, null);
      }
    };
    host.addEventListener('blur', onBlur, { once: true });
    host.addEventListener('keydown', onKey, { capture: false });
    host.addEventListener('input', onInput, { capture: false });
    doc.addEventListener('selectionchange', onSelChange);
    opts.onEditStart?.(host);
  };

  const finish = async (commit: boolean): Promise<void> => {
    const el = editingEl;
    const nodeId = editingNodeId;
    editingEl = null;
    editingNodeId = null;
    if (!el) return;
    // Cancel pending hug reflow — final commit supersedes.
    if (hugTimer) { clearTimeout(hugTimer); hugTimer = null; }
    pendingHugText = null;
    if (onKey) el.removeEventListener('keydown', onKey);
    if (onInput) el.removeEventListener('input', onInput);
    if (onSelChange && el.ownerDocument) el.ownerDocument.removeEventListener('selectionchange', onSelChange);
    onKey = null; onInput = null; onSelChange = null; onBlur = null;
    el.removeAttribute('contenteditable');
    clearEditVisual(el);
    opts.onEditEnd?.();
    if (!commit || !nodeId) return;
    const newText = el.textContent ?? '';
    await Promise.resolve(opts.postEdit(nodeId, { 'text-content': newText }));
  };

  const resolveEditableAnchor = (target: Node | null): HTMLElement | null => {
    const anchor = findInodeAnchor(target);
    if (!anchor) return null;
    return isLeafTextElement(anchor) ? anchor : null;
  };

  const onDblClick = (e: Event) => {
    const me = e as MouseEvent;
    const host = resolveEditableAnchor(me.target as Node);
    if (!host) return;
    me.preventDefault();
    start(host);
  };

  const attachToDocument = (doc: Document) => {
    if (attachedDoc === doc) return;
    if (attachedDoc) attachedDoc.removeEventListener('dblclick', onDblClick);
    attachedDoc = doc;
    doc.addEventListener('dblclick', onDblClick);
  };

  const tryEnterFromKey = (
    e: KeyboardEvent,
    getPrimaryHost: () => HTMLElement | null,
  ): boolean => {
    if (editingEl) return false;
    const isEnter = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    const isF2 = e.key === 'F2' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (!isEnter && !isF2) return false;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return false;
    const host = getPrimaryHost();
    if (!host) return false;
    if (!isLeafTextElement(host)) return false;
    e.preventDefault();
    start(host);
    return true;
  };

  const destroy = () => {
    if (editingEl) void finish(false);
    if (attachedDoc) attachedDoc.removeEventListener('dblclick', onDblClick);
    attachedDoc = null;
  };

  return {
    isEditing: () => editingEl !== null,
    getEditingNodeId: () => editingNodeId,
    getEditingHost: () => editingEl,
    resolveEditableAnchor,
    start,
    finish,
    attachToDocument,
    tryEnterFromKey,
    destroy,
  };
}
