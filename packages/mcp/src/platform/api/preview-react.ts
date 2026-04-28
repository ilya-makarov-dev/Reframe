/**
 * Live React preview endpoint.
 *
 *   GET /platform/preview-react/<sceneId>
 *     → 200 text/html — full document with vendor scripts + inline JSX
 *     → 404 — scene not in store and not on disk (no procedural fallback;
 *       preview-react requires a real scene to render React from)
 *
 * Architecture: Babel + React + ReactDOM are served from /platform/vendor/
 * (one-time fetch, browser-cached aggressively via STATIC_CACHE). The
 * React JSX is emitted inline via the standard core React exporter
 * (`exportToReact(node, { typescript: false, cssModules: false })`) and
 * transformed in the browser by Babel-standalone.
 *
 * Phase 0 stack: 'inline' only — JSX self-contained styles. Other stacks
 * (css-modules / tailwind / styled-components) require additional CDN or
 * build-time setup and don't fit the "open file, see React running"
 * model. Activate when first user signal appears for those stacks.
 *
 * JSX parse errors surface in the browser console — the server doesn't
 * run Babel. Trust the React exporter to emit valid JSX (it's covered by
 * its own tests; if the exporter regresses, the preview page just shows
 * an error in DevTools, not a 500).
 *
 * Eager scene loading: missing-from-store sceneIds also try the disk
 * fallback (same path as /preview/<id>) so a freshly-compiled scene from
 * another process is visible without restarting the sidecar.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { exportToReact } from '../../../../core/src/exporters/react.js';
import { StandaloneNode } from '../../../../core/src/adapters/standalone/node.js';
import { StandaloneHost } from '../../../../core/src/adapters/standalone/adapter.js';
import { setHost } from '../../../../core/src/host/context.js';
import { getScene, resolveSessionId } from '../../store.js';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Disk-fallback resolution moved into store.ts as resolveSessionId.

export async function handlePreviewReact(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // /platform/preview-react/<sceneId>
  const m = url.pathname.match(/^\/platform\/preview-react\/([^\/]+)\/?$/);
  if (!m) return false;
  const sceneId = decodeURIComponent(m[1]);

  // Memory + disk-fallback resolved via the canonical helper.
  const sessionId = resolveSessionId(sceneId);
  let stored = sessionId ? getScene(sessionId) : undefined;
  if (!stored || !stored.graph || !stored.rootId) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><body><h1>Scene not found</h1><p>No compiled scene for id <code>${escapeHtml(sceneId)}</code>.</p></body></html>`);
    return true;
  }

  // Render JSX via the standard core exporter. typescript:false + cssModules:false
  // = plain JS with inline styles, the simplest input for browser-side Babel.
  let jsx: string;
  try {
    const root = stored.graph.getNode(stored.rootId)!;
    const host = new StandaloneHost(stored.graph);
    setHost(host);
    const wrappedRoot = new StandaloneNode(stored.graph, root) as any;
    jsx = exportToReact(wrappedRoot, {
      typescript: false,
      cssModules: false,
      componentName: 'Scene',
    });
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><body><h1>React export failed</h1><pre>${escapeHtml(err?.message ?? String(err))}</pre></body></html>`);
    return true;
  }

  const docTitle = `${stored.name ?? sceneId} — React Preview`;
  // Strip ES module syntax — the script runs as a classic <script> tag
  // (no `type="module"`) so React + ReactDOM are read from window globals
  // (loaded via UMD vendor scripts above). Imports/exports throw
  // "Cannot use import statement outside a module" without this strip.
  // Lines removed:
  //   - `import React from 'react'`, `import { useState } from 'react'`, etc.
  //   - `export default <Name>` at module bottom
  const jsxBody = jsx
    .replace(/^\s*import\s+[^;]+;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+\w+\s*;?\s*$/m, '')
    .trim();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(docTitle)}</title>
  <script src="/platform/vendor/react.production.min.js"></script>
  <script src="/platform/vendor/react-dom.production.min.js"></script>
  <script src="/platform/vendor/babel-standalone.min.js"></script>
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
    #root { min-height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-presets="react">
${jsxBody}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Scene));
  </script>
</body>
</html>`;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    // Short cache — JSX content depends on scene state, which mutates.
    // Vendor scripts under /platform/vendor/ keep their long immutable cache.
    'Cache-Control': 'public, max-age=60',
  });
  res.end(html);
  return true;
}
