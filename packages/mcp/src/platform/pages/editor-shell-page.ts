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

    /* ── Grid ── */
    #app {
      display: grid;
      grid-template-rows: 48px 1fr;
      grid-template-columns: 220px 1fr 320px;
      grid-template-areas: "header header header" "sidebar canvas panel";
      height: 100vh;
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
  <div id="app"${appSceneAttr}>
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

    <aside id="sidebar">
      <div class="sidebar-head">Layers</div>
      <div id="layer-tree" data-layers-tree></div>
    </aside>

    <main id="canvas-area">
      <div id="loading"><div class="spinner"></div></div>
      <canvas id="reframe-viewport" tabindex="0"${sceneAttr} data-session="${esc(options.sceneIds?.split(',')[0] ?? '')}"></canvas>

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

    <aside id="panel">
      <!-- Single always-visible Properties pane. Right-panel tabs are gone:
           Agent moved to a floating prompt (right-click on canvas / Cmd+K),
           block insertion moved to the floating block palette (Cmd+P). The
           panel content is updated by scripts.ts on canvas-select events
           (showPropsForNode). data-panel="design" + class .properties is
           kept so existing scripts.ts selectors still resolve. -->
      <div data-panel="design" class="properties" style="flex:1;overflow-y:auto;overflow-x:hidden;padding:0 12px;min-width:0;">
        <div class="props-empty" style="color:var(--text-muted);font-size:12px;text-align:center;padding:40px 10px;">
          Select a node to inspect
        </div>
      </div>
    </aside>
    ${renderBottomChat()}
  </div>
  <link rel="stylesheet" href="/platform/style.css?v=${Date.now()}">
  <script src="/platform/theme-init.js?v=${Date.now()}"></script>
  <script src="/platform/app.js?v=${Date.now()}"></script>
  <script type="module" src="${options.editorJsPath}${options.editorJsPath.includes('?') ? '&' : '?'}v=${Date.now()}"></script>
</body>
</html>`;
}
