/**
 * Platform — shared layout shell.
 *
 * Header holds only file-level actions (undo/redo, history, export,
 * theme, edit). Navigation lives in the sidebar — one source of
 * truth, no duplicated nav links in the header. The wordmark is set
 * in mono (the mono IS the mark). Two surface levels. Warm paper
 * canonical.
 *
 * CSS and JS are INLINED into every HTML response (not served as
 * separate /platform/style.css + /platform/app.js assets). The HTML
 * itself is served with Cache-Control: no-store, so the browser
 * refreshes the whole document every time — which means the inlined
 * styles + scripts are always the version the sidecar currently
 * serves. No cache invalidation dance, no version tokens needed.
 * The /platform/style.css and /platform/app.js routes still exist for
 * backward compat but the shell does not reference them.
 */

// PLATFORM_CSS and PLATFORM_JS are served as external files, not
// inlined, so strict CSP (injected by some localhost antivirus tools
// like Kaspersky) does not block them. External same-origin scripts
// are allowed by default CSP.

export interface ShellProps {
  title?: string;
  /** Optional scene slug — enables scene-scoped features (data-scene attr on .app). */
  sceneSlug?: string;
  /** Sub-crumb under the wordmark (e.g. current scene name). */
  crumb?: string;
  /** Optional dim meta next to the crumb (e.g. "1440 × 1080") */
  crumbMeta?: string;
  /** Main content region — raw HTML. */
  main: string;
  /** Optional sidebar content. When absent, sidebar column collapses. */
  sidebar?: string;
  /** Optional right panel content (the activity stream on scene pages). */
  rightPanel?: string;
  /** Optional brand list — right side of header, plain text only. */
  brands?: string[];
  activeBrand?: string;
  /** Optional audit score (0-100) → renders as a status pill. */
  auditScore?: number;
  /** Optional agent status → renders as a status pill. */
  agentStatus?: 'idle' | 'busy' | 'error' | 'proposing';
  /** When true, body has no sidebar/right panel — used for landing/empty states. */
  wide?: boolean;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Font loading strategy:
//  1. dns-prefetch + preconnect so the TCP/TLS handshake to Google's
//     CDN happens in parallel with HTML parsing instead of serially
//     when the stylesheet link is encountered.
//  2. `display=swap` makes text render immediately with the system
//     fallback, then swap to the web font when downloaded — no blank
//     text while fonts load.
//  3. NO inline onload handlers — strict CSP blocks them. The cost of
//     skipping the async media-print trick is a ~200ms CSS download
//     on first load; acceptable tradeoff for CSP safety.
const FONT_LINK = `<link rel="dns-prefetch" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">`;

// Cache-busting token generated once at module load. Every sidecar
// restart produces a new token, so the browser treats the CSS/JS
// URLs as brand-new URLs and forgets any prior cached version. This
// is the ONE thing that actually defeats aggressive browser cache
// during rapid iteration.
const ASSET_VERSION = Date.now().toString(36);

export function renderShell(props: ShellProps): string {
  const title = escape(props.title ?? 'reframe');

  // Crumbs — current scene name + optional dim meta (e.g. dimensions).
  // Meta is the place that used to live under the viewport as a
  // standalone label; now it's a subtle subtitle in the header.
  const crumbsEl = props.crumb
    ? `<div class="crumbs"><span class="crumb-sep">/</span><span class="crumb">${escape(props.crumb)}</span>${props.crumbMeta ? `<span class="crumb-meta">${escape(props.crumbMeta)}</span>` : ''}</div>`
    : '';

  // Status pills removed per design cleanup — brand, audit, and agent
  // status are no longer shown in the header. Brand is surfaced on the
  // scene canvas itself; audit lives in the inspect panel; agent status
  // was never actionable UI noise.
  const auditEl = '';
  const agentEl = '';
  const brandEl = '';

  const sidebarEl = props.sidebar
    ? `<aside class="sidebar">${props.sidebar}</aside>`
    : '';
  const rightEl = props.rightPanel
    ? `<aside class="right">${props.rightPanel}</aside>`
    : '';

  const bodyClass = props.wide
    ? 'body solo'
    : !props.sidebar && !props.rightPanel
      ? 'body solo'
      : !props.sidebar
        ? 'body no-sidebar'
        : props.rightPanel
          ? 'body with-right'
          : 'body';

  // Top-center macro-dropdowns — only on scene pages. The 4 verbs that
  // wrap our unique engine capability: Generate (vary / regenerate /
  // responsive), Modify (rebrand / scale spacing / radius / shadows /
  // rotate colors / typography / iterate), Preview (viewport switch +
  // QR + new tab), More (export / save / brand-pick / settings).
  //
  // Positioned absolutely in the center so it doesn't push the
  // right-side chrome around when it changes width.
  const macroDropdownsEl = props.sceneSlug ? renderMacroDropdowns() : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <!-- Theme pre-apply: external script so strict CSP doesn't block it.
       Runs synchronously in <head> before the body renders → no FOUC. -->
  <script src="/platform/theme-init.js?v=${ASSET_VERSION}"></script>
  ${FONT_LINK}
  <link rel="stylesheet" href="/platform/style.css?v=${ASSET_VERSION}">
</head>
<body>
  <div class="app" ${props.sceneSlug ? `data-scene="${escape(props.sceneSlug)}"` : ''}>
    <header class="header">
      <a href="/platform" class="wordmark">refram<span class="e-final">e</span></a>
      ${crumbsEl}
      ${macroDropdownsEl}
      <span class="spacer"></span>
      ${props.sceneSlug ? `
      <!-- Brand picker — global toolbar for instant rebrand -->
      <div class="brand-picker-dropdown" data-brand-picker style="position:relative">
        <button class="header-btn" title="Switch brand" data-brand-picker-btn style="display:flex;align-items:center;gap:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:var(--accent);flex-shrink:0"></span>
          <span style="font-size:12px" data-brand-picker-label>${escape(props.activeBrand ?? 'No brand')}</span>
        </button>
        <div class="brand-picker-menu hidden" data-brand-picker-menu style="position:absolute;top:100%;right:0;margin-top:6px;min-width:180px;padding:6px;background:var(--surface-elevated);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:100;display:flex;flex-direction:column;gap:2px">
          <div style="padding:4px 8px;font-size:10px;font-weight:500;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em">Apply brand</div>
        </div>
      </div>
      <div class="header-sep"></div>
      <!-- Export — the most common "I'm done, give me the file" action. -->
      <div class="export-dropdown" data-export-dropdown>
        <button class="header-btn export-btn" title="Export">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3M3 11h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span>Export</span>
        </button>
        <div class="export-menu hidden">
          <button data-format="html">HTML</button>
          <button data-format="react">React TSX</button>
          <button data-format="svg">SVG</button>
          <button data-format="png">PNG</button>
          <button data-format="pdf">PDF</button>
          <button data-format="animated_html">Animated HTML</button>
          <button data-format="lottie">Lottie</button>
          <button data-format="site">Site bundle</button>
        </div>
      </div>
      <div class="header-sep"></div>
      <!-- History dropdown — Git-style revision list. Undo/redo and Edit
           toggle moved to the floating canvas-tools palette (bottom-center)
           so the header stays focused on file-level actions. -->
      <div class="history-dropdown" data-history-dropdown>
        <button class="header-btn history-btn" title="History (revision log)">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
            <path d="M7 4v3l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>History</span>
          <span class="history-badge hidden" data-history-count>0</span>
        </button>
        <div class="history-panel hidden" data-history-panel>
          <div class="history-panel-head">
            <div class="history-panel-title">Revision history</div>
            <div class="history-panel-sub" data-history-sub>Loading\u2026</div>
          </div>
          <div class="history-panel-list" data-history-list>
            <div class="history-empty">No edits yet.</div>
          </div>
          <div class="history-panel-foot">
            <button class="history-save-btn" data-action="history-save" title="Create a named save point \u2014 you can return to this state later">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 2h7l2 2v8H3V2zM5 2v3h4V2M5 8h4" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
              Save current state
            </button>
            <button class="history-clear-btn" data-action="history-clear" title="Clear all revisions \u2014 returns scene to fresh-compile state">Clear</button>
          </div>
        </div>
      </div>
      <div class="header-sep"></div>
      ` : ''}
      ${brandEl}
      ${auditEl}
      ${agentEl}
      <button class="theme-toggle" data-theme-toggle title="Toggle theme" aria-label="Toggle theme">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path class="t-sun"  d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2v1M8 2v1M13 8h1M2 8h1M11.5 4.5l.7-.7M3.8 12.2l.7-.7M11.5 11.5l.7.7M3.8 3.8l.7.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <path class="t-moon" d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" fill="none"/>
        </svg>
      </button>
    </header>
    <div class="${bodyClass}">
      ${sidebarEl}
      <main class="main">${props.main}</main>
      ${rightEl}
      <!-- Drag handles for resizable panels. Positioned absolutely on
           the inner edges of the sidebar and right panel. Hidden on
           no-sidebar/solo layouts via CSS. -->
      ${props.sidebar ? '<div class="panel-resize panel-resize-sidebar" data-panel-resize="sidebar"></div>' : ''}
      ${props.rightPanel ? '<div class="panel-resize panel-resize-right" data-panel-resize="right"></div>' : ''}
    </div>
    ${props.sceneSlug ? renderBottomChat() : ''}
  </div>
  <script type="importmap">{"imports":{"canvaskit-wasm":"/platform/vendor/canvaskit-shim.js","canvaskit-wasm/full":"/platform/vendor/canvaskit-shim.js"}}</script>
  <script src="/platform/app.js?v=${ASSET_VERSION}"></script>
  <script type="module" src="/platform/viewport-init.js?v=${ASSET_VERSION}"></script>
</body>
</html>`;
}

// ─── Sidebar — single navigation source of truth ───────────

export interface SidebarSceneItem {
  slug: string;
  name: string;
  active?: boolean;
}
export interface SidebarComponentItem { slug: string; name: string; }
export interface SidebarMacroItem { slug: string; name: string; }

export interface SidebarOpts {
  scenes?: SidebarSceneItem[];
  components?: SidebarComponentItem[];
  macros?: SidebarMacroItem[];
  current?: 'home' | 'scene' | 'project-canvas' | 'components' | 'design-system' | 'macros' | 'blocks';
  activeBrand?: string;
}

const GENERIC_TAGS = new Set(['div', 'span', 'section', 'main', 'header', 'footer', 'article', 'aside', 'nav']);
void GENERIC_TAGS; // reserved for future sidebar display-name helpers

/**
 * Unified sidebar — same structure on every page.
 *
 * Order (top → bottom, fixed, never reshuffled):
 *   1. Home            universal escape hatch
 *   2. Brandbook       with active brand chip shown as sub-item
 *   3. Components      registry
 *   4. Macros          registry
 *   ─────────
 *   5. Layers          scene-scoped tree, only on scene/canvas pages
 *
 * This is the single source of truth — every page that wants a
 * sidebar calls this. No more duplicate nav-sidebar definitions in
 * dashboard.ts or project-canvas.ts.
 */
export function renderSidebar(opts: SidebarOpts): string {
  const parts: string[] = [];
  const active = opts.current;
  const brandLabel = opts.activeBrand || 'No brand';
  const inProject = active === 'project-canvas';

  // Note: interaction tools (select/move/lasso) used to live here —
  // they're now rendered as a floating bottom-center toolbar over the
  // viewport via renderCanvasTools(). Sidebar stays nav-only.

  parts.push(`<nav class="side-nav">`);

  // 1. Home (or "← Projects" when on a project canvas — more intuitive
  //    back affordance for the scoped context).
  const homeLabel = inProject ? 'Projects' : 'Home';
  const homeArrow = inProject
    ? '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="home-back-arrow" aria-hidden="true"><path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '';
  parts.push(`<a class="side-nav-item ${active === 'home' ? 'active' : ''}${inProject ? ' is-back' : ''}" href="/platform">
    ${homeArrow}
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 7l6-5 6 5v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
    <span>${homeLabel}</span>
  </a>`);

  // 2. Brandbook + active brand chip
  parts.push(`<a class="side-nav-item ${active === 'design-system' ? 'active' : ''}" href="/platform/design-system">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.4"/>
      <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" stroke-width="1.4"/>
    </svg>
    <span>Brandbook</span>
  </a>`);
  parts.push(`<div class="side-nav-sub">
    <span class="brand-dot"></span>
    <span class="brand-label">${escape(brandLabel)}</span>
    <button class="brand-switch-btn-inline" data-action="switch-brand" title="Switch brand">Switch</button>
  </div>`);

  parts.push(`</nav>`);

  // 6. Layers — scene-scoped, only on scene/canvas pages.
  if (active === 'scene') {
    parts.push(`<div class="sidebar-section layers-section">
      <div class="sidebar-title">Layers</div>
      <div class="layers-tree" data-layers-tree>
        <div class="sidebar-empty">Loading\u2026</div>
      </div>
    </div>`);
  }

  return parts.join('');
}

/**
 * Floating interaction tool palette — rendered INSIDE the viewport
 * frame (scene page or canvas), positioned absolute bottom-center.
 * Same 3 verbs as before (Select, Move, Lasso) but now living over
 * the content area instead of crammed into the top header or sidebar.
 * Figma-style: the tools float over the workspace, always reachable.
 */
export function renderCanvasTools(): string {
  return `<div class="canvas-tools-float" role="toolbar" aria-label="Tools">
    <button class="tool-mode active" data-tool-mode="select" title="Select (V)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1l9 6.5-4.5 1.5-2 4.5L3 1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
    </button>
    <button class="tool-mode" data-tool-mode="move" title="Move (M)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12M8 2l-2 2M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    </button>
    <button class="tool-mode" data-tool-mode="lasso" title="Lasso (L)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 2"/></svg>
    </button>
    <div class="tool-sep"></div>
    <!-- Undo/redo — were in the top header, moved here so they sit next
         to the other interaction tools and leave the header clean. -->
    <button class="tool-action" data-action="undo" title="Undo (\u2318Z)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 6L2 8.5L5 11M2.5 8.5H11a3 3 0 010 6H9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="tool-action" data-action="redo" title="Redo (\u2318\u21E7Z)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 6l3 2.5L11 11M13.5 8.5H5a3 3 0 000 6H7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="tool-sep"></div>
    <!-- Edit toggle — in edit mode clicks inside any artboard select
         the clicked INode and populate the right panel's Properties
         tab. Hover/select outlines are no-ops on canvas (they need a
         per-scene SVG overlay), but the core "pick a node, see its
         props, edit them" flow works. bindPreviewBridge routes clicks
         to the right artboard's sceneId via event.source → iframe
         parent .canvas-artboard[data-scene-id]. -->
    <button class="tool-action edit-tool" data-edit-toggle title="Toggle edit mode (E)" aria-label="Toggle edit mode">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 1.5L14.5 4L5.5 13L2 14L3 10.5L12 1.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/></svg>
    </button>
  </div>`;
}

// ─── Activity stream — replaces queue + draft + timeline + node-info ─

/**
 * Renders the right-panel activity stream. Intent items become typed
 * cards in a single chronological feed. The text input at the bottom
 * is the unified entry point for ad-hoc intents (replaces the old
 * "Draft Intent" composer).
 */
export function renderActivityStream(opts: {
  intents: any[];
  agentStatus?: string;
  sceneName?: string;
}): string {
  const intents = opts.intents ?? [];

  const list = intents.length === 0
    ? `<div class="stream-empty">
        <div class="headline">No activity yet.</div>
        <div class="body">Tell the agent what to do, or ask about a node in the preview.</div>
      </div>`
    : intents.map(renderStreamCard).join('');

  return `<div class="stream">
    <div class="stream-head">
      <div class="stream-head-row">
        <div class="label">Activity</div>
        <button class="stream-clear-btn" data-action="clear-queue" title="Clear all active intents">Clear</button>
      </div>
      <div class="meta">${escape(opts.sceneName ?? 'this scene')} · ${intents.length} item${intents.length === 1 ? '' : 's'}</div>
    </div>
    <div class="stream-list">${list}</div>
    <div class="stream-input">
      <input type="text" placeholder="Tell the agent what to do next…" />
    </div>
  </div>`;
}

function renderStreamCard(intent: any): string {
  const id = escape(String(intent.id ?? ''));
  const status = escape(String(intent.status ?? 'draft'));
  const partsDesc = (intent.parts || [])
    .map((p: any) => describeShort(p))
    .filter(Boolean)
    .slice(0, 4)
    .join(' · ');

  const headTitle = statusTitle(status);
  const actions = renderCardActions(intent);

  return `<div class="stream-card ${status}" data-id="${id}">
    <div class="head">
      <span>${headTitle}</span>
      <span class="id">${escape(String(intent.id ?? '').slice(-8))}</span>
    </div>
    ${partsDesc ? `<div class="body">${escape(partsDesc)}</div>` : ''}
    ${actions ? `<div class="actions">${actions}</div>` : ''}
  </div>`;
}

function statusTitle(status: string): string {
  switch (status) {
    case 'draft':      return 'Draft intent';
    case 'queued':     return 'Queued';
    case 'processing': return 'Agent thinking…';
    case 'proposed':   return 'Proposal — review';
    case 'accepted':   return 'Accepted';
    case 'rejected':   return 'Rejected';
    case 'refined':    return 'Refined';
    case 'archived':   return 'Archived';
    default:           return status;
  }
}

function renderCardActions(intent: any): string {
  const id = escape(String(intent.id ?? ''));
  if (intent.status === 'draft') {
    return `<button class="btn btn-primary btn-sm" data-action="commit" data-id="${id}">Commit</button>
            <button class="btn btn-ghost btn-sm" data-action="discard" data-id="${id}">Discard</button>`;
  }
  if (intent.status === 'proposed') {
    return `<button class="btn btn-primary btn-sm" data-action="accept" data-id="${id}">Accept</button>
            <button class="btn btn-ghost btn-sm" data-action="reject" data-id="${id}">Reject</button>`;
  }
  if (intent.status === 'queued') {
    return `<button class="btn btn-secondary btn-sm" data-action="process" data-id="${id}">Process</button>`;
  }
  return '';
}

function describeShort(p: any): string {
  if (!p) return '';
  switch (p.kind) {
    case 'select':       return `${(p.nodes || []).length} node(s)`;
    case 'text':         return `"${(p.value || '').slice(0, 40)}"`;
    case 'annotate':     return `${p.shape} ${(p.points || []).length}pts`;
    case 'ref-brand':    return `brand: ${p.brand}`;
    case 'ref-image':    return `image`;
    case 'apply-macro':  return `macro: ${p.macro}`;
    case 'direction':    return p.value;
    case 'degree':       return p.value;
    case 'preserve':     return `keep: ${(p.keys || []).join(',')}`;
    case 'constraint':   return `rule: ${p.rule}`;
    case 'move':         return p.delta ? `move ${p.delta.dx},${p.delta.dy}` : 'move';
    case 'undo':         return `undo ${p.steps} step(s)`;
    default:             return p.kind;
  }
}

// ─── Top-center macro-dropdowns ─────────────────────────────
//
// 4 verbs that wrap our unique engine capability, Stitch-style.
// Each opens a dropdown with actions that hit existing platform APIs:
//   Generate  → /platform/api/variations/grid (vary) + agent prompts
//   Modify    → /platform/api/variations/apply (scale *, rotate, mode)
//              + /platform/api/rebrand/apply (Rebrand from DESIGN.md)
//   Preview   → local viewport class swap (desktop/tablet/mobile)
//   More      → export / save / brand-pick / settings shortcuts
//
// The shell renders the DOM; bindMacroDropdowns() in 140-toolbar.js
// wires click handlers. Kept inert here so markup stays grep-able.

function caretSvg(): string {
  return '<svg class="macro-caret" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 4L5 6.5 7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function chevronSvg(): string {
  return '<svg class="submenu-caret" width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M4 2.5L6.5 5 4 7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function hotkeyEl(hk: string): string {
  return hk ? `<span class="macro-hotkey">${escape(hk)}</span>` : '';
}

function renderMacroItem(opts: { action: string; label: string; hotkey?: string; data?: Record<string, string>; badge?: string; disabled?: boolean }): string {
  const extra = opts.data ? Object.entries(opts.data).map(([k, v]) => `data-${k}="${escape(v)}"`).join(' ') : '';
  const badge = opts.badge ? `<span class="macro-badge">${escape(opts.badge)}</span>` : '';
  const dis = opts.disabled ? 'disabled' : '';
  return `<button class="macro-item" data-macro-action="${escape(opts.action)}" ${extra} ${dis}>
    <span class="macro-label">${escape(opts.label)}${badge}</span>
    ${hotkeyEl(opts.hotkey ?? '')}
  </button>`;
}

function renderSubmenu(label: string, icon: string, items: string): string {
  return `<div class="macro-submenu">
    <button class="macro-item macro-submenu-trigger">
      <span class="macro-label"><span class="macro-icon">${icon}</span>${escape(label)}</span>
      ${chevronSvg()}
    </button>
    <div class="macro-submenu-panel">${items}</div>
  </div>`;
}

export function renderMacroDropdowns(): string {
  // ─── Generate ──────────────────────────────────────────────
  const generateMenu = [
    renderMacroItem({ action: 'variants',   label: '✨ Variants',         hotkey: '⇧V' }),
    renderMacroItem({ action: 'regenerate', label: '🔄 Regenerate',       hotkey: '⇧R' }),
    renderMacroItem({ action: 'responsive', label: '📱 Responsive set',   hotkey: '⇧A' }),
    '<div class="macro-sep"></div>',
    renderMacroItem({ action: 'heatmap',    label: '🔮 Predict heatmap',  badge: 'Soon', disabled: true }),
  ].join('');

  // ─── Modify ────────────────────────────────────────────────
  const densityItems = [
    renderMacroItem({ action: 'variation', label: 'Compact  −20%', data: { kind: 'density', value: '0.8' } }),
    renderMacroItem({ action: 'variation', label: 'Compact  −10%', data: { kind: 'density', value: '0.9' } }),
    renderMacroItem({ action: 'variation', label: 'Normal',        data: { kind: 'density', value: '1.0' } }),
    renderMacroItem({ action: 'variation', label: 'Spacious +10%', data: { kind: 'density', value: '1.1' } }),
    renderMacroItem({ action: 'variation', label: 'Spacious +20%', data: { kind: 'density', value: '1.2' } }),
  ].join('');
  const radiusItems = [
    renderMacroItem({ action: 'variation', label: 'Sharp (0px)',    data: { kind: 'radius', value: 'sharp' } }),
    renderMacroItem({ action: 'variation', label: 'Editorial (2–4)', data: { kind: 'radius', value: 'editorial' } }),
    renderMacroItem({ action: 'variation', label: 'Soft (×1.5)',    data: { kind: 'radius', value: 'soft' } }),
    renderMacroItem({ action: 'variation', label: 'Pill (9999)',    data: { kind: 'radius', value: 'pill' } }),
  ].join('');
  const shadowsItems = [
    renderMacroItem({ action: 'variation', label: 'Flat',     data: { kind: 'shadows', value: 'flat' } }),
    renderMacroItem({ action: 'variation', label: 'Subtle',   data: { kind: 'shadows', value: 'subtle' } }),
    renderMacroItem({ action: 'variation', label: 'Normal',   data: { kind: 'shadows', value: 'normal' } }),
    renderMacroItem({ action: 'variation', label: 'Dramatic', data: { kind: 'shadows', value: 'dramatic' } }),
  ].join('');
  const colorsItems = [
    renderMacroItem({ action: 'variation', label: 'Invert accent (primary ↔ accent)', data: { kind: 'colorRotation', value: 'invert-accent' } }),
    renderMacroItem({ action: 'variation', label: 'Invert mode (bg ↔ text)',           data: { kind: 'colorRotation', value: 'invert-mode' } }),
  ].join('');
  const typoItems = [
    renderMacroItem({ action: 'variation', label: 'Dramatic (max contrast)',   data: { kind: 'typography', value: 'dramatic' } }),
    renderMacroItem({ action: 'variation', label: 'Flat (all 500)',            data: { kind: 'typography', value: 'flat' } }),
    renderMacroItem({ action: 'variation', label: 'Editorial (tight headings)', data: { kind: 'typography', value: 'editorial' } }),
    renderMacroItem({ action: 'variation', label: 'Technical (wide tracking)', data: { kind: 'typography', value: 'technical' } }),
    renderMacroItem({ action: 'variation', label: 'Friendly (rounded)',        data: { kind: 'typography', value: 'friendly' } }),
  ].join('');

  const modifyMenu = [
    renderMacroItem({ action: 'rebrand',      label: '🎨 Rebrand…',        hotkey: '⇧B' }),
    renderMacroItem({ action: 'toggle-theme', label: '🌓 Toggle theme',    hotkey: '⇧T' }),
    '<div class="macro-sep"></div>',
    renderSubmenu('Scale spacing',   '📏', densityItems),
    renderSubmenu('Corner radius',   '🔘', radiusItems),
    renderSubmenu('Shadows',         '☁',  shadowsItems),
    renderSubmenu('Rotate colors',   '🎭', colorsItems),
    renderSubmenu('Typography',      '🔤', typoItems),
    '<div class="macro-sep"></div>',
    renderMacroItem({ action: 'iterate-fix',  label: '🔧 Iterate · Fix audit', hotkey: '⇧I' }),
  ].join('');

  // ─── Preview ───────────────────────────────────────────────
  const previewMenu = [
    renderMacroItem({ action: 'viewport', label: '🖥 Desktop  1440', data: { vp: 'desktop' } }),
    renderMacroItem({ action: 'viewport', label: '📲 Tablet   768',  data: { vp: 'tablet' } }),
    renderMacroItem({ action: 'viewport', label: '📱 Mobile   390',  data: { vp: 'mobile' } }),
    '<div class="macro-sep"></div>',
    renderMacroItem({ action: 'new-tab',  label: '🆕 Open in new tab', hotkey: '⇧P' }),
    renderMacroItem({ action: 'qr',       label: '📋 Show QR',         badge: 'Soon', disabled: true }),
  ].join('');

  // ─── More ──────────────────────────────────────────────────
  const moreMenu = [
    renderMacroItem({ action: 'export-html',   label: '📄 Export HTML',    data: { format: 'html' } }),
    renderMacroItem({ action: 'export-react',  label: '⚛ Export React',    data: { format: 'react' } }),
    renderMacroItem({ action: 'export-png',    label: '🖼 Export PNG',     data: { format: 'png' } }),
    renderMacroItem({ action: 'export-svg',    label: '🖼 Export SVG',     data: { format: 'svg' } }),
    renderMacroItem({ action: 'export-pdf',    label: '📄 Export PDF',     data: { format: 'pdf' } }),
    renderMacroItem({ action: 'export-lottie', label: '🎬 Export Lottie',  data: { format: 'lottie' } }),
    renderMacroItem({ action: 'export-site',   label: '🌐 Export Site',    data: { format: 'site' } }),
    '<div class="macro-sep"></div>',
    renderMacroItem({ action: 'pick-brand', label: '🎯 Pick brand…' }),
    renderMacroItem({ action: 'settings',   label: '⚙ Settings', disabled: true, badge: 'Soon' }),
  ].join('');

  const makeDropdown = (key: string, icon: string, label: string, menuInner: string) => `
    <div class="macro-group" data-macro-dropdown="${key}">
      <button class="macro-btn" data-macro-btn="${key}" title="${escape(label)}">
        <span class="macro-icon">${icon}</span>
        <span>${escape(label)}</span>
        ${caretSvg()}
      </button>
      <div class="macro-menu hidden" data-macro-menu="${key}">${menuInner}</div>
    </div>`;

  return `<div class="macro-dropdowns" data-macro-dropdowns>
    ${makeDropdown('generate', '✨', 'Generate', generateMenu)}
    ${makeDropdown('modify',   '✎',  'Modify',   modifyMenu)}
    ${makeDropdown('preview',  '👁', 'Preview',  previewMenu)}
    ${makeDropdown('more',     '⋯',  'More',     moreMenu)}
  </div>`;
}

// ─── Bottom chat bar ─────────────────────────────────────────
//
// Docked glass pill at the viewport bottom, scene pages only. Holds:
//   · chips row (scope: selected node, active brand, viewport)
//   · textarea prompt input
//   · mic button (voice capture, wired in step 7)
//   · send button
//
// Input delegates to the existing sidebar agent via [data-agent-input]
// + [data-agent-send] so streaming / tool-rendering behaviour stays in
// one place. The chip scope is prepended to the prompt text as a
// single structured line ("[Scope: hero section · brand: Stripe · vp: desktop]")
// so Claude sees explicit context without any server-side prompt changes.
export function renderBottomChat(): string {
  return `<div class="bottom-chat" data-bottom-chat>
    <div class="bc-chips" data-bc-chips aria-label="Context chips"></div>
    <div class="bc-input-row">
      <button class="bc-mic" data-bc-mic title="Voice input (coming)" aria-label="Voice input">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="5" y="2" width="4" height="7" rx="2" stroke="currentColor" stroke-width="1.3"/>
          <path d="M3 7a4 4 0 0 0 8 0M7 11v1M5 12h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
      <textarea
        class="bc-input"
        data-bc-input
        rows="1"
        placeholder="Describe a change, ask about this scene, or paste a URL…"
        aria-label="Agent prompt"></textarea>
      <button class="bc-send" data-bc-send title="Send (⌘↵)" aria-label="Send">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>`;
}

// ─── Backwards-compat exports — old call sites are getting rewritten ─
// Keep these as no-op stubs so the build doesn't break while we migrate.

export function renderToolRibbon(): string { return ''; }
export function renderDraftPanel(_: any | null): string { return ''; }
export function renderQueuePanel(_: any[]): string { return ''; }

export interface Scene {
  id: string;
  slug?: string;
  name: string;
  width: number;
  height: number;
  nodes?: number;
  revision?: number;
  brand?: string;
}
