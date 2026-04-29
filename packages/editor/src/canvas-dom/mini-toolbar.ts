/**
 * Mini-toolbar — floating Bold / Italic / Link controls above the
 * inline edit ring. Phase 1 UI-5a Pin #3.
 *
 * Why a separate module:
 *   - inline-text-edit owns the edit STATE (which host, commit/revert,
 *     hug reflow). Mini-toolbar owns one specific UI affordance — a
 *     range/caret-driven floating bar with three buttons. Splitting
 *     keeps each module under ~250 lines and lets us mock the
 *     toolbar in tests without instantiating the whole edit machinery.
 *
 * Where it mounts:
 *   - In the PARENT document (the editor shell), not the iframe doc.
 *   - The iframe re-mounts on every srcdoc swap (SSE reload). A toolbar
 *     in the iframe would need re-attachment per load. Parent doc is
 *     stable across reloads.
 *   - Position is computed: editing element bounds (in iframe coord
 *     space) → mapped through iframe.getBoundingClientRect() into
 *     parent viewport coords → placed at top - 36px above the host.
 *   - If the natural position would clip past the top viewport edge,
 *     the toolbar flips below the host (top + host.height + 8).
 *
 * Trigger semantics:
 *   - Visible when (a) selection range non-empty inside the host, OR
 *     (b) caret has been idle (no input/keydown/mousedown) for 100ms
 *     after edit-start. The idle path matters for "I want to format
 *     the next character I type" muscle memory.
 *   - Hidden when edit ends, when selection escapes the host, or when
 *     focus leaves the iframe contenteditable.
 *
 * Format buttons:
 *   - Bold   — wraps/unwraps <strong> via document.execCommand('bold')
 *   - Italic — same with 'italic'
 *   - Link   — prompts for URL via inline input replacing the toolbar
 *     contents; on submit, execCommand('createLink', false, url).
 *
 * execCommand is deprecated but supported in every browser we ship to.
 * The ergonomic alternative (manual Range manipulation + DOM insertion
 * + selection restore) is ~150 lines of code and several browser bugs
 * worth of testing. We're not in a position to fight that battle for
 * Bold/Italic/Link in 2026.
 */

export interface MiniToolbarOptions {
  parentDoc: Document;
  iframe: HTMLIFrameElement;
  /** Idle-to-show threshold when there's no active selection. */
  idleShowMs?: number;
}

export interface MiniToolbarController {
  /** Mount toolbar over the editing host. Idempotent — repeat calls retarget. */
  show(host: HTMLElement): void;
  hide(): void;
  /** Recompute position from current host bounds. Cheap; safe to call on mousemove/scroll. */
  reposition(): void;
  /** Forward a keystroke that may be a format hotkey (Cmd+B / Cmd+I / Cmd+K). Returns true if consumed. */
  handleHotkey(e: KeyboardEvent): boolean;
  /** Forward selection state — empty range starts the idle timer; non-empty cancels it and shows. */
  onSelectionChanged(host: HTMLElement, range: Range | null): void;
  destroy(): void;
}

const TOOLBAR_HEIGHT = 32;
const TOOLBAR_GAP = 8;

const buttonHTML = (label: string, key: string, hint: string): string =>
  `<button type="button" data-rfd-mt-action="${key}" title="${hint}" `
  + `style="background:transparent;border:none;cursor:pointer;`
  + `color:#e6e8ef;font-size:13px;font-weight:600;padding:0 10px;`
  + `height:100%;border-radius:4px;transition:background 80ms;" `
  + `onmouseover="this.style.background='rgba(255,255,255,0.08)'" `
  + `onmouseout="this.style.background='transparent'">${label}</button>`;

