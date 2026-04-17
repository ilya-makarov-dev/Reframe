# reframe — AI-Native Design Editor

Import → Graph → Audit → Transform → Export. INode is to structured content what AST is to code.
Interactive CanvasKit viewport powered by @open-pencil/core. 37-rule quality engine. 8 export formats.

**Architecture:** `@open-pencil/core` (MIT, npm) = viewport rendering + .fig + pointer interaction. `@reframe/core` = INode AST + SceneGraph + layout + audit + tokens + resize + variations + animation + semantic layer + 8 exporters — the engine. `@reframe/editor` = GraphBridge (OP ↔ INode) + canvas bootstrap + panels + sync. `@reframe/mcp` = MCP tools + Platform UI + REST API.

**For design work:** three input paths — DESIGN.md seeds brand context, AI agent writes HTML, direct canvas editing (Figma-like). All converge on one INode SceneGraph.

## When running as the in-app agent

When you're spawned by `/api/agent/chat` (the Platform UI's bottom chat or right sidebar), you're inside an open reframe session talking to a designer — not a developer. Route every intent through one of these four skills:

| User intent | Skill | First move |
|---|---|---|
| "make / build / design …" a page, section, landing, dashboard | `reframe-design` | Check brand, then Write source + `reframe_compile` |
| Names a brand (Stripe, Linear, Airbnb…) or says "rebrand" | `reframe-brand` | `reframe_design action=extract` then Read the DESIGN.md |
| Asks for multiple pages / a full site | `reframe-site-loop` | Write SITE.md + next-prompt.md, loop one page per turn |
| Vague one-liner ("a landing page", "something nice") | `reframe-enhance` | Rewrite into structured DESIGN SYSTEM + sections block, then hand to `reframe-design` |

**The costume, not the CLI.** You have the full reframe MCP (6 core tools) plus all normal Claude Code tools. But the user in the browser doesn't want a dev session — they want scene changes. Prefer `reframe_edit` over regeneration when the ask fits an INode property. Keep tool chatter short. Show your work in the preview, not in words.

**Scope context is pre-loaded.** The bottom chat prepends `[Scope: node: … · brand: … · viewport: …]` to each message. Trust it. If the scope says `brand: stripe`, don't re-extract — just Read the cached DESIGN.md.

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
packages/core      @reframe/core    — headless engine: SceneGraph, audit (37 rules), tokens, resize, variations, 8 exporters, HTML import, animation
packages/mcp       @reframe/mcp     — MCP server (6 core tools + 1 experimental) + HTTP sidecar (:4100) + Platform UI + REST API + SSE
packages/editor    @reframe/editor  — interactive editor: GraphBridge (@open-pencil/core ↔ reframe), CanvasKit viewport, panels, sync
packages/cli       @reframe/cli     — CLI: init/build/test
```

## MCP Tools — 6 core

```
reframe_design     brand load/list/extract (60+ brands via getdesign npm)
reframe_compile    HTML → INode scene + 37-rule audit + auto-fix + .fig import (via @open-pencil/core)
reframe_inspect    tree + 37-rule audit + 8 aesthetic metrics + brand fidelity + diff + semantic skeleton
reframe_edit       ALL mutations — structural + theming + variations + adapt + vary + components + multiColumn + resize
reframe_export     8 core formats: html / react / svg / png / pdf / lottie / animated_html / site (+ theatre, transition for advanced use)
reframe_project    persistence — save/load/history/content/macros/brands/components
```

One extra experimental tool, off the happy path: `reframe_collab` — async intent queue worker stub, not part of the main flow.

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

## Taste rules (the audit doesn't catch these — honor them anyway)

These are enforced as a system rule, not per-skill. They apply every time the agent writes HTML, regardless of which skill is active.

- **Max one accent color** above 80% saturation. A second high-sat color is noise.
- **No pure black (`#000`).** Use `#111`–`#1a` even on dark themes. Pure black burns holes in a dark layout.
- **Inter is banned for premium / editorial contexts.** Use Geist, Outfit, Cabinet Grotesk, or Söhne. Inter is fine for neutral SaaS / dashboards.
- **Serif in dashboards = no.** Serif is editorial only.
- **Never invent numbers, stats, logos, or testimonials.** If the user didn't provide them, use neutral labels ("trusted by teams", not "trusted by 40k engineers"). This is the most common way generated designs feel fake.
- **Emoji-as-UI is a tell.** Emoji in body copy = fine. Emoji as iconography = replace with SVG or glyph characters.
- **No "3 equal cards horizontally."** Use asymmetric grid / zig-zag / bento. The generic 3-up is the AI-slop signature.
- **Centered hero only when variance is low.** Headline + CTA = centered okay. Headline + 3 stats + image + 2 CTAs = not centered.
- **Motion via `transform` / `opacity` only.** Never animate `top/left/width/height`. Spring physics ≈ stiffness 100, damping 20.

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
- Aesthetic scoring: 8 metrics (alignment, whitespace, balance, harmony, hierarchy, rhythm, readability, proportion)
- PNG/PDF export: requires CanvasKit WASM (auto-initialized on first call)
- Layout backend: Yoga WASM (own mapping logic). Optional Taffy fallback via `setLayoutBackend('taffy')` before `initYoga()` — requires `yoga-layout-taffy` npm.
- `@open-pencil/core` is an npm dependency for interactive viewport. SceneNode models are 95% compatible (forked from same origin). GraphBridge handles conversion.
- `project init` with a different dir preserves session scenes (no longer clears them).
