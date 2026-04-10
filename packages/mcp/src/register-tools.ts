/**
 * Single registration of MCP tools — used by stdio (`index.ts`) and HTTP sidecar (`http-server.ts`).
 *
 * Tool descriptions follow Anthropic's managed-agent research:
 *   - Extremely detailed descriptions (3-4+ sentences)
 *   - Explain WHAT the tool does, WHEN to use it, WHEN NOT to use it
 *   - Describe what each parameter means and affects
 *   - Document what the tool RETURNS so the agent knows what to do next
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { designInputSchema, handleDesign } from './tools/design.js';
import { compileInputSchema, handleCompile } from './tools/compile.js';
import { editInputSchema, handleEdit } from './tools/edit.js';
import { exportInputSchema, handleExport } from './tools/export.js';
import { inspectInputSchema, handleInspect } from './tools/inspect.js';
import { projectInputSchema, handleProject } from './tools/project.js';
import { resizeInputSchema, handleResize } from './tools/resize.js';

/** 7 public tools: design, compile, edit, inspect, export, project, resize. */
export function registerReframeMcpTools(server: McpServer): void {

  // ── 1. DESIGN ──────────────────────────────────────────────
  server.tool(
    'reframe_design',
    `Load or extract a brand's DESIGN.md — the canonical specification that drives all design decisions (colors, typography, spacing, components, patterns).

Use this FIRST in any design workflow to establish brand context. Without it, compile/audit cannot enforce brand compliance.

Four actions:
- list: show all available brands from the getdesign npm registry (60+ brands). Use "search" param to filter by keyword (e.g. "ai", "crypto", "automotive"). Call this when the user asks "what brands are available?" or wants to browse.
- extract + brand: fetch DESIGN.md by slug via npm (e.g. "stripe", "airbnb", "linear"). Auto-cached in .reframe/brands/.
- extract + html/url: reverse-engineer an existing site's design system into DESIGN.md format.
- prompt: converts DESIGN.md into an optimized AI system prompt with size-specific guidance.

Returns: the full DESIGN.md (300+ lines of prose with exact values, philosophy, component prompts). For brand slugs, returns the complete brand spec from getdesign npm. Persists to .reframe/design.md automatically. Session caches the parsed design system for subsequent compile/audit calls.

Do NOT call this tool if you already have a design system loaded in the session — check with reframe_inspect (no sceneId) first.`,
    designInputSchema,
    handleDesign,
  );

  // ── 2. COMPILE ─────────────────────────────────────────────
  server.tool(
    'reframe_compile',
    `Import HTML+CSS into the reframe engine. This is the primary way to create designs — write complete HTML with inline styles, and reframe converts it to an INode AST, runs 23-rule audit with auto-fix, and saves exports.

Use this when creating a NEW design or re-compiling after editing source HTML. Write beautiful, self-contained HTML with inline styles (not classes). Set explicit width on the root element (e.g. 1440px). Every container needs explicit background + text colors.

Two HTML input modes:
- html: pass HTML string directly (first compile)
- file: path to HTML file (e.g. ".reframe/src/home.html") — engine reads the file. Use this after editing source HTML with Edit/Write tools.

Source HTML is auto-saved to .reframe/src/<name>.html on every compile. Edit that file for big changes, then re-compile with file parameter.

Alternative input: blueprint JSON for programmatic/template generation (not for creative work).

Returns: scene ID (e.g. "s1"), node count, audit result (PASS/FAIL with issue details), source HTML path, and export file paths.

After compile, ALWAYS call reframe_inspect to review the tree and audit. Fix issues with reframe_edit (small tweaks) or edit source HTML + re-compile (big changes).`,
    compileInputSchema,
    handleCompile,
  );

  // ── 3. EDIT ────────────────────────────────────────────────
  server.tool(
    'reframe_edit',
    `Modify an existing scene — fix audit issues, adjust properties, add/remove nodes, clone scenes, resize, or define design tokens.

Use this AFTER reframe_compile to fix problems found by reframe_inspect. Do NOT use this to build designs from scratch — use reframe_compile with HTML first, then edit to refine.

Operations (executed in sequence):
- update: change properties on a node found by name path ("NodeName" or "Parent/Child")
- add: insert a new node under a parent
- delete: remove a node by name path
- clone: duplicate an entire scene (new scene ID returned)
- resize: change root dimensions
- move: reparent a node
- defineTokens: generate design tokens from DESIGN.md and bind to all matching nodes
- setMode: switch light/dark mode (re-resolves all token bindings)

Both "text" and "characters" are accepted for text content. Path search is case-sensitive and matches the first node found by name.

Returns: list of operations performed, then auto-audit results for all touched scenes. Check the audit section — if issues remain, edit again. Loop until audit passes.`,
    editInputSchema,
    handleEdit,
  );

  // ── 4. INSPECT ─────────────────────────────────────────────
  server.tool(
    'reframe_inspect',
    `View the node tree and run the 23-rule audit on a scene. This is the feedback loop — inspect shows what's wrong, you fix with reframe_edit, then inspect again until clean.

Two modes:
- With sceneId: shows the full node tree (name, type, dimensions, text preview) + audit results with actionable fix suggestions. Each issue tells you exactly which node to update and what property to change.
- Without sceneId: shows session overview — all scenes with their status, plus intelligent recommendations (stale scenes needing re-audit, systemic issues, export suggestions).

Returns: ASCII node tree (configurable depth/lines), audit results grouped by severity (error > warning > info), and fix instructions referencing reframe_edit operations. For structural comparison, use diffWith parameter to compare two scenes.

Use this after every compile and every edit cycle. The inspect → edit → inspect loop is the core design refinement workflow. Export only after inspect shows a clean result.`,
    inspectInputSchema,
    handleInspect,
  );

  // ── 5. EXPORT ──────────────────────────────────────────────
  server.tool(
    'reframe_export',
    `Export a scene to a deliverable format. Auto-saves to .reframe/exports/ and returns the file path.

Formats:
- html: static HTML page with inline styles, semantic tags, hover/responsive CSS, token CSS variables. Best for review and web deployment.
- react: React functional component (TSX) with TypeScript annotations. Includes hover states and responsive media queries when the scene has states/responsive rules.
- svg: vector graphics with text and layout preserved. Good for icons, illustrations, static assets.
- animated_html: HTML with CSS keyframe animations. Requires animate parameter with presets (fadeIn, slideIn, scaleIn, popIn, bounce, etc.) or stagger config.
- lottie: Lottie JSON for native mobile/web animations.
- site: bundles ALL session scenes into a multi-page app with routing, navigation, and page transitions. Use this for complete website prototypes.

Returns: export file path and size. The file is ready to open in a browser or import into a project.

Only export after reframe_inspect confirms the design is clean. Exporting a scene with audit errors produces a working file but with known issues.`,
    exportInputSchema,
    handleExport,
  );

  // ── 7. RESIZE ──────────────────────────────────────────────
  server.tool(
    'reframe_resize',
    `Adapt an existing scene to one or many target dimensions in a single call. Each target produces a new session scene (sN) with semantic classification, layout-profile detection, and optional auto-export to HTML.

Use this when you have a working design at one size and want to derive multiple variants — e.g. take a 680×1080 email and produce mobile-email 375×1334, social-square 1080×1080, story 1080×1920, leaderboard 728×90 in one go. Each variant is independently inspectable, editable, and exportable via existing reframe_inspect/reframe_edit/reframe_export tools.

Strategies:
- smart (default): letterbox-contain + JSON guide post-process. Best for similar-aspect adaptations (vertical → mobile, vertical → story).
- contain: uniform letterbox to fit, no cropping, margins on the opposite axis.
- cover: uniform letterbox to fill, may crop. Good for backgrounds/hero adaptations.
- stretch: non-uniform per-axis (sX, sY differ). Distorts aspect — only for stretchable content.

For each target the engine runs:
1. Yoga layout pass (positions get computed)
2. Semantic classification — every node tagged with role (heading, button, section, caption, etc.)
3. Cluster scaling — sections + descendants resize proportionally (recursively)
4. Optional guide post-process — JSON guides for known sizes (1080×1080, 728×90, 1080×1920, etc.)
5. Auto-export to HTML if exportHtml is true (default)

Returns: per-target line with new scene ID, layout profile + confidence, semantic distribution (role=count), guide key if used, export filepath if exported. Use the returned scene IDs with reframe_inspect to view the adapted tree, semantic skeleton, and audit results.

LIMITATION: Extreme aspect changes (e.g. vertical email → wide leaderboard) are mathematically correct but may produce unusable slivers — long-form content needs a reflow strategy that doesn't yet exist. Ideal use is similar-aspect or moderate-aspect changes.`,
    resizeInputSchema,
    handleResize,
  );

  // ── 6. PROJECT ─────────────────────────────────────────────
  server.tool(
    'reframe_project',
    `Manage persistent .reframe project directories. Projects store scenes on disk so they survive between sessions.

Actions:
- init: create a new .reframe directory with manifest. Requires dir parameter. Use this at the start of a new project.
- open: open an existing .reframe project. Auto-loads scenes from disk into the session. Requires dir parameter.
- save: persist a session scene to disk. Requires sceneId (session ID like "s1"). Creates/updates .reframe/scenes/<slug>.scene.json.
- load: load a scene from disk into the session. Requires sceneId (project slug like "hero-dark"). Returns the new session ID for use in other tools.
- list: show all scenes stored on disk (only those with actual files, not stale manifest entries).
- status: show project info + all session scenes with their age and node count.
- delete: remove a scene file from the disk project.
- save_design: persist DESIGN.md content to .reframe/design.md and link in manifest.

Returns: confirmation with file paths for save/load, scene list for list, project summary for status.

Scenes auto-save to disk when a project is open. Use explicit save when you want to ensure persistence or add tags.`,
    projectInputSchema,
    handleProject,
  );
}
