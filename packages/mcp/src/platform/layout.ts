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
  </div>
  <script src="/platform/app.js?v=${ASSET_VERSION}"></script>
  <script type="module" src="/platform/viewport.js?v=${ASSET_VERSION}"></script>
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

  // 3. Library — was "Components". A library is instantly intelligible
  //    as "collection of reusable pieces I can drop in", which is what
  //    this actually is. Internal types, APIs, and MCP tool names still
  //    use "component" — only the human-facing label changed.
  parts.push(`<a class="side-nav-item ${active === 'components' ? 'active' : ''}" href="/platform/components">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
    </svg>
    <span>Library</span>
  </a>`);

  // 4. Blocks — section template library (hero, features, pricing, etc.)
  parts.push(`<a class="side-nav-item ${active === 'blocks' ? 'active' : ''}" href="/platform/blocks">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/>
    </svg>
    <span>Blocks</span>
  </a>`);

  // 4b. Constructor — block-based page builder
  parts.push(`<a class="side-nav-item ${active === 'blocks' ? '' : ''}" href="/platform/constructor">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" stroke-width="1.4"/>
      <path d="M2 6h12M2 10h12" stroke="currentColor" stroke-width="1.2" opacity="0.5"/>
    </svg>
    <span>Constructor</span>
  </a>`);

  // 5. Recipes — was "Macros". "Macro" reads as emacs/Excel jargon and
  //    doesn't hint at what the thing does. A recipe is a sequence of
  //    steps you apply to remake something — that matches exactly what
  //    these are (ordered op templates with role placeholders that
  //    replay against any scene). Internal file names + MCP tool actions
  //    (save_macro, apply_macro) stay unchanged.
  parts.push(`<a class="side-nav-item ${active === 'macros' ? 'active' : ''}" href="/platform/macros">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 2h6l2 2v10H4V2z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M6 6h4M6 9h4M6 12h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
    <span>Recipes</span>
  </a>`);

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
