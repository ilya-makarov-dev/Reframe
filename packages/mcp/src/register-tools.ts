/**
 * Single registration of MCP tools — used by stdio (`index.ts`) and HTTP sidecar (`http-server.ts`).
 *
 * Tool descriptions follow Anthropic's managed-agent research:
 *   - Extremely detailed descriptions (3-4+ sentences)
 *   - Explain WHAT the tool does, WHEN to use it, WHEN NOT to use it
 *   - Describe what each parameter means and affects
 *   - Document what the tool RETURNS so the agent knows what to do next
 *
 * ── Tool consolidation (2026-04) ──
 * Down from 12 to 6 tools. The removed 6 were either overlapping with
 * reframe_edit's op system (iterate, resize, vary) or aspirational
 * infrastructure that never made it into the main data flow (intent,
 * annotate, thread). Their CORE APIS are still available:
 *   - iterate / resize / vary → reframe_edit { op: "iterate" | "adapt" | "vary" }
 *   - intent / annotate / thread → Platform UI HTTP endpoints still work;
 *     Core modules (core/src/project/intents, annotations, threads) are
 *     the authoritative implementation and untouched.
 *
 * This consolidation follows the documented flow in README.md:
 *   design → compile → inspect → edit → export
 * plus `project` for persistence = 6 tools. Agent's decision tree is
 * tighter, context window is ~50% lighter per turn, and the "which tool
 * do I call?" decision is clearer.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { designInputSchema, handleDesign } from './tools/design.js';
import { compileInputSchema, handleCompile } from './tools/compile.js';
import { editInputSchema, handleEdit } from './tools/edit.js';
import { exportInputSchema, handleExport } from './tools/export.js';
import { inspectInputSchema, handleInspect } from './tools/inspect.js';
import { projectInputSchema, handleProject } from './tools/project.js';
import { collabInputSchema, handleCollab } from './tools/collab.js';

/** 7 tools: 6 pipeline + project + collab. Self-improvement happens through the pipeline: compile → inspect → edit → inspect. */
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
    `Import HTML+CSS into the reframe engine. This is the primary way to create designs — write complete HTML with inline styles, and reframe converts it to an INode AST, runs 30+ audit rules with auto-fix, assigns semantic roles (nav, hero, heading, button, etc.), and saves exports.

Use this when creating a NEW design or re-compiling after editing source HTML. Write beautiful, self-contained HTML with inline styles (not classes). Set explicit width on the root element (e.g. 1440px). Every container needs explicit background + text colors.

Two HTML input modes:
- html: pass HTML string directly (first compile)
- file: path to HTML file (e.g. ".reframe/src/home.html") — engine reads the file. Use this after editing source HTML with Edit/Write tools.

Source HTML is auto-saved to .reframe/src/<name>.html on every compile. Edit that file for big changes, then re-compile with file parameter.

Alternative input: blueprint JSON for programmatic generation (same engine, typed tree instead of HTML).

Returns: scene ID (e.g. "s1"), node count, audit result (PASS/FAIL with issue details), source HTML path, and export file paths. Use reframe_inspect with aesthetic: true for design quality scores.

After compile, ALWAYS call reframe_inspect to review the tree and audit. Fix issues with reframe_edit (small tweaks) or edit source HTML + re-compile (big changes).`,
    compileInputSchema,
    handleCompile,
  );

  // ── 3. EDIT ────────────────────────────────────────────────
  server.tool(
    'reframe_edit',
    `Modify an existing scene — fix audit issues, adjust properties, add/remove nodes, clone scenes, resize, or define design tokens.

Use this AFTER reframe_compile to fix problems found by reframe_inspect. Do NOT use this to build designs from scratch — use reframe_compile with HTML first, then edit to refine.

Operations (executed in sequence) — this is the ONE place for all scene mutations:

Structural ops:
- update: change properties on a node found by name path ("NodeName" or "Parent/Child")
- add: insert a new node under a parent
- delete: remove a node by name path
- clone: duplicate an entire scene (new scene ID returned)
- resize: change root dimensions
- move: reparent a node

Token / theming ops:
- defineTokens: generate design tokens from DESIGN.md and bind to all matching nodes
- setMode: switch light/dark mode (re-resolves all token bindings)

Variation ops (were previously standalone reframe_vary/reframe_resize/reframe_iterate tools):
- scaleSpacing: multiply padding/gap/itemSpacing by factor (density variation; <1 compact, >1 spacious)
- scaleRadius: transform corner radii (sharp, soft, pill, editorial, or {factor}/{value})
- scaleShadows: scale shadow intensity (flat, subtle, normal, dramatic, or {factor})
- rotateColors: swap token role values (invert-accent, invert-mode, or [tokenA, tokenB])
- typographyPreset: apply type hierarchy preset (dramatic, flat, editorial, technical, friendly)
- iterate: run audit+fix loop (auto mode, up to maxRounds) or propose mode (audit only, suggestions returned)
- adapt: generate responsive variants at given sizes (smart/contain/cover/stretch/reflow strategies). Each size produces a new session scene.
- vary: generate a Cartesian variation grid from { brand, density, radius, shadows, typography, mode, colorRotation } axes. Returns N new session scenes, one per axis combination.

Layout ops:
- multiColumn: convert a container node into multi-column grid layout. Specify columns (2-12) and gap. Great for feature grids, pricing comparisons.

Both "text" and "characters" are accepted for text content. Path search is case-sensitive and matches the first node found by name.

Returns: list of operations performed, then auto-audit results for all touched scenes. Check the audit section — if issues remain, edit again. Loop until audit passes.`,
    editInputSchema,
    handleEdit,
  );

  // ── 4. INSPECT ─────────────────────────────────────────────
  server.tool(
    'reframe_inspect',
    `View the node tree, run 30+ audit rules, and optionally compute aesthetic quality scores on a scene. This is the feedback loop — inspect shows what's wrong, you fix with reframe_edit, then inspect again until clean.

Two modes:
- With sceneId: shows the full node tree (name, type, dimensions, text preview) + audit results with actionable fix suggestions. Each issue tells you exactly which node to update and what property to change. Includes semantic skeleton (detected roles: nav, hero, section, footer, etc.).
- Without sceneId: shows session overview — all scenes with their status, plus intelligent recommendations (stale scenes needing re-audit, systemic issues, export suggestions).

Aesthetic scoring (set aesthetic: true):
Computes 8 design quality metrics (0-100%): alignment consistency, whitespace balance, visual balance, color harmony, hierarchy clarity, spacing rhythm, text readability, proportionality. Returns overall composite score + per-metric breakdown with ratings (Poor/Fair/Good/Excellent). No other design tool provides quantitative aesthetic evaluation.

Returns: ASCII node tree (configurable depth/lines), audit results grouped by severity (error > warning > info), fix instructions referencing reframe_edit operations, semantic skeleton, and aesthetic scores when requested. For structural comparison, use diffWith parameter.

Also available via API: GET /api/audit/{sceneId}?aesthetic=true

Use this after every compile and every edit cycle. The inspect → edit → inspect loop is the core design refinement workflow. Export only after inspect shows a clean result.`,
    inspectInputSchema,
    handleInspect,
  );

  // ── 5. EXPORT ──────────────────────────────────────────────
  server.tool(
    'reframe_export',
    `Export a scene to a deliverable format. Auto-saves to .reframe/exports/ and returns the file path.

Formats (10 total):
- html: static HTML page with inline styles, semantic tags, hover/responsive CSS, token CSS variables. Best for review and web deployment.
- react: React functional component (TSX) with TypeScript annotations. Includes hover states and responsive media queries.
- svg: vector graphics with text and layout preserved. Good for icons, illustrations, static assets.
- png: raster image via CanvasKit (Skia WASM). Use scale parameter for retina (e.g. scale: 2 for @2x). Great for thumbnails, social sharing, OG images.
- pdf: PDF document with embedded raster. Good for print-ready marketing materials, pitch decks.
- animated_html: HTML with animations. Requires animate parameter with presets (fadeIn, slideIn, scaleIn, popIn, bounce, etc.) or stagger config. Supports engine: 'css' (default) or 'waapi' (Web Animations API with spring physics).
- lottie: Lottie JSON for native mobile/web animations.
- site: bundles ALL session scenes into a multi-page app with routing, navigation, and page transitions. Use this for complete website prototypes.
- transition: animated resize preview (source → target dimensions). Requires transitionTarget parameter.

Also available via Headless API: GET /api/render/{sceneId}?format=html&brand=stripe&viewport=mobile
Batch API: POST /api/render/batch for N brands × M viewports × K formats in one call.

Returns: export file path and size. The file is ready to open in a browser or import into a project.

Only export after reframe_inspect confirms the design is clean. Exporting a scene with audit errors produces a working file but with known issues.`,
    exportInputSchema,
    handleExport,
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
- list: show all scenes stored on disk with revision, node count, bound brand, source HTML path, and brand-drift warnings.
- status: show project info + registered brands + drift warnings + all session scenes with their age and node count.
- delete: remove a scene file from the disk project.
- save_design: persist DESIGN.md content to .reframe/design.md and link in manifest (legacy single-file mode — prefer reframe_design for brand registry v2).
- list_brands: show all brands registered in the project's brand registry (v2) with hash + active marker.
- set_active_brand: switch the project's active brand by slug. Requires brand parameter. Re-compiles are NOT triggered — existing scenes keep their recorded brand/hash until next reframe_compile.
- show_source: return the source HTML previously persisted for a scene (by project slug). Useful for iterating: read → edit → reframe_compile({ file: ... }).
- history: list the phase-3 operation log for a scene. Every reframe_edit "update" on a stable-id node appends a setProps op here, and those ops replay on the next reframe_compile so edits survive source HTML changes.
- history_clear: wipe the op log for a scene. Next re-compile will produce a pristine scene with no replayed agent edits — use when you want to abandon a line of iteration.
- add_variant: create a responsive variant of a base scene at a target viewport. Requires sceneId (base slug) + viewport { name, width, height }. Runs the full reframe resize pipeline (smart strategy by default) and saves the adapted result as a sibling scene file ".reframe/scenes/<base>.<viewport>.scene.json".
- list_variants: list every variant of a base scene with its viewport + node count.
- refresh_variants: re-generate every variant of a base scene from the base's current state. Automatically called on reframe_compile, but exposed for manual triggers (e.g. after a brand switch that should re-propagate).
- save_macro: persist a sequence of op templates as a named, reusable macro. Requires name + macroOps array. Each op's nodeId can be either a literal stable id (replay-only on the origin scene) or a placeholder like "$role:button" / "$role:heading[0]" that resolves against any scene's semantic tree at apply time. Macros give agents a way to "brutalize" or "appleify" a scene with one tool call.
- list_macros: list every macro in the project with its op count and description.
- apply_macro: resolve a macro's placeholders against a target scene and append the resulting ops to that scene's history log. Requires name (macro name) + sceneId (target scene slug). The next reframe_compile replays those ops, so macros compose with Phase 3 replay + Phase 4 variant auto-refresh automatically.
- delete_macro: remove a macro file from the project.
- list_components: show every component master stored in the project with revision + slot names. Components are reusable subtrees living under .reframe/components/<slug>.component.json. Any HTML element with data-reframe-component="Name" becomes an instance on compile; the master must exist beforehand (extract first) or the instance renders as a placeholder with a warning.
- show_component: display a specific component master by name (revision, slots, property definitions, root summary).
- delete_component: remove a component master from disk. Scenes that still reference it by name will surface as "missing master" on the next load — repair by re-extracting or running reframe_edit unlinkInstance on the stale instance.

Token actions (W3C DTCG 2025.10 format):
- export_tokens: export all design tokens from a scene to .reframe/tokens.json in DTCG format. Compatible with Tokens Studio, Style Dictionary v4, Specify. Requires sceneId.
- import_tokens: import tokens from .reframe/tokens.json into all session scenes. Creates Variables + TokenIndex.

Returns: confirmation with file paths for save/load, scene list for list, project summary for status, source HTML block for show_source, ordered op list for history, variant details for add_variant/list_variants/refresh_variants, macro details for macro actions, token count for export/import_tokens.

Scenes auto-save to disk when a project is open. Stable DOM-path ids survive re-compile so reframe_edit operations keep addressing the same nodes. Variants auto-refresh on every reframe_compile of their base, keeping responsive output in sync with source HTML edits, replayed history operations, and macro applications.`,
    projectInputSchema,
    handleProject,
  );

  // ── 7. COLLAB (EXPERIMENTAL / TESTABLE) ────────────────────
  //
  // Minimal async agent-worker surface. Exists so the Platform UI
  // gesture system (Ask / Pin / Echo / Lasso / Brush / Rule) is not
  // a dead-letter queue — an agent can actually pull user intents
  // that were captured via gestures and respond with generated ops.
  //
  // Mostly dormant today. The primary reframe flow is direct
  // (user → Claude → reframe_compile/edit/export), and no one polls
  // the intent queue in the background. This tool exists as a
  // testable stub so that async workflow works when it's needed,
  // without the overhead of 3 separate tools (intent/annotate/thread).
  //
  // If you never use it, remove the import + this server.tool block.
  // If you build an async agent around it, expand from here.
  server.tool(
    'reframe_collab',
    `EXPERIMENTAL / TESTABLE — async agent worker surface.

The Platform UI gesture layer (Ask/Pin/Echo/Lasso/Brush/Rule/Resonance/Drag) captures user interactions and writes them as Intents to the project queue (.reframe/intents/queue.jsonl). This tool is the ONE place an agent can pull that queue and respond with generated operations.

NOTE: This is a minimal stub. It exists so the async flow works when you want it — most of the time you'll interact with the agent directly and won't touch this tool. The more complex intent/annotate/thread subsystems are available via Platform UI HTTP endpoints; this tool only exposes the narrow slice an agent actually needs: pull pending work, respond with a proposal.

Three actions:

- list: peek at queued intents without popping. Read-only. Returns up to 10 queued intents with their scene, part count, and a one-line summary. Use this when you want to see if there's work waiting before committing to batch-pop.

- process: batch-pop up to batchSize queued intents and transition them from 'queued' to 'processing'. Returns the full intent payload (parts, anchors, scope) so the agent has everything needed to generate ops. After calling process, the agent is expected to generate ops via reframe_edit for each intent, then call respond to close the loop.

- respond: mark a processing intent as 'proposed' with an optional summary string and/or opIds array. Platform UI will surface the proposal for human accept/reject. Requires intentId. Summary and opIds are both optional but recommended.

Typical flow:
  1. reframe_collab({ action: "list" }) → see if anything's queued
  2. reframe_collab({ action: "process", batchSize: 3 }) → pop 3 intents
  3. For each intent, read its parts and generate ops via reframe_edit
  4. reframe_collab({ action: "respond", intentId: "...", summary: "Made button pill-shaped", opIds: [...] })

Intent authoring (add/commit/refine), annotations, threads, and templates are NOT exposed here — they're UI-side data structures the agent reads implicitly through intent.parts. If you need agent-side CRUD on those, request a tool expansion.`,
    collabInputSchema,
    handleCollab,
  );


}

