# reframe — AI-Native Design Editor

Import → Graph → Audit → Transform → Export. INode is to structured content what AST is to code.
Interactive CanvasKit viewport powered by @open-pencil/core. 37-rule quality engine. 8 export formats.

**Architecture:** `@open-pencil/core` (MIT, npm) = viewport rendering + .fig + pointer interaction. `@reframe/core` = INode AST + SceneGraph + layout + audit + tokens + resize + export + blocks + variations + animation + semantic layer — the engine. `@reframe/editor` = GraphBridge (OP ↔ INode) + canvas bootstrap + panels + sync. `@reframe/mcp` = MCP tools + Platform UI + REST API.

**For design work:** THREE input modes — AI agent writes HTML, user picks blocks from library, or direct canvas editing (Figma-like). All converge on one CanvasKit viewport.

## Build & Test

```bash
npm run build                              # build all 4 packages (core, cli, mcp, editor)
npm test                                   # run all tests
npx tsc --noEmit -p packages/core/tsconfig.json    # typecheck core
npx tsc --noEmit -p packages/mcp/tsconfig.json     # typecheck mcp
npx tsc --noEmit -p packages/editor/tsconfig.json  # typecheck editor
node packages/editor/src/bridge/bridge.integration.test.mjs  # editor integration test (35 assertions)
```

## Pipeline (design → compile → inspect → edit → export)

```
1. reframe_design → load brand context
     action: "list"                         → browse 60+ brands
     action: "extract", brand: "stripe"     → full DESIGN.md (300+ lines)

2. reframe_compile → YOU write full HTML with inline styles, pass to compile
     html: "<div style='width:1440px'>..."  → first compile
     file: ".reframe/src/home.html"         → re-compile after editing source

3. reframe_inspect → review 37-rule audit → reframe_edit to fix → re-inspect

4. reframe_export → deliver (html/react/svg/png/pdf/lottie/animated_html/site)
```

## Packages (4)

```
packages/core      @reframe/core    — headless engine: SceneGraph, audit (37 rules), tokens, resize, 8 exporters, HTML import, blocks, animation
packages/mcp       @reframe/mcp     — MCP server (7 tools) + HTTP sidecar (:4100) + Platform UI + REST API + SSE
packages/editor    @reframe/editor  — interactive editor: GraphBridge (@open-pencil/core ↔ reframe), CanvasKit viewport, panels, sync
packages/cli       @reframe/cli     — CLI: init/build/test
```

## MCP Tools (7 registered)

```
reframe_design     brand load/list/extract (60+ brands via getdesign npm)
reframe_compile    HTML → INode scene + 37-rule audit + auto-fix + .fig import (via @open-pencil/core)
reframe_inspect    tree + 37-rule audit + 8 aesthetic metrics + brand fidelity + diff + semantic skeleton
reframe_edit       ALL mutations — structural + theming + variations + adapt + vary + components + multiColumn
reframe_export     8 core formats: html / react / svg / png / pdf / lottie / animated_html / site (+ theatre, transition for advanced use)
reframe_project    persistence — save/load/history/blocks/content/macros/brands/components
reframe_collab     EXPERIMENTAL — async intent queue worker stub
```

## reframe_edit — the one place for mutations

```
Structural:     update, add, delete, clone, resize, move
Theming:        defineTokens, setMode
Variation:      scaleSpacing, scaleRadius, scaleShadows,
                rotateColors, typographyPreset
Flow:           iterate (audit+fix loop),
                adapt   (responsive size variants),
                vary    (Cartesian brand × density × radius × … grid)
```

## HTML Rules

- Inline styles only (no classes)
- `width` on root element (1440px for web)
- Explicit `background` + `color` on every container
- Min 44px button height (WCAG touch target)
- Apply `font-feature-settings` if brand specifies OpenType features (ss01, tnum, etc.)
- Full-width sections: no fixed px on stretching containers, use `width:100%`

## DESIGN.md = Brand Context

Agent receives the **full DESIGN.md** from `reframe_design` — 300+ lines with exact colors, typography, button variants, card/badge/input/nav specs, spacing scale, shadows.

**IMPORTANT:** Read the DESIGN.md carefully. Use those exact values. The 37-rule audit validates against it.

## Common Gotchas

- linkedom (HTML import) does not compute CSS flex constraints — but Yoga handles layout post-import. `flex:1` in HUG parents now works correctly (fixed: flexBasis conditional on parent sizing).
- CSS Grid is fully supported: `display:grid`, `grid-template-columns`, `grid-column/row: span N`, gap. Imports as `layoutMode: 'GRID'`.
- `width: fit-content` / `min-content` / `max-content` handled as HUG sizing (not parsed as 0).
- @media responsive rules link correctly via linkedom `data-reframe-idx` (index mismatch fixed).
- Audit overflow rules respect `clipsContent` — flex containers with explicit dimensions auto-clip
- `reframe_compile` shows warnings inline now — fix them before export
- Brand DESIGN.md files cached in `.reframe/brands/` — delete to re-fetch
- Token export: `defineTokens` auto-saves `.reframe/tokens.json` (DTCG format)
- Block library: 30+ starter blocks auto-registered on first `list_blocks` or `add_block`. 60+ HTML sections in manifest.
- Aesthetic scoring: 8 metrics (alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion)
- PNG/PDF export: requires CanvasKit WASM (auto-initialized on first call)
- Layout backend: Yoga WASM (own mapping logic). Optional Taffy fallback via `setLayoutBackend('taffy')` before `initYoga()` — requires `yoga-layout-taffy` npm.
- `@open-pencil/core` is an npm dependency for interactive viewport. SceneNode models are 95% compatible (forked from same origin). GraphBridge handles conversion.
- `project init` with a different dir preserves session scenes (no longer clears them).
