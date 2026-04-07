#!/usr/bin/env node

/**
 * Reframe MCP Server v2 — 5-tool design engine.
 *
 * reframe_design    — extract design system from HTML → DESIGN.md, generate AI prompts
 * reframe_compile   — content + DESIGN.md + sizes → N INode scenes (compiler or HTML import)
 * reframe_edit      — INode operations: create/add/update/delete/clone/resize/move/tokens
 * reframe_export    — scene → html/svg/png/react/animated_html/lottie
 * reframe_inspect   — tree + audit + assert + diff (agent feedback loop)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { designInputSchema, handleDesign } from './tools/design.js';
import { compileInputSchema, handleCompile } from './tools/compile.js';
import { editInputSchema, handleEdit } from './tools/edit.js';
import { exportInputSchema, handleExport } from './tools/export.js';
import { inspectInputSchema, handleInspect } from './tools/inspect.js';

// Keep project tool for persistence (it's infrastructure, not a design tool)
import { projectInputSchema, handleProject } from './tools/project.js';

import { initYoga } from '../../core/src/engine/yoga-init.js';
import { VERSION } from './version.js';
import { startHttpSidecar } from './http-server.js';
import { projectExists } from '../../core/src/project/io.js';
import { setProjectDir, setDeferredProjectInit, loadProjectScenes } from './store.js';

const server = new McpServer({
  name: 'reframe',
  version: VERSION,
});

// ─── 5 Tools ────────────────────────────────────────────────

// ─── Step 1: Brand ──────────────────────────────────────────

server.tool(
  'reframe_design',
  `Load a brand or extract design system. Sets active brand for the session — all subsequent tools use it automatically.

brand: "stripe" — loads pre-built brand guide. Saves to .reframe/brand.md.
url: "https://..." — extracts design system from any website.
html: "<div>..." — extracts from raw HTML.
action: "prompt" — generates optimized AI design prompt from DESIGN.md.`,
  designInputSchema,
  handleDesign,
);

// ─── Step 2: Design ─────────────────────────────────────────

server.tool(
  'reframe_compile',
  `Design compiler. Write HTML+CSS with inline styles — be creative, unique, stunning. reframe imports into INode, validates with 19 rules, auto-fixes, saves to .reframe/exports/.

Set width on root element (e.g. 1440px). Use inline styles only (not classes). Every section needs explicit background + text colors.

Brand loaded via reframe_design or brand parameter enforces compliance automatically.

IMPORTANT: After EVERY compile, call reframe_inspect to review the result. Check audit issues and fix with reframe_edit before exporting. Never skip inspect.`,
  compileInputSchema,
  handleCompile,
);

// ─── Step 2b: Edit (INode editor) ───────────────────────────

server.tool(
  'reframe_edit',
  `Fix and tweak scenes after compile. Don't build from scratch here — use reframe_compile with HTML first, then edit to fix audit issues.

Operations: update (change props), add (insert node), delete (remove), clone, resize, move.
Path: "NodeName" searches entire tree. Both "text" and "characters" accepted.
Auto-audits after every operation.`,
  editInputSchema,
  handleEdit,
);

// ─── Step 3: Validate ───────────────────────────────────────

server.tool(
  'reframe_inspect',
  `Feedback loop. Shows node tree + 19-rule audit (contrast, accessibility, brand compliance).
See issues → fix with reframe_edit → re-inspect. Omit sceneId for session overview.`,
  inspectInputSchema,
  handleInspect,
);

// ─── Step 4: Export ─────────────────────────────────────────

server.tool(
  'reframe_export',
  `Export to any format. Auto-saves to .reframe/exports/.

html — static HTML page
react — React component (TSX)
svg — vector graphics
animated_html — CSS keyframe animations (presets: fadeIn, slideIn, scaleIn, popIn, bounce, etc.)
lottie — Lottie JSON animation
site — bundles ALL scenes into clickable multi-page app with routing + page transitions`,
  exportInputSchema,
  handleExport,
);

// ─── Infrastructure ─────────────────────────────────────────

server.tool(
  'reframe_project',
  'Project persistence. Actions: init, save, load, list, status. Scenes auto-save to .reframe/scenes/.',
  projectInputSchema,
  handleProject,
);

// ─── Start ───────────────────────────────────────────────────

async function main() {
  await initYoga();

  const cwd = process.cwd();
  if (projectExists(cwd)) {
    setProjectDir(cwd);
    const count = loadProjectScenes(cwd);
    if (count > 0) {
      process.stderr.write(`reframe: loaded ${count} scene(s) from ${cwd}/.reframe\n`);
    }
  } else {
    setDeferredProjectInit(cwd);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const port = parseInt(process.env.REFRAME_HTTP_PORT ?? '4100', 10);
  startHttpSidecar(port);
}

main().catch((err) => {
  process.stderr.write(`reframe MCP server error: ${err.message}\n`);
  process.exit(1);
});
