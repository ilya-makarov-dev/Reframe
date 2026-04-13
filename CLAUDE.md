# reframe — Programmable Design Engine

YOU are the designer. reframe is your rendering engine. You write HTML+CSS, reframe compiles, validates, exports. **Be creative. Every design should feel different.**

## Build & Test

```bash
npm run build                              # build all packages
npm test                                   # run all tests
npx tsc --noEmit -p packages/core/tsconfig.json   # typecheck core
npx tsc --noEmit -p packages/mcp/tsconfig.json    # typecheck mcp
```

## MCP Pipeline (always this order)

```
1. reframe_design → load brand context
     action: "list"                         → browse 60+ brands
     action: "extract", brand: "stripe"     → full DESIGN.md (300+ lines)
     action: "extract", url: "https://..."  → extract from any site

2. reframe_compile → YOU write full HTML with inline styles, pass to compile
     html: "<div style='width:1440px'>..."  → first compile
     file: ".reframe/src/home.html"         → re-compile after editing source

3. reframe_inspect → review 23-rule audit → reframe_edit to fix → re-inspect

4. reframe_export → deliver (html/react/svg/animated_html/lottie/site)
```

## Tools (6 core + 1 experimental = 7 registered)

```
reframe_design     brand load/list/extract (local or npx getdesign)
reframe_compile    HTML → INode scene + audit + auto-fix
reframe_inspect    tree + 23-rule audit + diff + semantic skeleton
reframe_edit       ALL mutations — structural + theming + variations
reframe_export     html / react / svg / lottie / animated_html / site
reframe_project    persistence — save/load/history/snapshots/components/macros/brands
reframe_collab     EXPERIMENTAL — async intent queue worker stub
```

Consolidated down from 12 tools. The removed six were either overlapping
(iterate/resize/vary now live as `reframe_edit` ops) or half-built UI
collaboration layers whose core APIs still power the Platform UI via
HTTP but aren't exposed to the agent directly (intent/annotate/thread).

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

`defineTokens` runs the full brand inheritance pipeline when called with
a brand slug or DESIGN.md: tokenize → auto-bind → semantic rebrand +
contrast-aware text color selection → component recipe application
(button/card/badge/input/nav specs from the parsed DesignSystem).
One call = "make this scene look like Spotify/Stripe/Ferrari".

`vary` is pure-deterministic design space exploration — no AI. Takes
axes, generates N cloned scenes via Cartesian product, each with the
recipe applied in sequence.

## HTML Rules

- Inline styles only (no classes)
- `width` on root element (1440px for web)
- Explicit `background` + `color` on every container
- Min 44px button height (WCAG touch target)
- Apply `font-feature-settings` if brand specifies OpenType features (ss01, tnum, etc.)
- Full-width sections: no fixed px on stretching containers, use `width:100%`

## DESIGN.md = Brand Context

Agent receives the **full DESIGN.md** from `reframe_design` — 300+ lines with exact colors, typography (with OpenType features), button variants with hover states, card/badge/input/nav specs, spacing scale, shadows, do's/don'ts.

**IMPORTANT:** Read the DESIGN.md carefully. Use those exact values. The 23-rule audit validates your HTML against all of it.

Brands come from `getdesign` npm. Custom: copy `DESIGN.md.example`, fill in your values.

## Source HTML Workflow

Compile auto-saves to `.reframe/src/<name>.html`. Small fixes → `reframe_edit`. Big changes → edit source file → re-compile with `file` param.

## Architecture

```
packages/core    INode AST, SceneGraph, layout (Yoga), audit (23 rules),
                 importers, exporters, design-system parser + inheritance,
                 tokens (contrast-aware rebrand), variations, resize
packages/mcp     MCP server (6 core + 1 experimental = 7 tools), session,
                 auto-fix, brand catalog, snapshots, Platform UI at
                 localhost:4100/platform (canvas-based design tool)
packages/cli     reframe build/test, config loader (uses @reframe/core
                 as a package import — not relative paths — so CLI builds
                 don't recompile all of core)
```

## Platform UI (localhost:4100/platform)

Canvas-based design tool — not a sidebar viewer. The UI mirrors the
agent's data model 1:1 so what you see in the browser is exactly what
reframe_compile/edit produced.

- **Dashboard** groups scenes into projects (by common prefix +
  variantOf metadata). Each card shows the owner + variant count.
