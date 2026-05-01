/**
 * Editor shell page — serves the CanvasKit editor as a standalone page.
 *
 * Visual style matches the platform (warm paper light / dark ink dark).
 * Layout: header (wordmark + actions) + sidebar (layers) + canvas + right panel.
 * Floating toolbar at bottom-center (tools + undo/redo).
 * No old platform scripts — editor bundle handles everything.
 *
 * Macro-dropdowns (Generate / Modify / Preview / More) + sectioned right-click
 * context menu + bottom agent chat are injected from layout.ts so the same
 * UI shows on /platform/project/:slug (this shell) and any legacy baseShell
 * scene page. `data-scene` on the root wrapper triggers the platform-ui.js
 * binders to run (they early-return without a scene attribute).
 */

import { renderMacroDropdowns, renderBottomChat } from '../layout.js';
import type { EditorBootPayload } from '../boot-payload.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * JSON for inline `<script>` contexts. Unlike JSON.stringify alone,
 * this escapes `</script>`, `<!--`, U+2028/U+2029, and forward slashes
 * in the closing tag so the payload can never break out of its own
 * script element, regardless of what sits in scene names / findings.
 */
function escapeJsonForScript(json: string): string {
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderEditorShell(options: {
  title?: string;
  sceneIds?: string;
  sceneSlug?: string;
  editorJsPath: string;
  fontsLink?: string;
  /** Inlined as `window.__REFRAME_BOOT__` — eliminates initial fetch waterfall. */
  boot?: EditorBootPayload;
}): string {
  const title = esc(options.title ?? 'reframe');
  const sceneAttr = options.sceneIds ? ` data-project-scenes="${esc(options.sceneIds)}"` : '';
  // `data-scene` on #app activates platform-ui.js binders (bindMacroDropdowns,
  // bindContextMenu, bindBottomChat). Without it they still register but the
  // top macro-dropdowns + bottom chat markup would be absent.
  const appSceneAttr = options.sceneSlug ? ` data-scene="${esc(options.sceneSlug)}"` : '';

  // Boot payload — inlined so init code reads it synchronously. One
  // script avoids the old waterfall (agent health, audit, tree,
  // annotations, tokens, root node/get — ~6 serial fetches on cold
  // load). Escape for script-safety: never trust scene names / audit
  // messages to be free of `</script` sequences.
  const bootScript = options.boot
    ? `<script>window.__REFRAME_BOOT__=${escapeJsonForScript(JSON.stringify(options.boot))};</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script type="importmap">{"imports":{"canvaskit-wasm":"/platform/vendor/canvaskit-shim.js","canvaskit-wasm/full":"/platform/vendor/canvaskit-shim.js"}}</script>
  ${bootScript}
  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    /* ── Theme tokens (match platform) ── */
    :root {
      --surface: #F2ECDA;
      --surface-elevated: #FAF7F0;
      --surface-canvas: #E8E2D0;
      --border: rgba(44,38,24,0.12);
      --border-subtle: rgba(44,38,24,0.08);
      --text-primary: #2C2618;
      --text-secondary: #6B6354;
      --text-muted: #9A9082;
      --accent: #E94B1A;
      --accent-hover: #D13D10;
      --on-accent: #fff;
      --glass-ink: 44,38,24;
      --sans: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
      --serif: 'Source Serif 4', Georgia, serif;
      --mono: 'JetBrains Mono', ui-monospace, monospace;
      --radius: 8px;
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
    }
    [data-theme="dark"] {
      --surface: #0E0D12;
      --surface-elevated: #18171E;
      --surface-canvas: #0A0A0B;
      --border: rgba(240,238,230,0.10);
      --border-subtle: rgba(240,238,230,0.06);
      --text-primary: #F0EEE6;
      --text-secondary: #8C887E;
      --text-muted: #5A564E;
      --accent: #FF6A34;
      --accent-hover: #FF7D4D;
      --glass-ink: 0,0,0;
    }

    body {
      font-family: var(--sans);
      background: var(--surface);
      color: var(--text-primary);
      overflow: hidden;
      height: 100vh;
      font-size: 13px;
    }

    /* ── Grid ──
       Phase 1 UI-1 — column widths driven by CSS vars set on .body
       (matches dashboard renderShell convention). Defaults match
       platform-ui.css .body declaration (320 / 360); fallback values
       below kick in only when the v1 storage prefs aren't applied yet
       (very first paint). */
    #app {
      display: grid;
      grid-template-rows: 48px 1fr;
      grid-template-columns: var(--sidebar-w, 320px) 1fr var(--right-w, 360px);
      grid-template-areas: "header header header" "sidebar canvas panel";
      height: 100vh;
      transition: grid-template-columns 180ms var(--ease, cubic-bezier(0.2, 0.6, 0.2, 1));
    }
    /* Phase 1 UI-1 — collapsed-sidebar variant for editor. Mirrors
       .body.with-right[data-left-collapsed="true"] from platform-ui.css
       but selectors keyed on #app so the editor shell's id beats the
       generic .body declarations. */
    #app[data-left-collapsed="true"] {
      grid-template-columns: var(--sidebar-collapsed-w, 48px) 1fr var(--right-w, 360px);
    }
    #app[data-left-collapsed="true"] [data-panel-resize="sidebar"] { display: none; }
    #app[data-left-collapsed="true"] #sidebar > :not(.sidebar-collapse-toggle) { display: none; }
    #app[data-left-collapsed="true"] #sidebar { padding: 12px 0; }
    #app[data-left-collapsed="true"] .sidebar-collapse-toggle {
      position: absolute; top: 8px; left: 50%; right: auto; transform: translateX(-50%);
    }

    /* Phase 1 UI-1 — narrow-viewport handling. The previous strategy
       was to collapse asides + hide macro pill at ≤1024px; replaced
       2026-04-29 by the .reframe-narrow-viewport-toast surface
       declared in platform-ui.css. Editor route does NOT silently
       degrade — toast surfaces the limitation and dims the app. */
    body.reframe-viewport-narrow #app {
      pointer-events: none;
      opacity: 0.35;
    }

    /* Resize handle styling — mirrors platform-ui.css .panel-resize
       so dashboard + editor share visuals. Position absolute relative
       to #app (position: relative is set via inline style on #app). */
    .panel-resize {
      position: absolute;
      top: 48px; /* below the header row */
      bottom: 0;
      width: 8px;
      cursor: col-resize;
      z-index: 20;
      user-select: none;
      background: transparent;
    }
    .panel-resize::before {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 50%;
      width: 1px;
      background: transparent;
      transition: background 140ms var(--ease, cubic-bezier(0.2, 0.6, 0.2, 1)), width 140ms var(--ease);
      transform: translateX(-50%);
    }
    .panel-resize:hover::before, .panel-resize.dragging::before {
      background: var(--accent, #2b74ff);
      width: 2px;
    }
    .panel-resize-sidebar { left: calc(var(--sidebar-w, 320px) - 4px); }
    .panel-resize-right { right: calc(var(--right-w, 360px) - 4px); }

    /* Sidebar collapse toggle — chevron button, top-right of sidebar. */
    .sidebar-collapse-toggle {
      position: absolute;
      top: 8px; right: 6px;
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--text-muted, #666);
      cursor: pointer;
      z-index: 5;
      transition: background 120ms var(--ease, ease), color 120ms var(--ease, ease);
    }
    .sidebar-collapse-toggle:hover { background: var(--surface-hover, rgba(0,0,0,0.04)); color: var(--text-primary, #111); }
    .sidebar-collapse-toggle .sc-icon-collapse { display: block; }
    .sidebar-collapse-toggle .sc-icon-expand { display: none; }
    #app[data-left-collapsed="true"] .sidebar-collapse-toggle .sc-icon-collapse { display: none; }
    #app[data-left-collapsed="true"] .sidebar-collapse-toggle .sc-icon-expand { display: block; }

    /* Layers filter — small input pinned above the tree. */
    .layers-filter { padding: 6px 10px 0; }
    .layers-filter input {
      width: 100%;
      padding: 4px 8px;
      background: var(--surface, #0e0e0e);
      border: 1px solid var(--border, #333);
      border-radius: 4px;
      color: var(--text-primary, #e5e5e5);
      font-size: 11px;
    }

    /* ── Header ── */
    #header {
      grid-area: header;
      position: relative;
      display: flex;
      align-items: center;
      padding: 0 20px;
      gap: 16px;
      background: var(--surface-elevated);
      border-bottom: 1px solid var(--border-subtle);
    }
    .wordmark {
      font-family: var(--mono);
      font-size: 16px;
      font-weight: 500;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      text-decoration: none;
    }
    .wordmark:hover { opacity: 0.8; }
    .header-sep {
      width: 1px;
      height: 20px;
      background: var(--border);
      margin: 0 4px;
    }
    .crumb {
      font-size: 13px;
      color: var(--text-secondary);
    }
    .spacer { flex: 1; }
    .h-btn {
      padding: 6px 14px;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      background: var(--surface-elevated);
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      font-family: var(--sans);
      transition: all 150ms var(--ease);
    }
    .h-btn:hover { background: var(--surface); color: var(--text-primary); border-color: var(--accent); }
    .h-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
    .h-btn.primary:hover { background: var(--accent-hover); }
    .theme-toggle {
      width: 32px; height: 32px; border: none; border-radius: 6px;
      background: transparent; color: var(--text-muted); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .theme-toggle:hover { color: var(--text-primary); background: var(--surface); }

    /* ── Sidebar ── */
    #sidebar {
      grid-area: sidebar;
      background: var(--surface-elevated);
      border-right: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-head {
      padding: 10px 16px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-bottom: 1px solid var(--border-subtle);
    }
    #layer-tree { flex: 1; overflow-y: auto; padding: 4px; }

    /* ── Canvas ── */
    #canvas-area {
      grid-area: canvas;
      position: relative;
      background: var(--surface-canvas);
      overflow: hidden;
    }
    #reframe-viewport {
      display: block;
      width: 100%;
      height: 100%;
      cursor: default;
      outline: none;
    }

    /* Annotation overlays - Phase 2 Brief 2b Pin #10. Layered over the
       DOM-canvas iframe + native canvas. Pointer-events default off so
       the canvas remains interactive; specific marks (free-vector,
       comment dots) re-enable on themselves. The .viewport-frame class
       on canvas-area lets 040-annotations.js render code resolve in
       editor-shell, sharing the legacy scene-page render path. */
    /* z-index 25 sits above the canvas iframe (which composes the
       scene HTML at default stack) so free-vector strokes receive
       pointer events on their stroke geometry. SVG itself stays
       pointer-events:none so the rest of the canvas keeps its
       interaction (zoom, pan, selection). The pen-active class
       flips to auto only while drawing. */
    #canvas-area svg.annotations {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 25;
    }
    #canvas-area svg.annotations.pen-active,
    #canvas-area svg.annotations.gesture-active { pointer-events: auto; }
    #canvas-area .annotation-marks-html {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 26;
    }
    #canvas-area .annotation-marks-html > * { pointer-events: auto; }
    #loading {
      position: absolute; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--surface-canvas);
      z-index: 100;
      transition: opacity 0.3s;
      pointer-events: none;
    }
    #loading.hidden { opacity: 0; }
    .spinner {
      width: 20px; height: 20px;
      border: 2px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Floating toolbar (bottom center) ── */
    #float-toolbar {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px;
      background: rgba(var(--glass-ink), 0.84);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      box-shadow: 0 8px 32px -8px rgba(0,0,0,0.5);
      z-index: 20;
    }
    .tb {
      width: 36px; height: 36px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: none; border-radius: 8px;
      color: rgba(255,255,255,0.65); cursor: pointer;
      transition: all 120ms var(--ease);
      font-size: 12px; font-weight: 600; font-family: var(--sans);
    }
    .tb:hover { background: rgba(255,255,255,0.10); color: #fff; }
    .tb.active { background: var(--accent); color: #fff; }
    .tb-sep {
      width: 1px; height: 22px; margin: 0 4px;
      background: rgba(255,255,255,0.12);
    }

    /* ── Right panel ── */
    #panel {
      grid-area: panel;
      background: var(--surface-elevated);
      border-left: 1px solid var(--border-subtle);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .panel-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
      padding: 0 8px;
      gap: 0;
    }
    .panel-tab {
      padding: 10px 10px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      background: transparent;
      border: none;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-family: var(--sans);
      transition: all 100ms;
      white-space: nowrap;
    }
    .panel-tab:hover { color: var(--text-secondary); }
    .panel-tab.active { color: var(--text-primary); border-bottom-color: var(--accent); }
    #panel-content { flex: 1; overflow-y: auto; padding: 12px; }

    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
  </style>
  <script>
    // Theme init (before paint)
    try { var t=localStorage.getItem('reframe-theme'); if(t) document.documentElement.setAttribute('data-theme',t); } catch(_){}
  </script>
</head>
<body>
  <!-- Phase 1 UI-1 — body class lets the JS layout binders
       (bindResizablePanels / bindSidebarCollapse from 070-viewport.js)
       find this root via the same .body selector they use on
       dashboard / brand pages. with-right tags this as a 3-column
       layout (sidebar + canvas + right inspector). The id-based
       grid CSS above wins on column widths via specificity. -->
  <div id="app" class="body with-right" style="position:relative"${appSceneAttr}>
    <header id="header">
      <a class="wordmark" href="/platform">reframe</a>
      <div class="header-sep"></div>
      <span class="crumb">${title.replace('reframe · ', '')}</span>
      ${renderMacroDropdowns()}
      <div class="spacer"></div>
      <button class="h-btn primary" id="btn-export">Export</button>
      <div class="header-sep"></div>
      <button class="theme-toggle" id="theme-toggle" title="Toggle theme">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2v1M8 2v1M13 8h1M2 8h1M11.5 4.5l.7-.7M3.8 12.2l.7-.7M11.5 11.5l.7.7M3.8 3.8l.7.7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
      </button>
    </header>

    <aside id="sidebar" style="position:relative">
      <!-- Phase 1 UI-1 — sidebar collapse toggle. Top-right chevron;
           click flips data-left-collapsed on #app. State persists via
           localStorage v1 (handled by bindSidebarCollapse). -->
      <button class="sidebar-collapse-toggle" data-sidebar-collapse-toggle title="Collapse panel" aria-label="Collapse panel" aria-expanded="true">
        <svg class="sc-icon-collapse" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 3 L5 7 L9 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <svg class="sc-icon-expand" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 3 L9 7 L5 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="sidebar-head">Layers</div>
      <div class="layers-filter">
        <input type="text" data-layers-filter placeholder="Filter layers..." autocomplete="off">
      </div>
      <div id="layer-tree" data-layers-tree tabindex="0"></div>
    </aside>

    <!-- Phase 1 UI-1 — resize handles. Positioned absolute via the
         .panel-resize CSS rules above; sit at the inner edge of each
         aside. bindResizablePanels (070-viewport.js) wires drag. -->
    <div class="panel-resize panel-resize-sidebar" data-panel-resize="sidebar"></div>
    <div class="panel-resize panel-resize-right" data-panel-resize="right"></div>

    <main id="canvas-area" class="viewport-frame">
      <div id="loading"><div class="spinner"></div></div>
      <canvas id="reframe-viewport" tabindex="0"${sceneAttr} data-session="${esc(options.sceneIds?.split(',')[0] ?? '')}"></canvas>

      <!-- Phase 2 Brief 2b Pin #10 — Annotation overlay mount.
           Default viewBox 1440×900 matches VIEWPORT_DIMS.desktop, the
           coordinate space the existing 040-annotations.js render code
           and pen-capture write to. preserveAspectRatio="none" so the
           overlay stretches to fill #canvas-area at any aspect ratio.
           data-annotations-overlay flag lets a future viewport-driven
           binder update viewBox when state.currentViewport changes
           (deferred — desktop is the only stable case today). -->
      <svg class="annotations" data-annotations-overlay viewBox="0 0 1440 900" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <g class="annotation-marks-svg"></g>
      </svg>
      <div class="annotation-marks-html"></div>

      <!-- Viewport preview switcher: Desktop / Tablet / Phone.
           Visual preview only — applies a CSS viewport-clip to the
           canvas, NOT a real mobile adapt. First tablet/phone click
           surfaces a flash pointing at reframe_edit op=adapt for a
           real variant. Wiring in bindViewportPreview. -->
      <div class="viewport-preview" data-viewport-preview-pill role="toolbar" aria-label="Viewport preview">
        <button class="vp-btn active" data-viewport-preview="desktop" title="Desktop (full width)" aria-pressed="true" aria-label="Desktop preview">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="11" height="7" rx="1" stroke="currentColor" stroke-width="1.4"/>
            <path d="M5 12h4M7 10v2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="vp-btn" data-viewport-preview="tablet" title="Tablet preview (834 px)" aria-pressed="false" aria-label="Tablet preview">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="2.5" y="1.5" width="9" height="11" rx="1.2" stroke="currentColor" stroke-width="1.4"/>
            <path d="M6 11h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="vp-btn" data-viewport-preview="phone" title="Phone preview (375 px)" aria-pressed="false" aria-label="Phone preview">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <rect x="4" y="1" width="6" height="12" rx="1.4" stroke="currentColor" stroke-width="1.4"/>
            <path d="M6 2.8h2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            <path d="M6.5 11.5h1" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <!-- Floating zoom pill: fit / − / level-menu / + / 100%.
           Wiring lives in /platform/ui/ (bindZoomPill) — reads from the
           public zoom API exposed on window.__reframeDOMCanvas.zoom. -->
      <div class="zoom-pill" data-zoom-pill role="toolbar" aria-label="Zoom">
        <button class="zp-btn" data-zoom-action="fit" title="Fit to screen (⌘0)" aria-label="Fit to screen">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M2 5V2h3M12 5V2H9M2 9v3h3M12 9v3H9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="zp-btn" data-zoom-action="out" title="Zoom out (⌘−)" aria-label="Zoom out">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 7h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="zp-level" data-zoom-level type="button" title="Pick preset zoom level" aria-haspopup="menu" aria-expanded="false">100%</button>
        <button class="zp-btn" data-zoom-action="in" title="Zoom in (⌘+)" aria-label="Zoom in">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 3v8M3 7h8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="zp-btn" data-zoom-action="100" title="Reset to 100% (⌘1)" aria-label="Reset to 100 percent">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="3.5" stroke="currentColor" stroke-width="1.3"/>
            <circle cx="7" cy="7" r="1" fill="currentColor"/>
          </svg>
        </button>
      </div>

      <!-- Floating toolbar: tools + undo/redo -->
      <div id="float-toolbar">
        <button class="tb active" data-tool="SELECT" title="Select (V)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1l9 6.5-4.5 1.5-2 4.5L3 1z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </button>
        <button class="tb" data-tool="FRAME" title="Frame (F)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
        <button class="tb" data-tool="RECTANGLE" title="Rectangle (R)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="8" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
        <button class="tb" data-tool="ELLIPSE" title="Ellipse (O)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="1.3"/></svg>
        </button>
        <button class="tb" data-tool="TEXT" title="Text (T)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4h8M8 4v8M6 12h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
        <button class="tb" data-tool="PEN" title="Pen (P)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M12 1.5L14.5 4 5.5 13 2 14l1-3.5L12 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        </button>
        <button class="tb" data-tool="HAND" title="Hand (H)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 5v5a3 3 0 006 0V5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
        <div class="tb-sep"></div>
        <button class="tb" id="btn-undo" title="Undo (Ctrl+Z)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M5 6L2 8.5 5 11M2.5 8.5H11a3 3 0 010 6H9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="tb" id="btn-redo" title="Redo (Ctrl+Shift+Z)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 6l3 2.5L11 11M13.5 8.5H5a3 3 0 000 6h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </main>

    <aside id="panel" style="display:flex;flex-direction:column;min-height:0;position:relative;">
      <!-- Phase 2 Brief 2c — thread detail panel mount. Glass overlay over
           the inspector contents (position:absolute inset:0 + z-index 6
           via .thread-panel CSS). openThreadPanel(threadId) fetches the
           hydrated thread + renders title/meta/events/reply form into
           the data-field elements; closeThreadPanel toggles .hidden. -->
      <div class="thread-panel hidden" data-thread-panel>
        <div class="thread-panel-head">
          <div class="close-row">
            <button class="close-btn" data-action="close-thread">← Back</button>
          </div>
          <div class="title" data-field="title">Thread</div>
          <div class="meta" data-field="meta"></div>
        </div>
        <div class="thread-panel-body" data-field="body"></div>
        <div class="thread-panel-actions" data-field="actions"></div>
      </div>

      <!-- Single always-visible Properties pane. Right-panel tabs are gone:
           Agent moved to a floating prompt (right-click on canvas / Cmd+K),
           block insertion moved to the floating block palette (Cmd+P). The
           panel content is updated by scripts.ts on canvas-select events
           (showPropsForNode). data-panel="design" + class .properties is
           kept so existing scripts.ts selectors still resolve.

           Phase 1 UI-6a Pin #4 — Tweaks panel hoisted OUT of the
           data-panel="design" container. Inspector's showPropsForNode
           overwrites that container's innerHTML on every node selection,
           which wiped the tweaks panel after first click. As a sibling
           above, it survives inspector re-renders and stays visible
           regardless of selection state. -->
      <section class="tweaks-panel" data-tweaks-panel hidden>
        <header class="tweaks-head">
          <span class="tweaks-title">Tweaks</span>
          <span class="tweaks-count" data-tweaks-count></span>
        </header>
        <div class="tweaks-list" data-tweaks-list></div>
      </section>
      <div data-panel="design" class="properties" style="flex:1;overflow-y:auto;overflow-x:hidden;padding:0 12px;min-width:0;">
        <div class="props-empty" style="color:var(--text-muted);font-size:12px;text-align:center;padding:40px 10px;">
          Select a node to inspect
        </div>
      </div>
    </aside>
    <!-- Phase 1 UI-6b — Missing-surfaces drawer. Slide-in from the
         right edge with 4 tabs (Quality / Variations / Tokens /
         Rebrand). Mounted as a sibling of <aside id="panel">, NOT
         nested inside the inspector — UI-6a Pin #4 architectural
         lesson — so inspector innerHTML overwrites can't wipe it.
         Bound by 170-drawer.js bindDrawer(). -->
    <div class="drawer-root" data-drawer-root aria-hidden="true"></div>
    ${renderBottomChat()}
    <!-- Phase 1 UI-1 — narrow-viewport toast. CSS in platform-ui.css
         drives display via body.reframe-viewport-narrow class set by
         bindNarrowViewportGuard (070-viewport.js). -->
    <div class="reframe-narrow-viewport-toast" data-narrow-viewport-toast role="status" aria-live="polite">
      <div class="reframe-narrow-viewport-toast-card">
        <strong>reframe Platform UI requires 1024px+ viewport.</strong>
        <span>Mobile support coming.</span>
      </div>
    </div>
  </div>
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
  <script src="/platform/app.js?v=${Date.now()}"></script>
  <script type="module" src="${options.editorJsPath}${options.editorJsPath.includes('?') ? '&' : '?'}v=${Date.now()}"></script>
</body>
</html>`;
}
