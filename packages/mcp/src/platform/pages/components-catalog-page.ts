// Components catalog — your saved INode-subtree components.
// For MVP: read-only enumeration from .reframe/components/ and render
// through the components-catalog artifact.

import type { PlatformContext } from '../router.js';
import { renderPanelAsync, loadPanelArtifacts } from '../panel-registry.js';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOC_CSS = `
  html, body { margin:0; padding:0; height:100vh; overflow:hidden; background:#0a0a0e; color:#e8e8ec; }
  * { box-sizing:border-box; }
  [data-intent-role^="components-catalog/nav-"]:hover {
    background: #14141c !important;
    color: #e8e8ec !important;
  }
`;

export async function renderComponentsCatalogPage(ctx: PlatformContext): Promise<string> {
  const projectDir = ctx.projectDir;
  if (!projectDir) {
    return `<!DOCTYPE html><body style="background:#0a0a0e;color:#e8e8ec;font-family:system-ui;padding:40px">
      <h1>No project</h1><p><a href="/platform" style="color:#635BFF">← feed</a></p></body>`;
  }
  loadPanelArtifacts(projectDir);

  const dir = join(projectDir, '.reframe', 'components');
  let count = 0;
  if (existsSync(dir)) {
    try {
      count = readdirSync(dir).filter(f => {
        try { return statSync(join(dir, f)).isDirectory(); } catch { return false; }
      }).length;
    } catch { /* ignore */ }
  }

  const shell = await renderPanelAsync('components-catalog', {
    __raw: true,
    componentCount: count,
  }, { projectDir });

  const assets = Date.now();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>reframe · components</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${DOC_CSS}</style>
</head>
<body>
  ${shell.html}
  <script src="/platform/ui/055-agent-runtime.js?v=${assets}" defer></script>
</body>
</html>`;
}