- **Project canvas** (`/platform/project/:slug`) is a pan/zoom Figma-
  style workspace containing every variant of the project at native
  size. Artboards are lazy-loaded iframes (IntersectionObserver);
  `resizeArtboardToContent` measures real scrollHeight after load and
  grows each frame so nothing renders as a cropped window.
- **Right panel**: Layers / Properties / Audit / Variations tabs.
  Variations tab posts to `/platform/api/variations/apply` and
  `/platform/api/variations/grid` (pure variation transforms, no AI).
- **History dropdown**: lists ops log + named snapshots. Snapshot
  save/restore hits `/platform/api/history/...` endpoints backed by an
  in-memory snapshot store (`packages/mcp/src/snapshots.ts`, LRU 30
  per scene). Revert-to replays inverse ops atomically via
  `ops.prevProps`.
- **Perf**: dual-stack bind (`::`) kills the Windows localhost 200ms
  penalty. `buildPlatformContext` cached 2s. Preview cache LRU 64
  keyed on `sceneId:revision:ext`. Audit cache LRU 64. SSE refreshers
  debounced 300–1000ms per channel.

## Brand Inheritance

`reframe_edit { op: "defineTokens", brand: "stripe" }` is the one-shot
"rebrand this scene" pipeline:

1. Parse DESIGN.md → DesignSystem (colors, typography, button/card/
   badge/input/nav specs). Parser uses a line-by-line walker with
   fuzzy section matching so `Cards & Containers` / `Cards` / etc all
   hit the same extractor.
2. Tokenize + auto-bind every node to the right token role.
3. `rebrandColorsFromTokens` with polarity detection (scene dark vs
   brand dark) and **contrast-aware text selection** — walks up
   parents from the text node to find the effective background, then
   ranks token candidates by WCAG contrast ratio. (The previous bug
   was reading the text node's own fill as "background" and returning
   #121212 against #121212.)
4. `applyBrandInheritance` runs component recipes on matching nodes.
   Semantic classifier + `inferStructuralRole` detects
   button/card/badge/input/nav from visual properties, so FRAME nodes
   that weren't explicitly tagged still get their recipes applied.

## Variations

`packages/core/src/variations/` — pure deterministic transforms:
`spacing.ts` (scaleSpacing), `radius.ts` (sharp/soft/pill/editorial),
`shadows.ts` (flat/subtle/normal/dramatic), `colors.ts` (rotateColors
with invert-accent / invert-mode / [tokenA, tokenB]),
`typography.ts` (dramatic/flat/editorial/technical/friendly presets),
`grid.ts` (Cartesian product over { brand, density, radius, shadows,
typography, mode, colorRotation }).

Exposed as `reframe_edit` ops and via Platform UI `/api/variations`.
No AI in this path — same inputs always produce the same output.

## SVG Hybrid Rendering

HTML exporter (`packages/core/src/exporters/html.ts`) now renders
vector primitives (ELLIPSE / STAR / POLYGON / LINE / VECTOR) as inline
`<svg>` inside their wrapper `<div>`. `shouldRenderAsSvg()` +
`isIconLikeFrame()` in `svg-primitives.ts` decide which nodes
qualify. Gracefully falls back to divs if anything throws. Opt-out
via `svgDecorations: false`.

## Headless API

REST endpoints at `http://localhost:4100/api/`:
```
GET  /api/render/{sceneId}?format=html&brand=stripe&scale=2
POST /api/render/batch   { sceneId, formats[], brands[], viewports[] }
GET  /api/tokens/{sceneId}?format=dtcg
POST /api/tokens/{sceneId}   (DTCG JSON body)
GET  /api/audit/{sceneId}?aesthetic=true
GET  /api/blocks?category=hero
POST /api/blocks/instantiate  { name, slots }
GET  /api/scenes
GET  /thumbnail/{sceneId}.png?scale=1
```

## Common Gotchas

- linkedom (HTML import) does not compute CSS flex constraints — avoid deeply nested flex without explicit widths
- Audit overflow rules respect `clipsContent` — flex containers with explicit dimensions auto-clip
- `reframe_compile` shows warnings inline now — fix them before export
- Brand DESIGN.md files cached in `.reframe/brands/` — delete to re-fetch
- Token export: `defineTokens` auto-saves `.reframe/tokens.json` (DTCG format)
- Block library: 17 starter blocks auto-registered on first `list_blocks` or `add_block`
- Aesthetic scoring: 8 metrics (alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion)
- PNG/PDF export: requires CanvasKit WASM (auto-initialized on first call)
- Layout backend: default Yoga, switchable to Taffy via `setLayoutBackend('taffy')` before `initYoga()`
