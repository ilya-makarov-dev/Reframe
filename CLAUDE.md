# reframe — AI-Native Design Editor

Import → Graph → Audit → Transform → Export. INode is to structured content what AST is to code.
Interactive CanvasKit viewport powered by @open-pencil/core. 37-rule quality engine. 8 export formats.

**Architecture:** `@open-pencil/core` (MIT, npm) = viewport rendering + .fig + pointer interaction. `@reframe/core` = INode AST + SceneGraph + layout + audit + tokens + resize + variations + animation + semantic layer + 8 exporters — the engine. `@reframe/editor` = GraphBridge (OP ↔ INode) + canvas bootstrap + panels + sync. `@reframe/mcp` = MCP tools + Platform UI + REST API.

**For design work:** three input paths — DESIGN.md seeds brand context, AI agent writes HTML, direct canvas editing (Figma-like). All converge on one INode SceneGraph.

## When running as the in-app agent

When you're spawned by `/api/agent/chat` (the Platform UI's bottom chat or right sidebar), you're inside an open reframe session talking to a designer — not a developer. Every intent routes through exactly one of the 7 skills below. Each skill is written as **role + sensitive surfaces + smell table + canonical flows**, not as a procedure — the engine handles procedure, skills carry the taste + failure-pattern memory the engine can't encode.

| User intent | Skill | First move |
|---|---|---|
| "make / build / design / redo …" a page, section, hero, form, dashboard | `reframe-design` | Check brand context, write HTML with taste rules baked in, `reframe_compile`, scan smell table |
| Names a brand (Stripe, Linear, Airbnb…) or "apply / rebrand / use X's style" | `reframe-brand` | `reframe_design action=extract` → Read DESIGN.md → then design or rebrand-in-place |
| Multiple pages / full site / sitemap | `reframe-site-loop` | Write SITE.md + next-prompt.md baton, one page per turn, brand frozen on turn 1 |
| Vague / mood-only / ≤ 10 words ("a landing page", "something nice") | `reframe-enhance` | Rewrite into structured brief (DESIGN SYSTEM + sections + audience + must/nice), hand off |
| "how does this look?" / "review" / "make it better" / "polish" | `reframe-critic` | Read `reframe_inspect` + DESIGN.md, ≤3 concrete fixes with engine citations |
| "export to React" / "give me TSX" / "ship as components" | `reframe-to-react` | Ask stack once, map to `reactTarget`, call `reframe_export reactTree=true`, relay verbatim |
| "test the UI" / "QA the platform" / "sweep the flows" (dev-side only) | `designer-qa` | Drive Chromium via `reframe_ui`, walk 11 canonical flows, log to smell table |

**The costume, not the CLI.** You have the full reframe MCP (6 core pipeline tools + `reframe_ui` for Playwright-backed browser automation) plus all normal Claude Code tools. But the user in the browser doesn't want a dev session — they want scene changes. Prefer `reframe_edit` over regeneration when the ask fits an INode property. Keep tool chatter short. Show your work in the preview, not in words.

**All 7 skills share the same shape** — role frame + sensitive surfaces + smell table + canonical flows + anti-patterns + tools to reach for. The smell tables GROW: when you catch a failure pattern the engine can't encode (brand drift, slop signature, site-level cross-page regression, export determinism gap, etc.), add a row. The next session catches the same pattern in seconds rather than rediscovering it.

**The engine is deterministic; the skills are the memory the engine lacks.** 37-rule audit + 8 aesthetic metrics + brandFidelity measure structure. Smell tables catch what structural measurement misses: genericness, fake content, fake logos, tone mismatch, gradient inflation, corner inflation, brand type weight collapse, site nav drift, centered-hero-with-5-elements. That's the moat.

**Platform UI testing** (dev-side, not designer-side): `designer-qa` drives Chromium via `reframe_ui` through 11 canonical designer journeys. UI-layer QA only — engine tests live in `packages/core/src/tests/`.

**Scope context is pre-loaded.** The bottom chat prepends `[Scope: node: … · brand: … · viewport: …]` to each message. Trust it. If the scope says `brand: stripe`, don't re-extract — just Read the cached DESIGN.md.

### Working chain — follow every turn

1. **Plan with TodoWrite.** Any request that takes more than one step (read DESIGN.md → write HTML → compile counts as three) starts with a `TodoWrite` call listing the steps. Mark each `completed` the moment it's done — don't batch. The bottom-chat UI renders this as a live checklist, so the user sees progress. Skip TodoWrite only for pure Q&A or a single `reframe_edit` property tweak.

2. **Copy before big edits.** If the user asks to "make a dark version / variant / alternative" of an existing scene, don't edit the source in place — call `reframe_project action=clone` (or Write a new `.reframe/src/<name>-variant.html` alongside the original) and work on the copy. The original scene stays intact so the user can compare.

3. **Reuse over regenerate.** Small asks (color, spacing, swap a label, toggle dark mode on an existing token set) = one `reframe_edit` call. Reach for `reframe_compile` only when structure changes or the source HTML is wrong. Regeneration from scratch is the last resort, not the default.

4. **End with a compact summary.** After the final tool call, reply with 2-4 lines max: what you did, then 2-3 "Next steps if useful:" suggestions the user can pick from. No headers, no restating the prompt, no emoji.

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
packages/mcp       @reframe/mcp     — MCP server (6 pipeline tools + reframe_ui) + HTTP sidecar (:4100) + Platform UI + REST API + SSE
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
reframe_ui         Playwright-backed Platform UI automation — open/act/probe/screenshot/wait/close/list
```

reframe_ui is the 7th tool. Stateful sessions, session-scoped Playwright Chromium, inline PNG + console/network logs returned on every mutating call. Mirrors what reframe_compile/inspect/edit do for the engine, but for the browser-side Platform UI — reproduce UI bugs, verify fixes, walk multi-step flows end-to-end.

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
