/**
 * Editor HTML Shell — unified platform layout.
 *
 * ONE canvas, THREE input modes (AI / Blocks / Direct design).
 * Right panel: 6 contextual tabs.
 * Bottom bar: AI prompt input + status.
 *
 * Layout:
 * ┌───────────────────────────────────────────────────────────┐
 * │  Header: brand + tools + actions                          │
 * ├──────────┬────────────────────────────┬───────────────────┤
 * │  Layers  │     CanvasKit Viewport     │  Right Panel      │
 * │  (tree)  │     zoom/pan/select        │  6 tabs:          │
 * │          │                            │  Props / Blocks   │
 * │          │                            │  AI / Audit       │
 * │          │                            │  Design / Export  │
 * ├──────────┴────────────────────────────┴───────────────────┤
 * │  [AI prompt input...                ]  status    zoom     │
 * └───────────────────────────────────────────────────────────┘
 */

export function renderEditorShell(options: {
  slug?: string;
  title?: string;
  editorJsPath: string;
}): string {
  const title = options.title ?? 'reframe';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-0: #0a0a0a; --bg-1: #111; --bg-2: #1a1a1a; --bg-3: #222;
      --border: #2a2a2a; --border-active: #444;
      --text-1: #e5e5e5; --text-2: #999; --text-3: #666;
      --accent: #2563eb; --accent-hover: #1d4ed8;
      --error: #ef4444; --warning: #f59e0b; --success: #22c55e;
      --font: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
      --mono: 'JetBrains Mono', 'SF Mono', monospace;
    }
    body {
      font-family: var(--font); background: var(--bg-0);
      color: var(--text-1); overflow: hidden; height: 100vh; font-size: 13px;
    }

    /* ── Grid ── */
    #app {
      display: grid;
      grid-template-rows: 44px 1fr 40px;
      grid-template-columns: 220px 1fr 260px;
      grid-template-areas: "header header header" "sidebar canvas panel" "bottom bottom bottom";
      height: 100vh;
    }

    /* ── Header ── */
    #header {
      grid-area: header;
      display: flex; align-items: center; gap: 8px;
      padding: 0 12px;
      background: var(--bg-1); border-bottom: 1px solid var(--border);
    }
    .brand { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; padding-right: 12px; border-right: 1px solid var(--border); }
    .brand .dot { width: 6px; height: 6px; background: var(--success); border-radius: 50%; }
    .toolbar { display: flex; gap: 2px; padding: 0 8px; }
    .tool-btn {
      width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
      border: none; border-radius: 5px; background: transparent; color: var(--text-3);
      cursor: pointer; font-size: 13px; transition: all 0.1s;
    }
    .tool-btn:hover { background: var(--bg-2); color: var(--text-2); }
    .tool-btn.active { background: var(--accent); color: #fff; }
    .spacer { flex: 1; }
    .header-actions { display: flex; gap: 6px; }
    .h-btn {
      padding: 5px 12px; border-radius: 5px; border: 1px solid var(--border);
      background: var(--bg-2); color: var(--text-2); font-size: 11px; cursor: pointer; font-family: var(--font);
    }
    .h-btn:hover { background: var(--bg-3); color: var(--text-1); }
    .h-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    .h-btn.primary:hover { background: var(--accent-hover); }

    /* ── Sidebar ── */
    #sidebar {
      grid-area: sidebar; background: var(--bg-1); border-right: 1px solid var(--border);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .sidebar-head {
      padding: 8px 10px; font-size: 11px; font-weight: 600; color: var(--text-3);
      text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border);
    }
    #layer-tree { flex: 1; overflow-y: auto; padding: 4px; }

    /* ── Canvas ── */
    #canvas-area {
      grid-area: canvas; position: relative; background: var(--bg-0); overflow: hidden;
    }
    #viewport { display: block; width: 100%; height: 100%; cursor: default; }
    #loading {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: var(--bg-0); z-index: 100; transition: opacity 0.3s;
    }
    #loading.hidden { opacity: 0; pointer-events: none; }
    .spinner { width: 24px; height: 24px; border: 2px solid var(--bg-3); border-top: 2px solid var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #empty-state {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 16px; pointer-events: none; z-index: 50;
    }
    .empty-logo { font-size: 36px; opacity: 0.05; font-weight: 700; letter-spacing: -1px; }
    .empty-hint { font-size: 13px; color: var(--text-3); text-align: center; line-height: 1.8; }
    .empty-actions {
      display: flex; gap: 8px; pointer-events: auto; margin-top: 8px;
    }
    .empty-btn {
      padding: 8px 16px; border-radius: 6px; border: 1px solid var(--border);
      background: var(--bg-2); color: var(--text-2); font-size: 12px; cursor: pointer; font-family: var(--font);
    }
    .empty-btn:hover { background: var(--bg-3); color: var(--text-1); }
    .empty-btn.accent { background: var(--accent); border-color: var(--accent); color: #fff; }

    /* ── Right Panel ── */
    #panel {
      grid-area: panel; background: var(--bg-1); border-left: 1px solid var(--border);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .panel-tabs {
      display: grid; grid-template-columns: repeat(3, 1fr);
      border-bottom: 1px solid var(--border); flex-shrink: 0;
    }
    .panel-tab {
      padding: 7px 2px; text-align: center; font-size: 10px; color: var(--text-3);
      background: transparent; border: none; cursor: pointer;
      border-bottom: 2px solid transparent; font-family: var(--font); transition: all 0.1s;
    }
    .panel-tab:hover { color: var(--text-2); }
    .panel-tab.active { color: var(--text-1); border-bottom-color: var(--accent); }
    #panel-content { flex: 1; overflow-y: auto; padding: 0 10px; }

    /* ── Bottom Bar (AI prompt + status) ── */
    #bottom {
      grid-area: bottom; display: flex; align-items: center; gap: 12px;
      padding: 0 12px; background: var(--bg-1); border-top: 1px solid var(--border);
    }
    #ai-input {
      flex: 1; padding: 6px 12px; border-radius: 6px;
      border: 1px solid var(--border); background: var(--bg-0);
      color: var(--text-1); font-size: 12px; font-family: var(--font);
      outline: none; transition: border-color 0.15s;
    }
    #ai-input:focus { border-color: var(--accent); }
    #ai-input::placeholder { color: var(--text-3); }
    #status-text { font-size: 11px; color: var(--text-3); white-space: nowrap; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
    .status-dot.on { background: var(--success); }
    .status-dot.off { background: var(--error); }
    #zoom-level { font-family: var(--mono); font-size: 11px; color: var(--text-3); }

    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--bg-3); border-radius: 3px; }
  </style>
