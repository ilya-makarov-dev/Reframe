/**
 * Keyboard navigation for the DOM canvas (Phase 1 UI-2).
 *
 * Tab / Shift+Tab walks siblings in DFS document order, Enter steps
 * into first child, Escape steps to parent, Cmd/Ctrl+A selects all
 * siblings of the primary node (or all root children when primary is
 * null). Cmd/Ctrl+G groups, Cmd/Ctrl+Shift+G ungroups.
 *
 * ─── Multi-mount gating ─────────────────────────────────────
 *
 * Listeners are window-global (matches the present-mode keybind
 * pattern). Every mounted canvas installs its own listener; the
 * `isFocused()` predicate routes the keypress to exactly one
 * instance. Without this gate, Tab in a /variants= page with three
 * canvases would walk all three at once.
 *
 * ─── Why we never call the API directly ─────────────────────
 *
 * Group / ungroup are server ops — we emit them through the host's
 * `runEdit(op)` callback rather than fetching from inside this
 * module. Lets the host attach loading state, batch, or rewrite
 * the request URL without this module knowing about transport.
 */

import type { NodeId } from './selection-state.js';

export interface KeyboardNavOptions {
  /** Multi-mount gate. */
  isFocused: () => boolean;
  /**
   * Iframe document the canvas is showing — used to walk the INode
   * tree for sibling / parent navigation. Re-evaluated on every key
   * event because the iframe is replaced on full reloads.
   */
  getDocument: () => Document | null;
  /** Read primary id (drives Tab/Enter/Esc anchor). */
  getPrimaryId: () => NodeId | null;
  /** Read current selection (drives Cmd+G group payload). */
  getSelectedIds: () => NodeId[];
  /** Set new selection — host wires this to `setSelection` in selection-state. */
  setSelection: (ids: NodeId[]) => void;
  /**
   * Runs a server edit op. Host wraps fetch + /platform/api/node/edit
   * (or /platform/api/edit for ops that don't fit the node-edit shape
   * — e.g. group/ungroup go through a project-level surface).
   */
  runEdit: (op: { type: 'group'; sceneId: string; nodeIds: NodeId[] } | { type: 'ungroup'; sceneId: string; nodeId: NodeId }) => Promise<void>;
  /** Scene id this canvas shows — passed to runEdit. */
  getSceneId: () => string;
  /**
   * Optional escape hatch for inline-text-editing — when true we
   * skip all nav keys so Tab/Esc inside contenteditable behave
   * naturally.
   */
  isEditingText?: () => boolean;
}

export function attachKeyboardNav(opts: KeyboardNavOptions): { destroy: () => void } {
  const onKey = async (e: KeyboardEvent) => {
    if (!opts.isFocused()) return;
    if (opts.isEditingText?.()) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    // Don't hijack key combos the shell already owns.
    const isCmd = e.metaKey || e.ctrlKey;

    // Cmd+A — select all siblings of primary, or all root children.
    if (isCmd && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      const doc = opts.getDocument();
      if (!doc) return;
      const primary = opts.getPrimaryId();
      const ids = collectSiblings(doc, primary);
      opts.setSelection(ids);
      return;
    }

    // Cmd+Shift+G — ungroup. Checked BEFORE Cmd+G because Cmd+G with
    // shift held would otherwise match the Cmd+G branch and short-
    // circuit. Acts on the primary node when it's the only selection;
    // ignored otherwise (designer must single-select the group first).
    if (isCmd && e.shiftKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      const selected = opts.getSelectedIds();
      if (selected.length !== 1) return;
      try { await opts.runEdit({ type: 'ungroup', sceneId: opts.getSceneId(), nodeId: selected[0] }); }
      catch (err) { console.warn('[keyboard-nav] ungroup failed', err); }
      return;
    }

    // Cmd+G — group selected siblings into a new frame.
    if (isCmd && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      const selected = opts.getSelectedIds();
      if (selected.length < 2) return;
      try { await opts.runEdit({ type: 'group', sceneId: opts.getSceneId(), nodeIds: selected }); }
      catch (err) { console.warn('[keyboard-nav] group failed', err); }
      return;
    }

    // Tab / Shift+Tab — walk siblings.
    if (e.key === 'Tab' && !isCmd) {
      const doc = opts.getDocument();
      if (!doc) return;
      const primary = opts.getPrimaryId();
      if (!primary) return;
      const next = walkSibling(doc, primary, e.shiftKey ? -1 : 1);
      if (!next) return;
      e.preventDefault();
      opts.setSelection([next]);
      return;
    }

    // Enter — step into first child of primary.
    if (e.key === 'Enter' && !isCmd) {
      const doc = opts.getDocument();
      if (!doc) return;
      const primary = opts.getPrimaryId();
      if (!primary) return;
      const child = firstChild(doc, primary);
      if (!child) return;
      e.preventDefault();
      opts.setSelection([child]);
      return;
    }

    // Escape — step to parent. Empty selection → no-op (the iframe's
    // own keydown handler clears selection on Escape).
    if (e.key === 'Escape') {
      const doc = opts.getDocument();
      if (!doc) return;
      const primary = opts.getPrimaryId();
      if (!primary) return;
      const parent = parentOf(doc, primary);
      if (!parent) return;
      // Don't preventDefault here — the iframe's existing Escape
      // handler also runs and clears selection if we don't change it.
      // We override by setting our own selection first.
      opts.setSelection([parent]);
      return;
    }
  };

  window.addEventListener('keydown', onKey);
  return {
    destroy: () => {
      window.removeEventListener('keydown', onKey);
    },
  };
}