export function createMiniToolbar(opts: MiniToolbarOptions): MiniToolbarController {
  const { parentDoc, iframe } = opts;
  const idleMs = opts.idleShowMs ?? 100;
  let root: HTMLDivElement | null = null;
  let host: HTMLElement | null = null;
  let visible = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const ensureRoot = (): HTMLDivElement => {
    if (root) return root;
    const el = parentDoc.createElement('div');
    el.className = 'rfd-mini-toolbar';
    el.setAttribute('data-rfd-mini-toolbar', '1');
    el.style.cssText = [
      'position:fixed',
      'display:none',
      'align-items:center',
      'gap:2px',
      'height:' + TOOLBAR_HEIGHT + 'px',
      'padding:0 4px',
      'background:#1a1d24',
      'border:1px solid rgba(255,255,255,0.08)',
      'border-radius:6px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.32)',
      'z-index:1000',
      'font-family:-apple-system,system-ui,sans-serif',
    ].join(';');
    el.innerHTML =
      buttonHTML('B', 'bold', 'Bold (⌘B)')
      + buttonHTML('I', 'italic', 'Italic (⌘I)')
      + buttonHTML('🔗', 'link', 'Link (⌘K)');
    el.addEventListener('mousedown', (e) => {
      // Prevent blur of the iframe contenteditable when clicking
      // a toolbar button — otherwise edit mode ends before the
      // execCommand fires.
      e.preventDefault();
    });
    el.addEventListener('click', (e) => {
      const tgt = e.target as HTMLElement;
      const btn = tgt.closest('[data-rfd-mt-action]') as HTMLElement | null;
      if (!btn) return;
      const action = btn.getAttribute('data-rfd-mt-action');
      if (!action) return;
      runAction(action);
    });
    parentDoc.body.appendChild(el);
    root = el;
    return el;
  };

  const runAction = (action: string) => {
    const doc = iframe.contentDocument;
    if (!doc) return;
    if (action === 'bold') {
      doc.execCommand('bold');
    } else if (action === 'italic') {
      doc.execCommand('italic');
    } else if (action === 'link') {
      // Inline URL prompt — replace toolbar contents with input, hit
      // Enter to apply, Escape to cancel.
      const r = ensureRoot();
      const prevHTML = r.innerHTML;
      r.innerHTML = '';
      const input = parentDoc.createElement('input');
      input.type = 'text';
      input.placeholder = 'https://…';
      input.style.cssText =
        'background:transparent;border:none;outline:none;color:#e6e8ef;'
        + 'font-size:13px;padding:0 8px;height:100%;width:200px;';
      r.appendChild(input);
      input.focus();
      const restore = () => { r.innerHTML = prevHTML; };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const url = input.value.trim();
          if (url) doc.execCommand('createLink', false, url);
          restore();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          restore();
        }
      });
      input.addEventListener('blur', restore, { once: true });
    }
  };

  const computePosition = (h: HTMLElement): { left: number; top: number } => {
    const hostRect = h.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    // Canvas wrapper applies CSS transform (zoom + pan) — iframe's visual
    // bbox in parent doc reflects that, but host bounds are in the iframe
    // document's UNTRANSFORMED coord space. Compute the effective scale
    // from iframe natural width vs visual width and apply it to host
    // coords. Without this, the toolbar lands at scene-coord positions
    // (often well off-screen — canvases run 1440×5000+).
    const naturalW = iframe.contentDocument?.documentElement?.clientWidth ?? iframeRect.width;
    const naturalH = iframe.contentDocument?.documentElement?.clientHeight ?? iframeRect.height;
    const scaleX = naturalW > 0 ? iframeRect.width / naturalW : 1;
    const scaleY = naturalH > 0 ? iframeRect.height / naturalH : 1;
    const rootEl = ensureRoot();
    const tbWidth = rootEl.offsetWidth || 120;
    const viewportW = parentDoc.defaultView?.innerWidth ?? 1440;
    const visLeft = iframeRect.left + hostRect.left * scaleX;
    const visTop = iframeRect.top + hostRect.top * scaleY;
    const visBottom = iframeRect.top + hostRect.bottom * scaleY;
    const visWidth = hostRect.width * scaleX;
    const absLeft = visLeft + (visWidth - tbWidth) / 2;
    const absTopAbove = visTop - TOOLBAR_HEIGHT - TOOLBAR_GAP;
    const absTopBelow = visBottom + TOOLBAR_GAP;
    const left = Math.max(8, Math.min(absLeft, viewportW - tbWidth - 8));
    const top = absTopAbove < 8 ? absTopBelow : absTopAbove;
    return { left, top };
  };

  const reposition = () => {
    if (!visible || !host || !root) return;
    const { left, top } = computePosition(host);
    root.style.left = left + 'px';
    root.style.top = top + 'px';
  };

  const show = (h: HTMLElement) => {
    host = h;
    const r = ensureRoot();
    r.style.display = 'flex';
    visible = true;
    reposition();
  };

  const hide = () => {
    if (!root) return;
    root.style.display = 'none';
    visible = false;
    host = null;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  };

  const onSelectionChanged = (h: HTMLElement, range: Range | null) => {
    host = h;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (range && !range.collapsed) {
      show(h);
      return;
    }
    // Caret-only — start idle timer for show.
    idleTimer = setTimeout(() => { if (host) show(host); }, idleMs);
  };

  const handleHotkey = (e: KeyboardEvent): boolean => {
    if (!host) return false;
    const meta = e.metaKey || e.ctrlKey;
    if (!meta || e.altKey) return false;
    if (e.key === 'b' || e.key === 'B') {
      e.preventDefault();
      runAction('bold');
      return true;
    }
    if (e.key === 'i' || e.key === 'I') {
      e.preventDefault();
      runAction('italic');
      return true;
    }
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      runAction('link');
      return true;
    }
    return false;
  };

  const destroy = () => {
    hide();
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  };

  return { show, hide, reposition, handleHotkey, onSelectionChanged, destroy };
}