</head>
<body>
  <div id="app">

    <header id="header">
      <div class="brand"><span class="dot"></span> reframe</div>
      <div class="toolbar">
        <button class="tool-btn active" data-tool="SELECT" title="Select (V)">V</button>
        <button class="tool-btn" data-tool="FRAME" title="Frame (F)">F</button>
        <button class="tool-btn" data-tool="RECTANGLE" title="Rectangle (R)">R</button>
        <button class="tool-btn" data-tool="ELLIPSE" title="Ellipse (O)">O</button>
        <button class="tool-btn" data-tool="TEXT" title="Text (T)">T</button>
        <button class="tool-btn" data-tool="PEN" title="Pen (P)">P</button>
        <button class="tool-btn" data-tool="HAND" title="Hand (H)">H</button>
      </div>
      <div class="spacer"></div>
      <div class="header-actions">
        <button class="h-btn" id="btn-open" title="Open .fig (&#x2318;O)">Open</button>
        <button class="h-btn" id="btn-audit">Audit</button>
        <button class="h-btn primary" id="btn-export">Export</button>
      </div>
    </header>

    <aside id="sidebar">
      <div class="sidebar-head">Layers</div>
      <div id="layer-tree"></div>
    </aside>

    <main id="canvas-area">
      <div id="loading"><div class="spinner"></div></div>
      <canvas id="viewport"></canvas>
      <div id="empty-state">
        <div class="empty-logo">reframe</div>
        <div class="empty-hint">AI-native design editor</div>
        <div class="empty-actions">
          <button class="empty-btn" id="btn-empty-open">Open .fig</button>
          <button class="empty-btn" id="btn-empty-blocks">Browse blocks</button>
          <button class="empty-btn accent" id="btn-empty-ai">Ask AI</button>
        </div>
      </div>
    </main>

    <aside id="panel">
      <div class="panel-tabs">
        <button class="panel-tab active" data-panel="properties">Props</button>
        <button class="panel-tab" data-panel="blocks">Blocks</button>
        <button class="panel-tab" data-panel="ai">AI</button>
      </div>
      <div class="panel-tabs">
        <button class="panel-tab" data-panel="audit">Audit</button>
        <button class="panel-tab" data-panel="design">Design</button>
        <button class="panel-tab" data-panel="export">Export</button>
      </div>
      <div id="panel-content">
        <div style="color:var(--text-3);font-size:12px;text-align:center;padding:40px 10px;">
          Select a node, browse blocks,<br>or ask AI to generate a design
        </div>
      </div>
    </aside>

    <footer id="bottom">
      <input id="ai-input" type="text" placeholder="Ask AI to design something... (&#x23CE; to send)" autocomplete="off" spellcheck="false">
      <span class="status-dot off" id="mcp-dot"></span>
      <span id="status-text">Loading...</span>
      <span id="zoom-level">100%</span>
    </footer>

  </div>
  <script type="module" src="${options.editorJsPath}"></script>
</body>
</html>`;
}