/**
 * Gather sibling ids of the node identified by `id`. When `id` is null
 * we return the root's direct children — Cmd+A's "select-all" entry
 * point when nothing is selected yet.
 */
export function collectSiblings(doc: Document, id: NodeId | null): NodeId[] {
  if (!id) {
    const root = doc.body.firstElementChild as HTMLElement | null;
    if (!root) return [];
    return childrenOf(root);
  }
  const el = doc.querySelector(`[data-reframe-inode="${cssEscape(id)}"]`) as HTMLElement | null;
  if (!el) return [];
  const parent = el.parentElement;
  if (!parent) return [];
  return childrenOf(parent);
}

function childrenOf(parent: HTMLElement): NodeId[] {
  const out: NodeId[] = [];
  for (const child of Array.from(parent.children)) {
    const cid = (child as HTMLElement).getAttribute('data-reframe-inode');
    if (cid) out.push(cid);
  }
  return out;
}

/**
 * Walk to the next or previous sibling at the same nesting level.
 * Wraps around when reaching the end of the sibling list — cyclic
 * navigation matches Figma + designer expectations.
 */
export function walkSibling(doc: Document, id: NodeId, direction: 1 | -1): NodeId | null {
  const el = doc.querySelector(`[data-reframe-inode="${cssEscape(id)}"]`) as HTMLElement | null;
  if (!el) return null;
  const parent = el.parentElement;
  if (!parent) return null;
  const siblings = childrenOf(parent);
  if (siblings.length === 0) return null;
  const idx = siblings.indexOf(id);
  if (idx < 0) return null;
  const nextIdx = (idx + direction + siblings.length) % siblings.length;
  return siblings[nextIdx];
}

export function firstChild(doc: Document, id: NodeId): NodeId | null {
  const el = doc.querySelector(`[data-reframe-inode="${cssEscape(id)}"]`) as HTMLElement | null;
  if (!el) return null;
  for (const child of Array.from(el.children)) {
    const cid = (child as HTMLElement).getAttribute('data-reframe-inode');
    if (cid) return cid;
  }
  return null;
}

export function parentOf(doc: Document, id: NodeId): NodeId | null {
  const el = doc.querySelector(`[data-reframe-inode="${cssEscape(id)}"]`) as HTMLElement | null;
  if (!el) return null;
  let cur: HTMLElement | null = el.parentElement;
  while (cur) {
    const pid = cur.getAttribute('data-reframe-inode');
    if (pid) return pid;
    cur = cur.parentElement;
  }
  return null;
}

function cssEscape(s: string): string {
  return s.replace(/(["\\<>])/g, '\\$1');
}
