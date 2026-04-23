/**
 * Editor shell page — /platform/project/:slug.
 *
 * Phase 5.1 — FULL self-hosted through INode. The shell chrome (header,
 * sidebar, canvas area, floating toolbar, right panel) is composed by
 * `editor-shell` panel; this file wraps it in a tiny boot HTML shim
 * (doctype / fonts / theme-init / app.js / editor bundle) and
 * SERVER-SIDE HYDRATES the dynamic mount slots that can't be INode:
 *
 *   canvas-viewport   native <canvas id="reframe-viewport"> (editor bundle target)
 *   layers-tree       <div id="layer-tree" data-layers-tree> (client populates)
 *   macro-dropdowns   renderMacroDropdowns() markup (complex hover behavior)
 *   bottom-chat-slot  renderBottomChat() markup (streaming SSE)
 *
 * Zero hand-written chrome HTML remains. Every button / toggle / label
 * is a composer-emitted INode with a stable semantic path, unlocking
 * agent-driven UI QA (Phase 5.6). The floating toolbar's absolute
 * position + the overall grid layout are applied via a thin CSS layer
 * appended to the shell HTML.
 */

import { renderMacroDropdowns, renderBottomChat } from '../layout.js';
import type { EditorBootPayload } from '../boot-payload.js';
import { renderPanel } from '../panels.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Escape JSON for inline <script> — prevents breakout via </script>,
// <!--, and the two Unicode line separators (U+2028 / U+2029) which
// JSON allows but JavaScript string literals disallow.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
function escapeJsonForScript(json: string): string {
  return json
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
    .split(LINE_SEP).join('\\u2028')
    .split(PARA_SEP).join('\\u2029');
}

/**
 * Replace a mount-slot placeholder div with the hydrated content.
 * Exporter emits `<div ... data-mount-slot="<name>"> ... </div>`; this
 * swaps the inner HTML (keeping attrs so semantic paths + styles stay
 * intact for the runtime dispatcher).
 */
function hydrateSlot(html: string, slotName: string, inner: string): string {
  const re = new RegExp(
    `(<div[^>]*data-mount-slot="${slotName}"[^>]*>)([\\s\\S]*?)(</div>)`,
    'i',
  );
  return html.replace(re, `$1${inner}$3`);
}

/** Thin CSS layer — absolute toolbar + full-viewport root + native
 *  canvas positioning inside its slot. Yoga covers everything else. */
const SHELL_LAYOUT_CSS = `
  html, body { margin:0; padding:0; height:100vh; overflow:hidden; }
  [data-intent-role="editor-shell/root"] { height: 100vh; min-height: 100vh; }
  [data-intent-role="editor-shell/canvas-viewport-slot"] { position: relative; }
  [data-intent-role="editor-shell/canvas-viewport-slot"] > canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  [data-intent-role="editor-shell/float-toolbar"] {
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 10;
    box-shadow: 0 4px 18px rgba(0,0,0,0.12);
  }
  [data-intent-role="editor-shell/layers-tree-slot"] { overflow-y: auto; }
  .rf-gesture-pressed { opacity: 0.8; transform: scale(0.97); transition: all 120ms; }
`;

export function renderEditorShell(options: {
  title?: string;
  sceneIds?: string;
  sceneSlug?: string;
  editorJsPath: string;
  fontsLink?: string;
  boot?: EditorBootPayload;
}): string {
  const title = esc(options.title ?? 'reframe');
  const sceneSlug = options.sceneSlug ?? '';
  const sceneIds = options.sceneIds ?? '';
  const firstSceneId = sceneIds.split(',')[0] ?? '';

  const bootScript = options.boot
    ? `<script>window.__REFRAME_BOOT__=${escapeJsonForScript(JSON.stringify(options.boot))};</script>`
    : '';

  // Compose the editor shell INode tree via panel registry.
  const rendered = renderPanel('editor-shell', {
    sceneSlug,
    sceneIds,
    title: options.title,
    width: 1440,
    height: 900,
  }, {});
  let shellHtml = rendered.html;

  // Server-side slot hydration.
  shellHtml = hydrateSlot(
    shellHtml,
    'canvas-viewport',
    `<canvas id="reframe-viewport" tabindex="0"${sceneIds ? ` data-project-scenes="${esc(sceneIds)}"` : ''} data-session="${esc(firstSceneId)}"></canvas>`,
  );
  shellHtml = hydrateSlot(
    shellHtml,
    'layers-tree',
    `<div id="layer-tree" data-layers-tree style="padding: 8px 0"></div>`,
  );
  shellHtml = hydrateSlot(shellHtml, 'macro-dropdowns', renderMacroDropdowns());

  const assets = Date.now();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script type="importmap">{"imports":{"canvaskit-wasm":"/platform/vendor/canvaskit-shim.js","canvaskit-wasm/full":"/platform/vendor/canvaskit-shim.js"}}</script>
  ${bootScript}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${SHELL_LAYOUT_CSS}</style>
  <script>
    try { var t=localStorage.getItem('reframe-theme'); if(t) document.documentElement.setAttribute('data-theme',t); } catch(_){}
  </script>
</head>
<body>
  <div id="app"${sceneSlug ? ` data-scene="${esc(sceneSlug)}"` : ''}>
    ${shellHtml}
    ${renderBottomChat()}
  </div>
  <link rel="stylesheet" href="/platform/style.css?v=${assets}">
  <script src="/platform/theme-init.js?v=${assets}"></script>
  <script src="/platform/app.js?v=${assets}"></script>
  <script type="module" src="${options.editorJsPath}${options.editorJsPath.includes('?') ? '&' : '?'}v=${assets}"></script>
</body>
</html>`;
}
